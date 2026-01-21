/**
 * =============================================================================
 * YouTube Video Chat - Firebase Cloud Functions (v2.0)
 * =============================================================================
 *
 * @fileoverview Production-ready Cloud Functions with advanced RAG pipeline.
 *
 * @version      2.0.0
 * @author       Your Name
 * @license      MIT
 *
 * @description
 * This module provides two main functions:
 * - fetchTranscript: Fetches YouTube transcripts via RapidAPI
 * - askQuestion: Answers questions using RAG + OpenAI
 *
 * @improvements (v2.0)
 * - Semantic retrieval using embeddings
 * - Hybrid retrieval (keywords + embeddings)
 * - Better prompt engineering
 * - Stop word removal
 * - Configurable parameters
 * - Modular code structure
 *
 * =============================================================================
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

const { setGlobalOptions } = require("firebase-functions/v2");
const { RAG_CONFIG, LLM_CONFIG, API_CONFIG, FUNCTIONS_CONFIG } = require("./config");

// Set global region for all functions
setGlobalOptions({ region: FUNCTIONS_CONFIG.REGION });

// =============================================================================
// IMPORTS
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const OpenAI = require("openai");
const admin = require("firebase-admin");

// Initialize Firebase Admin
admin.initializeApp();

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const db = getFirestore();

// Import utilities
const { decodeHtmlEntities, chunkText } = require("./utils/textProcessing");
const { retrieveRelevantChunks } = require("./utils/retrieval");
const { createEmbedding, createEmbeddings } = require("./utils/embeddings");
const {
  toSafeHttpsError,
  rapidApiErrorToHttpsError,
  openAiErrorToHttpsError,
  requireString,
} = require("./utils/errorHandling");
const { SYSTEM_PROMPT, generateUserPrompt } = require("./prompts/templates");

// =============================================================================
// SECRETS
// =============================================================================

const openaiApiKey = defineSecret("OPENAI_API_KEY");
const rapidApiKey = defineSecret("RAPIDAPI_KEY");

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extracts Google Cloud trace ID for log correlation.
 *
 * @param {Object} request - Cloud Function request
 * @returns {string|null} Trace ID if available
 */
function getTraceId(request) {
  const header = request?.rawRequest?.headers?.["x-cloud-trace-context"];
  if (!header) return null;
  return String(header).split("/")[0] || null;
}

/**
 * Extracts YouTube video ID from various URL formats.
 *
 * @param {string} urlOrId - YouTube URL or video ID
 * @returns {string|null} 11-character video ID or null
 */
