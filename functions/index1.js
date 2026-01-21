/**
 * =============================================================================
 * YouTube Video Chat - Firebase Cloud Functions
 * =============================================================================
 *
 * This module provides the backend for a YouTube video chat application.
 * Users can fetch transcripts from YouTube videos and ask AI-powered questions.
 *
 * FUNCTIONS:
 * - fetchTranscript: Fetches YouTube transcript via RapidAPI, stores in Firestore
 * - askQuestion: Answers questions using OpenAI GPT with RAG (Retrieval-Augmented Generation)
 *
 * ARCHITECTURE:
 * ┌─────────────┐      ┌─────────────----─┐         ┌─────────────┐
 * │   Frontend  │────▶│  fetchTranscript  │────▶   │  RapidAPI   │
 * │  (Browser)  │      │   (Function)     │         │ (Transcript)│
 * └─────────────┘      └─────────----─────┘         └─────────────┘
 *        │                   │
 *        │                   ▼
 *        │            ┌─────────────┐
 *        │            │  Firestore  │
 *        │            │  (Storage)  │
 *        │            └─────────────┘
 *        │                   ▲
 *        ▼                   │
 * ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
 * │   Frontend  │ ───▶│  askQuestion │───▶│   OpenAI    │
 * │  (Browser)  │     │   (Function) │     │  (GPT-4o)   │
 * └─────────────┘     └──────────────┘     └─────────────┘
 *
 * SECURITY:
 * - Secrets stored in Google Secret Manager (OPENAI_API_KEY, RAPIDAPI_KEY)
 * - Input validation on all user inputs
 * - Safe error messages (no internal details leaked to clients)
 * - Structured logging for debugging (logs stay server-side)
 *
 * FIRESTORE STRUCTURE:
 * videos/{videoId}
 *   ├── videoId: string
 *   ├── videoUrl: string
 *   ├── transcript: string
 *   ├── lang: string
 *   └── updatedAt: timestamp
 *   └── messages/{messageId}
 *         ├── question: string
 *         ├── answer: string
 *         └── createdAt: timestamp
 *
 * @author      Garima Chouhan
 * @version     1.0.0
 * @license     MIT
 * @see         https://github.com/Garima17777/youtube-video-chat
 * =============================================================================
 */

// =============================================================================
// GLOBAL CONFIGURATION
// =============================================================================

const { setGlobalOptions } = require("firebase-functions/v2");

/**
 * Deploy all functions to asia-south2 (Delhi, India).
 * This should match your Firestore location for best performance.
 *
 * Available regions: https://cloud.google.com/functions/docs/locations
 */
setGlobalOptions({ region: "asia-south2" });

// =============================================================================
// IMPORTS
// =============================================================================

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const OpenAI = require("openai");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (required for Firestore access)
admin.initializeApp();

const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const db = getFirestore();

// =============================================================================
// SECRETS (stored in Google Secret Manager)
// =============================================================================

/**
 * OpenAI API key for GPT-4o-mini completions.
 * Set via: firebase functions:secrets:set OPENAI_API_KEY
 */
const openaiApiKey = defineSecret("OPENAI_API_KEY");

/**
 * RapidAPI key for YouTube Transcript API.
 * Set via: firebase functions:secrets:set RAPIDAPI_KEY
 */
const rapidApiKey = defineSecret("RAPIDAPI_KEY");

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

/**
 * Configuration for text chunking (RAG retrieval).
 * Adjust these based on your transcript lengths and token limits.
 */
const CONFIG = {
  /** Maximum characters per chunk for RAG retrieval */
  CHUNK_SIZE: 1200,

  /** Overlap between chunks to preserve context at boundaries */
  CHUNK_OVERLAP: 150,

  /** Number of top chunks to retrieve for context */
  TOP_K_CHUNKS: 3,

  /** Maximum context length sent to OpenAI (characters) */
  MAX_CONTEXT_LENGTH: 8000,

  /** Minimum transcript length to be considered valid */
  MIN_TRANSCRIPT_LENGTH: 100,

  /** OpenAI model to use */
  OPENAI_MODEL: "gpt-4o-mini",

  /** OpenAI temperature (0 = deterministic, 1 = creative) */
  OPENAI_TEMPERATURE: 0.2,

  /** RapidAPI host for transcript service */
  RAPIDAPI_HOST: "youtube-transcript3.p.rapidapi.com",
};

