/**
 * =============================================================================
 * Text Processing Utilities
 * =============================================================================
 *
 * @fileoverview Utilities for processing text in the RAG pipeline.
 *               Includes chunking, stop word removal, and text cleaning.
 *
 * @author       Your Name
 * @version      2.0.0
 *
 * =============================================================================
 */

const { RAG_CONFIG } = require("../config");

/**
 * Common English stop words to ignore during keyword extraction.
 *
 * @description
 * Stop words are common words that don't carry significant meaning
 * for search/retrieval purposes. Removing them improves retrieval accuracy.
 *
 * @constant {Set<string>}
 */
const STOP_WORDS = new Set([
  // Articles
  "a", "an", "the",

  // Pronouns
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "this", "that", "these", "those",

  // Verbs (common)
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing",
  "would", "should", "could", "ought",
  "will", "shall", "can", "may", "might", "must",

  // Prepositions
  "at", "by", "for", "from", "in", "into", "of", "on", "to", "with",
  "about", "against", "between", "through", "during", "before", "after",
  "above", "below", "up", "down", "out", "off", "over", "under",

  // Conjunctions
  "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
  "not", "only", "own", "same", "than", "too", "very",

  // Question words (keep some for context)
  "how", "why", "when", "where",

  // Other common words
  "just", "also", "now", "here", "there", "then", "once",
  "all", "any", "each", "every", "few", "more", "most", "other",
  "some", "such", "no", "not", "only", "own", "same",
  "as", "if", "because", "until", "while",

  // Contractions (expanded)
  "dont", "doesnt", "didnt", "wont", "wouldnt", "shouldnt", "couldnt",
  "cant", "cannot", "isnt", "arent", "wasnt", "werent",
  "hasnt", "havent", "hadnt",
]);

/**
 * Decodes common HTML entities found in YouTube transcripts.
 * Also normalizes whitespace.
 *
 * @param {string} text - Text containing HTML entities
 * @returns {string} Decoded and normalized text
 *
 * @example
 * decodeHtmlEntities("It&#39;s a &quot;test&quot;")
 * // Returns: "It's a \"test\""
 */
function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits text into overlapping chunks for RAG retrieval.
 *
 * @description
 * Chunking is essential for RAG because:
 * 1. Transcripts can be very long (exceed LLM context limits)
 * 2. Smaller chunks enable more precise retrieval
 * 3. Overlap prevents losing context at chunk boundaries
 *
 * @param {string} text - Text to split into chunks
 * @param {number} [size=RAG_CONFIG.CHUNK_SIZE] - Maximum chunk size
 * @param {number} [overlap=RAG_CONFIG.CHUNK_OVERLAP] - Overlap between chunks
 * @returns {string[]} Array of text chunks
 *
 * @example
 * const chunks = chunkText("Very long text...", 1000, 100);
 * // Returns: ["chunk1...", "...chunk2...", "...chunk3"]
 */
function chunkText(
  text,
  size = RAG_CONFIG.CHUNK_SIZE,
  overlap = RAG_CONFIG.CHUNK_OVERLAP
) {
  if (!text || text.length === 0) {
    return [];
  }

  const chunks = [];
  const step = size - overlap;

  for (let i = 0; i < text.length; i += step) {
    const chunk = text.slice(i, i + size).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

/**
 * Extracts meaningful keywords from text, removing stop words.
 *
 * @description
 * This improves retrieval accuracy by focusing on content words
 * rather than common grammatical words.
 *
 * @param {string} text - Text to extract keywords from
 * @param {Object} [options] - Extraction options
 * @param {number} [options.minLength=2] - Minimum word length
 * @param {boolean} [options.removeNumbers=false] - Remove numeric words
 * @returns {string[]} Array of keywords (lowercase, unique)
 *
 * @example
 * extractKeywords("What is machine learning?")
 * // Returns: ["machine", "learning"]
 */
function extractKeywords(text, options = {}) {
  const { minLength = 2, removeNumbers = false } = options;

  // Split into words, convert to lowercase
  let words = String(text)
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);

  // Filter out stop words
  words = words.filter((word) => !STOP_WORDS.has(word));

  // Filter by minimum length
  words = words.filter((word) => word.length >= minLength);

  // Optionally remove numbers
  if (removeNumbers) {
    words = words.filter((word) => !/^\d+$/.test(word));
  }

  // Return unique words
  return [...new Set(words)];
}

/**
 * Cleans and normalizes text for processing.
 *
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
function cleanText(text) {
  return String(text)
    .replace(/\s+/g, " ")           // Normalize whitespace
    .replace(/[^\w\s.,!?;:'"()-]/g, "") // Remove special chars
    .trim();
}

/**
 * Truncates text to a maximum length, preserving word boundaries.
 *
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} [suffix="..."] - Suffix to add if truncated
 * @returns {string} Truncated text
 */
function truncateText(text, maxLength, suffix = "...") {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.slice(0, maxLength - suffix.length);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + suffix;
  }

  return truncated + suffix;
}

module.exports = {
  STOP_WORDS,
  decodeHtmlEntities,
  chunkText,
  extractKeywords,
  cleanText,
  truncateText,
};