function extractVideoId(urlOrId) {
  const patterns = [
    /(?:v=)([0-9A-Za-z_-]{11})/,
    /(?:youtu\.be\/)([0-9A-Za-z_-]{11})/,
    /(?:embed\/)([0-9A-Za-z_-]{11})/,
    /(?:shorts\/)([0-9A-Za-z_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = String(urlOrId).match(pattern);
    if (match) return match[1];
  }

  if (/^[0-9A-Za-z_-]{11}$/.test(String(urlOrId))) {
    return String(urlOrId);
  }

  return null;
}

// =============================================================================
// CLOUD FUNCTION: fetchTranscript
// =============================================================================

/**
 * Fetches a YouTube video transcript and stores it in Firestore.
 *
 * @function fetchTranscript
 * @param {Object} request.data
 * @param {string} request.data.videoUrl - YouTube URL or video ID
 * @returns {Promise<{ok: boolean, videoId: string, transcriptLength: number}>}
 */
exports.fetchTranscript = onCall(
  {
    secrets: [rapidApiKey],
    memory: FUNCTIONS_CONFIG.FETCH_TRANSCRIPT_MEMORY,
    timeoutSeconds: FUNCTIONS_CONFIG.FETCH_TRANSCRIPT_TIMEOUT,
  },
  async (request) => {
    const traceId = getTraceId(request);
    const startTime = Date.now();

    try {
      // Validate input
      const videoUrl = requireString(request.data?.videoUrl, "videoUrl", {
        max: 5000,
      });

      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        throw new HttpsError("invalid-argument", "Invalid YouTube URL or video ID");
      }

      logger.info("fetchTranscript: start", { videoId, traceId });

      // Fetch transcript from RapidAPI
      const apiUrl = `https://${API_CONFIG.RAPIDAPI_HOST}/api/transcript?videoId=${videoId}`;

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": rapidApiKey.value(),
          "X-RapidAPI-Host": API_CONFIG.RAPIDAPI_HOST,
        },
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw rapidApiErrorToHttpsError(response.status, bodyText);
      }

      const data = await response.json();

      if (!data?.success || !Array.isArray(data?.transcript)) {
        logger.warn("fetchTranscript: unexpected response format", { videoId, traceId });
        throw new HttpsError("unavailable", "Transcript service returned an unexpected response");
      }

      // Process transcript
      const transcript = decodeHtmlEntities(
        data.transcript.map((seg) => seg.text || "").join(" ")
      );

      if (transcript.length < RAG_CONFIG.MIN_TRANSCRIPT_LENGTH) {
        throw new HttpsError("not-found", "Transcript too short or not available");
      }

      // Store in Firestore
      await db.collection("videos").doc(videoId).set(
        {
          videoId,
          videoUrl,
          transcript,
          lang: data.lang || "unknown",
          transcriptLength: transcript.length,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const duration = Date.now() - startTime;
      logger.info("fetchTranscript: success", {
        videoId,
        traceId,
        transcriptLength: transcript.length,
        durationMs: duration,
      });

      return {
        ok: true,
        videoId,
        transcriptLength: transcript.length,
      };
    } catch (err) {
      logger.error("fetchTranscript: failed", err, { traceId });
      throw toSafeHttpsError(err);
    }
  }
);

// =============================================================================
// CLOUD FUNCTION: askQuestion
// =============================================================================

/**
 * Answers a question about a video using RAG.
 *
 * @function askQuestion
 * @param {Object} request.data
 * @param {string} request.data.videoId - YouTube video ID
 * @param {string} request.data.question - User's question
 * @returns {Promise<{answer: string, confidence: string}>}
 */
exports.askQuestion = onCall(
  {
    secrets: [openaiApiKey],
    memory: FUNCTIONS_CONFIG.ASK_QUESTION_MEMORY,
    timeoutSeconds: FUNCTIONS_CONFIG.ASK_QUESTION_TIMEOUT,
  },
  async (request) => {
    const traceId = getTraceId(request);
    const startTime = Date.now();

    try {
      // Validate inputs
      const videoId = requireString(request.data?.videoId, "videoId", {
        min: 11,
        max: 50,
      });
      const question = requireString(request.data?.question, "question", {
        min: 2,
        max: 1000,
      });

      logger.info("askQuestion: start", { videoId, traceId });

      // Get transcript from Firestore
      const videoDoc = await db.collection("videos").doc(videoId).get();

      if (!videoDoc.exists) {
        throw new HttpsError("not-found", "Transcript not found. Please fetch it first.");
      }

      const transcript = String(videoDoc.data()?.transcript || "").trim();

      if (!transcript) {
        throw new HttpsError("failed-precondition", "Transcript is empty");
      }

      // Initialize OpenAI client
      const openai = new OpenAI({ apiKey: openaiApiKey.value() });

      // =======================================================================
      // RAG PIPELINE
      // =======================================================================

      // Step 1: Chunk the transcript
      const chunks = chunkText(transcript);
      logger.info("askQuestion: chunked transcript", {
        videoId,
        traceId,
        numChunks: chunks.length,
      });

      // Step 2: Create embeddings (if enabled)
      let embeddings = null;

      if (RAG_CONFIG.USE_EMBEDDINGS) {
        try {
          const [questionEmbedding, chunkEmbeddings] = await Promise.all([
            createEmbedding(openai, question),
            createEmbeddings(openai, chunks),
          ]);

          embeddings = { questionEmbedding, chunkEmbeddings };

          logger.info("askQuestion: created embeddings", {
            videoId,
            traceId,
            embeddingDim: questionEmbedding.length,
          });
        } catch (embErr) {
          logger.warn("askQuestion: embeddings failed, using keywords", {
            videoId,
            traceId,
            error: embErr.message,
          });
          // Continue with keyword-based retrieval
        }
      }

      // Step 3: Retrieve relevant chunks
      const relevantChunks = retrieveRelevantChunks(chunks, question, embeddings, {
        k: RAG_CONFIG.TOP_K_CHUNKS,
      });

      const contextText = relevantChunks
        .join("\n\n---\n\n")
        .slice(0, RAG_CONFIG.MAX_CONTEXT_LENGTH);

      logger.info("askQuestion: retrieved context", {
        videoId,
        traceId,
        numRelevantChunks: relevantChunks.length,
        contextLength: contextText.length,
      });

      // Step 4: Generate answer with LLM
      const userPrompt = generateUserPrompt(contextText, question);

      let completion;
      try {
        completion = await openai.chat.completions.create({
          model: LLM_CONFIG.MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: LLM_CONFIG.TEMPERATURE,
          max_tokens: LLM_CONFIG.MAX_TOKENS,
          top_p: LLM_CONFIG.TOP_P,
          frequency_penalty: LLM_CONFIG.FREQUENCY_PENALTY,
          presence_penalty: LLM_CONFIG.PRESENCE_PENALTY,
        });
      } catch (openaiErr) {
        logger.error("askQuestion: OpenAI call failed", openaiErr, {
          videoId,
          traceId,
        });
        throw openAiErrorToHttpsError(openaiErr);
      }

      const answer =
        completion?.choices?.[0]?.message?.content?.trim() ||
        "I couldn't generate an answer. Please try again.";

      // Step 5: Store Q&A in Firestore
      await db.collection("videos").doc(videoId).collection("messages").add({
        question,
        answer,
        model: LLM_CONFIG.MODEL,
        tokensUsed: completion?.usage?.total_tokens || 0,
        createdAt: FieldValue.serverTimestamp(),
      });

      const duration = Date.now() - startTime;
      logger.info("askQuestion: success", {
        videoId,
        traceId,
        durationMs: duration,
        tokensUsed: completion?.usage?.total_tokens,
      });

      return { answer };
    } catch (err) {
      logger.error("askQuestion: failed", err, { traceId });
      throw toSafeHttpsError(err);
    }
  }
);