// =============================================================================
// HELPER FUNCTIONS: Request Utilities
// =============================================================================

/**
 * Extracts Google Cloud trace ID from request headers.
 * Useful for correlating logs across function invocations in Log Explorer.
 *
 * @param {Object} request - Firebase callable function request object
 * @returns {string|null} Trace ID if available, null otherwise
 *
 * @example
 * const traceId = getTraceId(request);
 * logger.info("Processing", { traceId }); // Shows in Log Explorer
 */
function getTraceId(request) {
  const header = request?.rawRequest?.headers?.["x-cloud-trace-context"];
  if (!header) return null;
  // Format: TRACE_ID/SPAN_ID;o=TRACE_TRUE
  return String(header).split("/")[0] || null;
}

// =============================================================================
// HELPER FUNCTIONS: Input Validation
// =============================================================================

/**
 * Validates that a value is a non-empty string within length constraints.
 * Throws HttpsError if validation fails (client receives clean error message).
 *
 * @param {*} value - Value to validate
 * @param {string} fieldName - Name of field (for error messages)
 * @param {Object} options - Validation options
 * @param {number} [options.min=1] - Minimum length after trimming
 * @param {number} [options.max=2000] - Maximum length after trimming
 * @returns {string} Trimmed, validated string
 * @throws {HttpsError} If validation fails
 *
 * @example
 * const url = requireString(request.data?.videoUrl, "videoUrl", { max: 500 });
 */
function requireString(value, fieldName, { min = 1, max = 2000 } = {}) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length < min) {
    throw new HttpsError("invalid-argument", `${fieldName} is required`);
  }

  if (trimmed.length > max) {
    throw new HttpsError("invalid-argument", `${fieldName} is too long`);
  }

  return trimmed;
}

// =============================================================================
// HELPER FUNCTIONS: Error Handling
// =============================================================================

/**
 * Converts any error to a safe HttpsError for client consumption.
 * Internal error details are logged but NOT exposed to the client.
 *
 * @param {Error} err - Original error
 * @param {string} [fallbackMessage] - Message to show client if error is unknown
 * @returns {HttpsError} Safe error to throw to client
 *
 * @example
 * catch (err) {
 *   logger.error("Failed", err);
 *   throw toSafeHttpsError(err);
 * }
 */
function toSafeHttpsError(
  err,
  fallbackMessage = "Something went wrong. Please try again later."
) {
  // If already an HttpsError, it's already safe to return
  if (err instanceof HttpsError) return err;

  // For unknown errors, return generic message (don't leak internals)
  return new HttpsError("internal", fallbackMessage);
}

/**
 * Maps RapidAPI HTTP error responses to user-friendly HttpsError messages.
 * The actual error body is logged internally but not exposed to clients.
 *
 * @param {number} status - HTTP status code from RapidAPI
 * @param {string} bodyText - Response body (for internal logging only)
 * @returns {HttpsError} User-safe error
 */
function rapidApiErrorToHttpsError(status, bodyText) {
  // Note: bodyText is only for internal debugging, never returned to client

  if (status === 401 || status === 403) {
    return new HttpsError(
      "permission-denied",
      "Transcript provider rejected the request. Please try again later."
    );
  }

  if (status === 404) {
    return new HttpsError(
      "not-found",
      "Transcript not found for this video (captions may be disabled)."
    );
  }

  if (status === 429) {
    return new HttpsError(
      "resource-exhausted",
      "Transcript provider is rate-limiting requests. Please try again later."
    );
  }

  return new HttpsError(
    "unavailable",
    "Transcript service is currently unavailable. Please try again later."
  );
}

/**
 * Maps OpenAI API errors to user-friendly HttpsError messages.
 *
 * @param {Error} err - Error from OpenAI SDK
 * @returns {HttpsError} User-safe error
 */
function openAiErrorToHttpsError(err) {
  const status = err?.status || err?.response?.status;

  if (status === 401 || status === 403) {
    return new HttpsError(
      "failed-precondition",
      "AI service is not configured correctly."
    );
  }

  if (status === 429) {
    return new HttpsError(
      "resource-exhausted",
      "AI service is busy. Please try again shortly."
    );
  }

  if (status >= 500) {
    return new HttpsError(
      "unavailable",
      "AI service is unavailable. Please try again later."
    );
  }

  return new HttpsError(
    "internal",
    "Failed to generate an answer. Please try again later."
  );
}

