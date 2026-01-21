/**
 * =============================================================================
 * Embeddings Utilities
 * =============================================================================
 *
 * @fileoverview Handles creation and management of text embeddings
 *               using OpenAI's embedding models.
 *
 * @author       Your Name
 * @version      2.0.0
 *
 * =============================================================================
 */

const { RAG_CONFIG } = require("../config");

/**
 * Creates embeddings for an array of texts using OpenAI.
 *
 * @description
 * Embeddings are dense vector representations of text that capture
 * semantic meaning. Similar texts have similar embeddings.
 *
 * @param {Object} openaiClient - Initialized OpenAI client
 * @param {string[]} texts - Array of texts to embed
 * @param {string} [model=RAG_CONFIG.EMBEDDINGS_MODEL] - Embedding model to use
 * @returns {Promise<number[][]>} Array of embedding vectors
 *
 * @example
 * const embeddings = await createEmbeddings(client, ["Hello world", "Hi there"]);
 * // Returns: [[0.1, 0.2, ...], [0.15, 0.18, ...]]
 */
async function createEmbeddings(
  openaiClient,
  texts,
  model = RAG_CONFIG.EMBEDDINGS_MODEL
) {
  if (!texts || texts.length === 0) {
    return [];
  }

  // OpenAI has a limit on batch size, process in batches if needed
  const BATCH_SIZE = 100;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const response = await openaiClient.embeddings.create({
      model: model,
      input: batch,
    });

    // Extract embedding vectors
    const batchEmbeddings = response.data.map((item) => item.embedding);
    allEmbeddings.push(...batchEmbeddings);
  }

  return allEmbeddings;
}

/**
 * Creates a single embedding for a text.
 *
 * @param {Object} openaiClient - Initialized OpenAI client
 * @param {string} text - Text to embed
 * @param {string} [model=RAG_CONFIG.EMBEDDINGS_MODEL] - Embedding model
 * @returns {Promise<number[]>} Embedding vector
 */
async function createEmbedding(
  openaiClient,
  text,
  model = RAG_CONFIG.EMBEDDINGS_MODEL
) {
  const response = await openaiClient.embeddings.create({
    model: model,
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Creates embeddings for chunks with caching support.
 *
 * @description
 * For production, you might want to cache embeddings in Firestore
 * to avoid recomputing them on every request.
 *
 * @param {Object} openaiClient - Initialized OpenAI client
 * @param {string[]} chunks - Text chunks to embed
 * @param {Object} [cache] - Optional cache object with get/set methods
 * @param {string} [cacheKey] - Key for caching
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
async function createChunkEmbeddings(
  openaiClient,
  chunks,
  cache = null,
  cacheKey = null
) {
  // Check cache first
  if (cache && cacheKey) {
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Create embeddings
  const embeddings = await createEmbeddings(openaiClient, chunks);

  // Store in cache
  if (cache && cacheKey) {
    await cache.set(cacheKey, embeddings);
  }

  return embeddings;
}

module.exports = {
  createEmbeddings,
  createEmbedding,
  createChunkEmbeddings,
};