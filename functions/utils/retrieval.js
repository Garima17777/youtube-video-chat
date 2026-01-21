/**
 * =============================================================================
 * Retrieval Utilities - RAG Retrieval Logic
 * =============================================================================
 *
 * @fileoverview Implements retrieval strategies for the RAG pipeline.
 *               Supports both keyword-based and embedding-based retrieval.
 *
 * @author       Your Name
 * @version      2.0.0
 *
 * =============================================================================
 */

const { RAG_CONFIG } = require("../config");
const { extractKeywords } = require("./textProcessing");

/**
 * Retrieves the most relevant chunks using keyword matching.
 *
 * @description
 * Simple but effective retrieval method:
 * 1. Extract keywords from the question
 * 2. Score each chunk by counting keyword matches
 * 3. Return top-k highest scoring chunks
 *
 * @param {string[]} chunks - Array of text chunks to search
 * @param {string} question - User's question
 * @param {number} [k=RAG_CONFIG.TOP_K_CHUNKS] - Number of chunks to return
 * @returns {Object[]} Array of {chunk, score} objects, sorted by relevance
 *
 * @example
 * const results = retrieveByKeywords(chunks, "What is machine learning?", 3);
 * // Returns: [{chunk: "...", score: 5}, {chunk: "...", score: 3}, ...]
 */
function retrieveByKeywords(chunks, question, k = RAG_CONFIG.TOP_K_CHUNKS) {
  // Extract meaningful keywords (stop words removed)
  const keywords = extractKeywords(question);

  if (keywords.length === 0) {
    // Fallback: use all words if no keywords extracted
    const allWords = question.toLowerCase().split(/\W+/).filter(Boolean);
    keywords.push(...allWords);
  }

  // Score each chunk
  const scored = chunks.map((chunk, index) => {
    const lowerChunk = chunk.toLowerCase();

    // Count keyword matches
    let score = 0;
    for (const keyword of keywords) {
      // Count occurrences (not just presence)
      const regex = new RegExp(keyword, "gi");
      const matches = lowerChunk.match(regex);
      if (matches) {
        score += matches.length;
      }
    }

    // Bonus for exact phrase match
    const lowerQuestion = question.toLowerCase();
    if (lowerChunk.includes(lowerQuestion)) {
      score += 10;
    }

    return { chunk, score, index };
  });

  // Sort by score (descending) and return top k
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k);
}

/**
 * Calculates cosine similarity between two vectors.
 *
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Similarity score between 0 and 1
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error("Vectors must have the same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Retrieves the most relevant chunks using embedding similarity.
 *
 * @description
 * Semantic retrieval using vector embeddings:
 * 1. Get embedding for the question
 * 2. Compare with pre-computed chunk embeddings
 * 3. Return chunks with highest cosine similarity
 *
 * @param {string[]} chunks - Array of text chunks
 * @param {number[][]} chunkEmbeddings - Pre-computed embeddings for chunks
 * @param {number[]} questionEmbedding - Embedding for the question
 * @param {number} [k=RAG_CONFIG.TOP_K_CHUNKS] - Number of chunks to return
 * @param {number} [minThreshold=RAG_CONFIG.MIN_SIMILARITY_THRESHOLD] - Minimum similarity
 * @returns {Object[]} Array of {chunk, score, index} objects
 */
function retrieveByEmbeddings(
  chunks,
  chunkEmbeddings,
  questionEmbedding,
  k = RAG_CONFIG.TOP_K_CHUNKS,
  minThreshold = RAG_CONFIG.MIN_SIMILARITY_THRESHOLD
) {
  // Calculate similarity for each chunk
  const scored = chunks.map((chunk, index) => {
    const similarity = cosineSimilarity(questionEmbedding, chunkEmbeddings[index]);
    return { chunk, score: similarity, index };
  });

  // Filter by minimum threshold
  const filtered = scored.filter((item) => item.score >= minThreshold);

  // Sort by similarity (descending)
  filtered.sort((a, b) => b.score - a.score);

  // Return top k
  return filtered.slice(0, k);
}