// =============================================================================
// HELPER FUNCTIONS: YouTube URL Parsing
// =============================================================================

/**
 * Extracts YouTube video ID from various URL formats.
 *
 * Supported formats:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/shorts/VIDEO_ID
 * - Direct video ID (11 characters)
 *
 * @param {string} urlOrId - YouTube URL or direct video ID
 * @returns {string|null} 11-character video ID, or null if invalid
 *
 * @example
 * extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ") // "dQw4w9WgXcQ"
 * extractVideoId("dQw4w9WgXcQ") // "dQw4w9WgXcQ"
 * extractVideoId("invalid") // null
 */
function extractVideoId(urlOrId) {
  const patterns = [
    /(?:v=)([0-9A-Za-z_-]{11})/,       // watch?v=VIDEO_ID
    /(?:youtu\.be\/)([0-9A-Za-z_-]{11})/, // youtu.be/VIDEO_ID
    /(?:embed\/)([0-9A-Za-z_-]{11})/,   // embed/VIDEO_ID
    /(?:shorts\/)([0-9A-Za-z_-]{11})/,  // shorts/VIDEO_ID
  ];

  for (const pattern of patterns) {
    const match = String(urlOrId).match(pattern);
    if (match) return match[1];
  }

  // Check if input is already a valid video ID
  if (/^[0-9A-Za-z_-]{11}$/.test(String(urlOrId))) {
    return String(urlOrId);
  }

  return null;
}

// =============================================================================
// HELPER FUNCTIONS: Text Processing
// =============================================================================

/**
 * Decodes common HTML entities found in YouTube transcripts.
 * Also normalizes whitespace (multiple spaces → single space).
 *
 * @param {string} text - Text containing HTML entities
 * @returns {string} Decoded and normalized text
 *
 * @example
 * decodeBasicHtmlEntities("It&#39;s a &quot;test&quot;") // "It's a \"test\""
 */
