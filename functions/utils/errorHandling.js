/**
 * =============================================================================
 * Error Handling Utilities
 * =============================================================================
 *
 * @fileoverview Centralized error handling for Cloud Functions.
 *               Provides safe error messages for users while logging details.
 *
 * @author       Your Name
 * @version      2.0.0
 *
 * =============================================================================
 */

const { HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

/**
 * Converts any error to a safe HttpsError for client consumption.
 *
 * @description
 * Security: Internal error details are logged but NOT exposed to clients.
 * Users receive friendly, generic error messages.
 *
 * @param {Error} err - Original error
 * @param {string} [fallbackMessage] - Message to show if error is unknown
 * @returns {HttpsError} Safe error to return to client
 */
function toSafeHttpsError(
  err,
  fallbackMessage = "Something went wrong. Please try again later."
) {
  // If already an HttpsError, it's already safe
  if (err instanceof HttpsError) {
    return err;
  }

  // Return generic message for unknown errors
  return new HttpsError("internal", fallbackMessage);
}

/**
 * Maps RapidAPI HTTP errors to user-friendly messages.
 *
 * @param {number} status - HTTP status code
 * @param {string} bodyText - Response body (for logging only)
 * @returns {HttpsError} User-safe error
 */
function rapidApiErrorToHttpsError(status, bodyText) {
  // Log the actual error for debugging
  logger.warn("RapidAPI error", { status, bodyPreview: bodyText.slice(0, 200) });

  const errorMap = {
    401: { code: "permission-denied", message: "Transcript service authentication failed." },
    403: { code: "permission-denied", message: "Transcript provider rejected the request." },
    404: { code: "not-found", message: "Transcript not found (video may not have captions)." },
    429: { code: "resource-exhausted", message: "Too many requests. Please try again later." },
    500: { code: "unavailable", message: "Transcript service is temporarily unavailable." },
    502: { code: "unavailable", message: "Transcript service is temporarily unavailable." },
    503: { code: "unavailable", message: "Transcript service is temporarily unavailable." },
  };

  const error = errorMap[status] || {
    code: "unavailable",
    message: "Transcript service is currently unavailable.",
  };

  return new HttpsError(error.code, error.message);
}

/**
 * Maps OpenAI API errors to user-friendly messages.
 *
 * @param {Error} err - OpenAI error
 * @returns {HttpsError} User-safe error
 */
function openAiErrorToHttpsError(err) {
  const status = err?.status || err?.response?.status;

  // Log the actual error
  logger.warn("OpenAI error", { status, message: err?.message });

  const errorMap = {
    401: { code: "failed-precondition", message: "AI service is not configured correctly." },
    403: { code: "failed-precondition", message: "AI service access denied." },
    429: { code: "resource-exhausted", message: "AI service is busy. Please try again." },
    500: { code: "unavailable", message: "AI service is temporarily unavailable." },
    502: { code: "unavailable", message: "AI service is temporarily unavailable." },
    503: { code: "unavailable", message: "AI service is temporarily unavailable." },
  };

  if (status && errorMap[status]) {
    const error = errorMap[status];
    return new HttpsError(error.code, error.message);
  }

  return new HttpsError("internal", "Failed to generate an answer. Please try again.");
}

/**
 * Validates a required string field.
 *
 * @param {*} value - Value to validate
 * @param {string} fieldName - Name of field (for error messages)
 * @param {Object} [options] - Validation options
 * @param {number} [options.min=1] - Minimum length
 * @param {number} [options.max=10000] - Maximum length
 * @returns {string} Trimmed, validated string
 * @throws {HttpsError} If validation fails
 */
function requireString(value, fieldName, options = {}) {
  const { min = 1, max = 10000 } = options;

  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${fieldName} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length < min) {
    throw new HttpsError("invalid-argument", `${fieldName} is required`);
  }

  if (trimmed.length > max) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} is too long (max ${max} characters)`
    );
  }

  return trimmed;
}

module.exports = {
  toSafeHttpsError,
  rapidApiErrorToHttpsError,
  openAiErrorToHttpsError,
  requireString,
};