/**
 * Combines keyword and embedding retrieval (hybrid approach).
 *
 * @description
 * Hybrid retrieval often performs better than either method alone:
 * 1. Get candidates from both keyword and embedding retrieval
 * 2. Combine scores with configurable weights
 * 3. Re-rank by combined score
 *
 * @param {string[]} chunks - Array of text chunks
 * @param {string} question - User's question
 * @param {number[][]} chunkEmbeddings - Pre-computed embeddings for chunks
 * @param {number[]} questionEmbedding - Embedding for the question
 * @param {Object} [options] - Retrieval options
 * @param {number} [options.k=RAG_CONFIG.TOP_K_CHUNKS] - Number of chunks to return
 * @param {number} [options.keywordWeight=0.3] - Weight for keyword score
 * @param {number} [options.embeddingWeight=0.7] - Weight for embedding score
 * @returns {Object[]} Array of {chunk, score, index} objects
 */
function retrieveHybrid(
  chunks,
  question,
  chunkEmbeddings,
  questionEmbedding,
  options = {}
) {
  const {
    k = RAG_CONFIG.TOP_K_CHUNKS,
    keywordWeight = 0.3,
    embeddingWeight = 0.7,
  } = options;

  // Get keyword scores
  const keywordResults = retrieveByKeywords(chunks, question, chunks.length);
  const keywordScores = new Map();
  const maxKeywordScore = Math.max(...keywordResults.map((r) => r.score), 1);

  for (const result of keywordResults) {
    // Normalize keyword score to 0-1
    keywordScores.set(result.index, result.score / maxKeywordScore);
  }

  // Get embedding scores
  const embeddingResults = retrieveByEmbeddings(
    chunks,
    chunkEmbeddings,
    questionEmbedding,
    chunks.length,
    0 // No threshold for hybrid
  );
  const embeddingScores = new Map();

  for (const result of embeddingResults) {
    embeddingScores.set(result.index, result.score);
  }

  // Combine scores
  const combined = chunks.map((chunk, index) => {
    const keywordScore = keywordScores.get(index) || 0;
    const embeddingScore = embeddingScores.get(index) || 0;
    const combinedScore =
      keywordWeight * keywordScore + embeddingWeight * embeddingScore;

    return { chunk, score: combinedScore, index };
  });

  // Sort and return top k
  combined.sort((a, b) => b.score - a.score);

  return combined.slice(0, k);
}

/**
 * Main retrieval function that selects the appropriate strategy.
 *
 * @param {string[]} chunks - Array of text chunks
 * @param {string} question - User's question
 * @param {Object} [embeddings] - Embeddings data (optional)
 * @param {number[][]} [embeddings.chunkEmbeddings] - Chunk embeddings
 * @param {number[]} [embeddings.questionEmbedding] - Question embedding
 * @param {Object} [options] - Retrieval options
 * @returns {string[]} Array of relevant chunk texts
 */
function retrieveRelevantChunks(chunks, question, embeddings = null, options = {}) {
  const { k = RAG_CONFIG.TOP_K_CHUNKS } = options;

  let results;

  if (embeddings && embeddings.chunkEmbeddings && embeddings.questionEmbedding) {
    // Use hybrid retrieval if embeddings available
    results = retrieveHybrid(
      chunks,
      question,
      embeddings.chunkEmbeddings,
      embeddings.questionEmbedding,
      { k, ...options }
    );
  } else {
    // Fallback to keyword-based retrieval
    results = retrieveByKeywords(chunks, question, k);
  }

  // Return just the chunk texts
  return results.map((r) => r.chunk);
}

module.exports = {
  retrieveByKeywords,
  retrieveByEmbeddings,
  retrieveHybrid,
  retrieveRelevantChunks,
  cosineSimilarity,
};