function decodeBasicHtmlEntities(text) {
  return String(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits text into overlapping chunks for RAG retrieval.
 * Overlap ensures context isn't lost at chunk boundaries.
 *
 * @param {string} text - Text to split
 * @param {number} [size=1200] - Maximum chunk size in characters
 * @param {number} [overlap=150] - Overlap between consecutive chunks
 * @returns {string[]} Array of text chunks
 *
 * @example
 * const chunks = chunkText(longText, 1000, 100);
 * // Returns: ["chunk1...", "...chunk2...", "...chunk3"]
 */
function chunkText(text, size = CONFIG.CHUNK_SIZE, overlap = CONFIG.CHUNK_OVERLAP) {
  const chunks = [];
  const step = size - overlap;

  for (let i = 0; i < text.length; i += step) {
    chunks.push(text.slice(i, i + size));
  }

  return chunks;
}

/**
 * Retrieves the most relevant text chunks for a given question.
 * Uses simple keyword matching (bag-of-words style).
 *
 * For production at scale, consider using embeddings + vector similarity.
 *
 * @param {string[]} chunks - Array of text chunks to search
 * @param {string} question - User's question
 * @param {number} [k=3] - Number of top chunks to return
 * @returns {string[]} Top k most relevant chunks
 *
 * @example
 * const relevant = retrieveTopChunks(chunks, "What is machine learning?", 3);
 */
function retrieveTopChunks(chunks, question, k = CONFIG.TOP_K_CHUNKS) {
  // Extract words from question (lowercase, non-empty)
  const words = question.toLowerCase().split(/\W+/).filter(Boolean);

  // Score each chunk by counting matching words
  const scored = chunks.map((chunk) => {
    const lowerChunk = chunk.toLowerCase();
    const score = words.reduce((sum, word) => {
      return sum + (lowerChunk.includes(word) ? 1 : 0);
    }, 0);
    return { chunk, score };
  });

  // Sort by score (highest first) and return top k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((item) => item.chunk);
}

// =============================================================================
// CLOUD FUNCTION: fetchTranscript
// =============================================================================

/**
 * Fetches a YouTube video transcript and stores it in Firestore.
 *
 * @function fetchTranscript
 * @param {Object} request.data - Request payload
 * @param {string} request.data.videoUrl - YouTube video URL or video ID
 * @returns {Object} Response object
 * @returns {boolean} return.ok - Always true on success
 * @returns {string} return.videoId - The extracted video ID
 * @returns {number} return.transcriptLength - Character count of transcript
 *
 * @throws {HttpsError} invalid-argument - If videoUrl is missing or invalid
 * @throws {HttpsError} not-found - If transcript not available
 * @throws {HttpsError} permission-denied - If RapidAPI rejects request
 * @throws {HttpsError} unavailable - If transcript service is down
 *
 * @example
 * // Client-side call
 * const result = await fetchTranscript({ videoUrl: "https://youtube.com/watch?v=..." });
 * console.log(result.data.transcriptLength); // 15420
 */
exports.fetchTranscript = onCall(
  {
    secrets: [rapidApiKey],
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    const traceId = getTraceId(request);
    const startedAt = Date.now();

    try {
      // -----------------------------------------------------------------------
      // 1. Validate input
      // -----------------------------------------------------------------------
      const videoUrl = requireString(request.data?.videoUrl, "videoUrl", {
        max: 5000,
      });

      const videoId = extractVideoId(videoUrl);
      if (!videoId) {
        throw new HttpsError("invalid-argument", "Invalid YouTube URL/videoId");
      }

      logger.info("fetchTranscript: start", { videoId, traceId });

      // -----------------------------------------------------------------------
      // 2. Call RapidAPI transcript service
      // -----------------------------------------------------------------------
      const apiUrl = `https://${CONFIG.RAPIDAPI_HOST}/api/transcript?videoId=${videoId}`;

      const response = await fetch(apiUrl, {
        method: "GET",
        headers: {
          "X-RapidAPI-Key": rapidApiKey.value(),
          "X-RapidAPI-Host": CONFIG.RAPIDAPI_HOST,
        },
      });

      // Handle non-OK responses
      if (!response.ok) {
        const bodyText = await response.text();

        // Log full details internally (for debugging in Cloud Logging)
        logger.warn("fetchTranscript: RapidAPI non-OK", {
          videoId,
          traceId,
          status: response.status,
          bodyPreview: bodyText.slice(0, 500),
        });

        throw rapidApiErrorToHttpsError(response.status, bodyText);
      }

      // -----------------------------------------------------------------------
      // 3. Parse and validate response
      // -----------------------------------------------------------------------
      const data = await response.json();

      if (!data?.success || !Array.isArray(data?.transcript)) {
        logger.warn("fetchTranscript: unexpected response format", {
          videoId,
          traceId,
        });
        throw new HttpsError(
          "unavailable",
          "Transcript service returned an unexpected response."
        );
      }

      // Combine transcript segments and decode HTML entities
      const transcript = decodeBasicHtmlEntities(
        data.transcript.map((segment) => segment.text || "").join(" ")
      );

      if (transcript.length < CONFIG.MIN_TRANSCRIPT_LENGTH) {
        throw new HttpsError(
          "not-found",
          "Transcript too short / not available for this video."
        );
      }

      // -----------------------------------------------------------------------
      // 4. Store transcript in Firestore
      // -----------------------------------------------------------------------
      /**
       * NOTE: Firestore document size limit is ~1 MiB.
       * For very long transcripts (rare), consider:
       * - Storing in Cloud Storage
       * - Splitting into multiple documents
       */
      await db.collection("videos").doc(videoId).set(
        {
          videoId,
          videoUrl,
          transcript,
          lang: data.lang || "unknown",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      // -----------------------------------------------------------------------
      // 5. Return success response
      // -----------------------------------------------------------------------
      const durationMs = Date.now() - startedAt;

      logger.info("fetchTranscript: success", {
        videoId,
        traceId,
        transcriptLength: transcript.length,
        durationMs,
      });

      return {
        ok: true,
        videoId,
        transcriptLength: transcript.length,
      };
    } catch (err) {
      // Log full error details internally
      logger.error("fetchTranscript: failed", err, { traceId });

      // Return safe error to client
      throw toSafeHttpsError(err);
    }
  }
);

// =============================================================================
// CLOUD FUNCTION: askQuestion
// =============================================================================

/**
 * Answers a question about a video using its stored transcript.
 * Uses RAG (Retrieval-Augmented Generation) pattern:
 * 1. Retrieve relevant transcript chunks
 * 2. Send chunks + question to OpenAI
 * 3. Return AI-generated answer
 *
 * @function askQuestion
 * @param {Object} request.data - Request payload
 * @param {string} request.data.videoId - YouTube video ID (transcript must exist)
 * @param {string} request.data.question - User's question about the video
 * @returns {Object} Response object
 * @returns {string} return.answer - AI-generated answer (markdown formatted)
 *
 * @throws {HttpsError} invalid-argument - If videoId or question is invalid
 * @throws {HttpsError} not-found - If transcript doesn't exist
 * @throws {HttpsError} failed-precondition - If transcript is empty
 * @throws {HttpsError} unavailable - If OpenAI is unavailable
 *
 * @example
 * // Client-side call
 * const result = await askQuestion({
 *   videoId: "dQw4w9WgXcQ",
 *   question: "What is the main topic?"
 * });
 * console.log(result.data.answer); // "The video discusses..."
 */
exports.askQuestion = onCall(
  {
    secrets: [openaiApiKey],
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (request) => {
    const traceId = getTraceId(request);
    const startedAt = Date.now();

    try {
      // -----------------------------------------------------------------------
      // 1. Validate inputs
      // -----------------------------------------------------------------------
      const videoId = requireString(request.data?.videoId, "videoId", {
        min: 11,
        max: 50,
      });

      const question = requireString(request.data?.question, "question", {
        min: 2,
        max: 1000,
      });

      logger.info("askQuestion: start", { videoId, traceId });

      // -----------------------------------------------------------------------
      // 2. Retrieve transcript from Firestore
      // -----------------------------------------------------------------------
      const doc = await db.collection("videos").doc(videoId).get();

      if (!doc.exists) {
        throw new HttpsError(
          "not-found",
          "Transcript not found. Fetch it first."
        );
      }

      const transcript = String(doc.data()?.transcript || "").trim();

      if (!transcript) {
        throw new HttpsError("failed-precondition", "Transcript is empty.");
      }

      // -----------------------------------------------------------------------
      // 3. RAG: Retrieve relevant context chunks
      // -----------------------------------------------------------------------
      const chunks = chunkText(transcript);
      const topChunks = retrieveTopChunks(chunks, question, CONFIG.TOP_K_CHUNKS);
      const contextText = topChunks
        .join("\n\n---\n\n")
        .slice(0, CONFIG.MAX_CONTEXT_LENGTH);

      // -----------------------------------------------------------------------
      // 4. Generate answer with OpenAI
      // -----------------------------------------------------------------------
      const openaiClient = new OpenAI({ apiKey: openaiApiKey.value() });

      const systemPrompt = `You are a helpful video assistant. Always provide clear, well-structured answers using markdown formatting. Use bullet points, numbered lists, bold text, and headings to make your answers easy to read and scan.`;

      const userPrompt = `You are a helpful assistant answering questions about a YouTube video based on its transcript.

## Instructions:
- Answer based ONLY on the provided context
- Be concise, clear, and well-structured
- Use **bold** for important terms or concepts
- Use bullet points (-) or numbered lists (1.) for multiple items
- Use headings (##) to organize longer answers
- If the context doesn't contain enough information, say so honestly

## Context from Video Transcript:
${contextText}

## Question:
${question}

## Answer:`;

      let completion;
      try {
        completion = await openaiClient.chat.completions.create({
          model: CONFIG.OPENAI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: CONFIG.OPENAI_TEMPERATURE,
        });
      } catch (openAiErr) {
        logger.error("askQuestion: OpenAI call failed", openAiErr, {
          videoId,
          traceId,
        });
        throw openAiErrorToHttpsError(openAiErr);
      }

      const answer =
        completion?.choices?.[0]?.message?.content?.trim() ||
        "No answer returned.";

      // -----------------------------------------------------------------------
      // 5. Store Q&A in Firestore (for chat history)
      // -----------------------------------------------------------------------
      await db.collection("videos").doc(videoId).collection("messages").add({
        question,
        answer,
        createdAt: FieldValue.serverTimestamp(),
      });

      // -----------------------------------------------------------------------
      // 6. Return answer
      // -----------------------------------------------------------------------
      const durationMs = Date.now() - startedAt;

      logger.info("askQuestion: success", { videoId, traceId, durationMs });

      return { answer };
    } catch (err) {
      logger.error("askQuestion: failed", err, { traceId });
      throw toSafeHttpsError(err);
    }
  }
);