/**
 * =============================================================================
 * Configuration - Centralized Configuration Constants
 * =============================================================================
 *
 * @fileoverview All configurable parameters for the YouTube Video Chat app.
 *               Change these values to tune the RAG pipeline performance.
 *
 * @author       Your Name
 * @version      2.0.0
 *
 * =============================================================================
 */

/**
 * RAG (Retrieval-Augmented Generation) Configuration
 *
 * These parameters control how transcripts are processed and
 * how context is retrieved for answering questions.
 */
const RAG_CONFIG = Object.freeze({
  /**
   * Maximum characters per chunk.
   * Larger chunks = more context but fewer chunks.
   * Smaller chunks = more precise retrieval but less context per chunk.
   *
   * @recommended 1500-2000 for transcripts
   */
  CHUNK_SIZE: 1500,

  /**
   * Overlap between consecutive chunks (in characters).
   * Prevents losing context at chunk boundaries.
   * Higher overlap = better continuity but more redundancy.
   *
   * @recommended 10-15% of CHUNK_SIZE
   */
  CHUNK_OVERLAP: 200,

  /**
   * Number of top chunks to retrieve for context.
   * More chunks = more context but higher token cost.
   *
   * @recommended 3-5 for most use cases
   */
  TOP_K_CHUNKS: 5,

  /**
   * Maximum total context length sent to the LLM (in characters).
   * Prevents exceeding token limits and controls costs.
   *
   * @note GPT-4o-mini has 128K token limit (~512K chars)
   *       But we limit to control costs and improve relevance.
   */
  MAX_CONTEXT_LENGTH: 10000,

  /**
   * Minimum transcript length to be considered valid.
   * Very short transcripts likely indicate an error.
   */
  MIN_TRANSCRIPT_LENGTH: 100,

  /**
   * Whether to use embeddings for semantic search.
   * If false, uses keyword-based retrieval.
   *
   * @note Embeddings are more accurate but cost extra API calls.
   */
  USE_EMBEDDINGS: true,

  /**
   * Embeddings model to use (if USE_EMBEDDINGS is true).
   * Options: "text-embedding-3-small", "text-embedding-3-large"
   */
  EMBEDDINGS_MODEL: "text-embedding-3-small",

  /**
   * Minimum similarity score for a chunk to be considered relevant.
   * Only applies when using embeddings.
   * Range: 0.0 to 1.0 (higher = more strict)
   */
  MIN_SIMILARITY_THRESHOLD: 0.3,
});

/**
 * LLM (Large Language Model) Configuration
 *
 * Parameters for the AI model that generates answers.
 */
const LLM_CONFIG = Object.freeze({
  /**
   * Model to use for generating answers.
   *
   * Options:
   * - "gpt-4o-mini" (OpenAI) - Good balance of cost and quality
   * - "gpt-4o" (OpenAI) - Best quality, higher cost
   * - "gpt-3.5-turbo" (OpenAI) - Cheapest OpenAI option
   */
  MODEL: "gpt-4o-mini",

  /**
   * Temperature controls randomness in responses.
   * 0.0 = Deterministic (same input = same output)
   * 1.0 = Creative (more varied responses)
   *
   * @recommended 0.1-0.3 for factual Q&A
   */
  TEMPERATURE: 0.1,

  /**
   * Maximum tokens in the response.
   * Prevents overly long answers and controls costs.
   *
   * @note 1 token ≈ 4 characters in English
   */
  MAX_TOKENS: 1000,

  /**
   * Top-p (nucleus sampling) parameter.
   * Lower values make output more focused.
   *
   * @recommended 0.9-1.0 for most use cases
   */
  TOP_P: 0.95,

  /**
   * Frequency penalty to reduce repetition.
   * Range: -2.0 to 2.0 (higher = less repetition)
   */
  FREQUENCY_PENALTY: 0.0,

  /**
   * Presence penalty to encourage topic diversity.
   * Range: -2.0 to 2.0 (higher = more diverse topics)
   */
  PRESENCE_PENALTY: 0.0,
});

/**
 * API Configuration
 *
 * External API settings.
 */
const API_CONFIG = Object.freeze({
  /**
   * RapidAPI host for transcript service.
   */
  RAPIDAPI_HOST: "youtube-transcript3.p.rapidapi.com",

  /**
   * Timeout for API calls (in milliseconds).
   */
  API_TIMEOUT: 30000,
});

/**
 * Cloud Functions Configuration
 *
 * Firebase Cloud Functions settings.
 */
const FUNCTIONS_CONFIG = Object.freeze({
  /**
   * Region for Cloud Functions deployment.
   * Should match Firestore location for best performance.
   */
  REGION: "asia-south2",

  /**
   * Memory allocation for fetchTranscript function.
   */
  FETCH_TRANSCRIPT_MEMORY: "256MiB",

  /**
   * Memory allocation for askQuestion function.
   * Higher because it processes embeddings and LLM calls.
   */
  ASK_QUESTION_MEMORY: "512MiB",

  /**
   * Timeout for fetchTranscript (seconds).
   */
  FETCH_TRANSCRIPT_TIMEOUT: 60,

  /**
   * Timeout for askQuestion (seconds).
   */
  ASK_QUESTION_TIMEOUT: 120,
});

module.exports = {
  RAG_CONFIG,
  LLM_CONFIG,
  API_CONFIG,
  FUNCTIONS_CONFIG,
};