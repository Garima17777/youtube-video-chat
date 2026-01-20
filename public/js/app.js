/**
 * =============================================================================
 * YouTube Video Chat - Frontend Application
 * =============================================================================
 *
 * @fileoverview Main JavaScript file for the YouTube Video Chat application.
 *               Handles Firebase initialization, UI state management, and
 *               communication with Cloud Functions.
 *
 * @author       Garima Chouhan
 * @version      1.0.0
 * @license      MIT
 *
 * @description
 * This application allows users to:
 * 1. Fetch transcripts from YouTube videos via Cloud Functions
 * 2. Ask AI-powered questions about the video content
 * 3. View real-time chat history synced with Firestore
 *
 * @dependencies
 * - Firebase SDK v10+ (App, Functions, Firestore)
 * - Marked.js (Markdown to HTML conversion)
 * - DOMPurify (XSS sanitization)
 *
 * @security
 * - All user input is escaped before rendering
 * - AI responses are sanitized with DOMPurify
 * - Firebase config is public (security via Firestore rules)
 * - Sensitive operations happen in Cloud Functions
 *
 * =============================================================================
 */

// =============================================================================
// MODULE IMPORTS
// =============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Firebase project configuration.
 *
 * @description
 * This configuration object is safe to expose publicly. Security is enforced via:
 * - Firestore security rules (restrict read/write access)
 * - Cloud Functions (secrets stored in Secret Manager)
 * - API key restrictions (domain whitelist in Google Cloud Console)
 *
 * @see https://firebase.google.com/docs/projects/api-keys
 *
 * @constant {Object}
 */
const FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyBpqa58Ozvu95sepgEDwFocF3wVbAEXBJo",
  authDomain: "yt-assignment-001.firebaseapp.com",
  projectId: "yt-assignment-001",
  storageBucket: "yt-assignment-001.firebasestorage.app",
  messagingSenderId: "730454142237",
  appId: "1:730454142237:web:53be47dbd82afdc36685f4",
});

/**
 * Cloud Functions region.
 *
 * @description
 * Functions are deployed to asia-south2 (Delhi, India) to match
 * the Firestore database location for optimal latency.
 *
 * @constant {string}
 */
const FUNCTIONS_REGION = "asia-south2";

/**
 * Local emulator configuration.
 *
 * @constant {Object}
 */
const EMULATOR_CONFIG = Object.freeze({
  functions: { host: "127.0.0.1", port: 5001 },
  firestore: { host: "127.0.0.1", port: 8080 },
});

// =============================================================================
// FIREBASE INITIALIZATION
// =============================================================================

/**
 * Initialize Firebase application.
 */
const app = initializeApp(FIREBASE_CONFIG);

/**
 * Initialize Firebase Functions with the correct region.
 *
 * @important The region MUST match where functions are deployed,
 *            otherwise CORS errors will occur.
 */
const functions = getFunctions(app, FUNCTIONS_REGION);

/**
 * Initialize Firestore database.
 */
const firestore = getFirestore(app);

/**
 * Connect to local emulators in development environment.
 *
 * @description
 * When running on localhost, connect to Firebase emulators
 * instead of production services. This allows local testing
 * without affecting production data or incurring API costs.
 */
if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
  console.info("🔧 Development mode: Connecting to Firebase emulators...");

  connectFunctionsEmulator(
    functions,
    EMULATOR_CONFIG.functions.host,
    EMULATOR_CONFIG.functions.port
  );

  connectFirestoreEmulator(
    firestore,
    EMULATOR_CONFIG.firestore.host,
    EMULATOR_CONFIG.firestore.port
  );
}

// =============================================================================
// CLOUD FUNCTION REFERENCES
// =============================================================================

/**
 * Cloud Function: Fetch transcript from YouTube video.
 *
 * @function fetchTranscriptFn
 * @param {Object} data - Function parameters
 * @param {string} data.videoUrl - YouTube video URL or ID
 * @returns {Promise<{videoId: string, transcriptLength: number}>}
 * @throws {FirebaseError} On invalid input or API failure
 */
const fetchTranscriptFn = httpsCallable(functions, "fetchTranscript");

/**
 * Cloud Function: Ask a question about the video.
 *
 * @function askQuestionFn
 * @param {Object} data - Function parameters
 * @param {string} data.videoId - YouTube video ID
 * @param {string} data.question - User's question
 * @returns {Promise<{answer: string}>}
 * @throws {FirebaseError} On invalid input or API failure
 */
const askQuestionFn = httpsCallable(functions, "askQuestion");

// =============================================================================
// APPLICATION STATE
// =============================================================================

/**
 * Application state object.
 *
 * @description
 * Centralized state management for the application.
 * Using a single state object makes it easier to track and debug.
 *
 * @type {Object}
 * @property {string|null} currentVideoId - Currently loaded video ID
 * @property {Array<{question: string, answer: string}>} chatHistory - Chat messages
 * @property {Function|null} unsubscribeFirestore - Firestore listener cleanup
 * @property {boolean} isLoading - Loading state for async operations
 */
const state = {
  currentVideoId: null,
  chatHistory: [],
  unsubscribeFirestore: null,
  isLoading: false,
};

// =============================================================================
// DOM ELEMENT REFERENCES
// =============================================================================

/**
 * Cached DOM element references.
 *
 * @description
 * Caching DOM elements improves performance by avoiding
 * repeated document queries.
 *
 * @type {Object}
 */
const elements = Object.freeze({
  // Video URL input section
  videoUrlInput: document.getElementById("videoUrl"),
  fetchBtn: document.getElementById("btnFetch"),
  fetchStatus: document.getElementById("fetchStatus"),

  // Video info bar
  videoInfo: document.getElementById("videoInfo"),
  videoIdBadge: document.getElementById("videoIdBadge"),
  videoInfoText: document.getElementById("videoInfoText"),

  // Chat interface
  chatContainer: document.getElementById("chatContainer"),
  clearBtn: document.getElementById("btnClear"),
  questionInput: document.getElementById("question"),
  askBtn: document.getElementById("btnAsk"),
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

/**
 * Error code to user-friendly message mapping.
 *
 * @description
 * Maps Firebase/Cloud Function error codes to user-friendly messages.
 * Internal error details are never exposed to users for security.
 *
 * @constant {Object<string, string>}
 */
const ERROR_MESSAGES = Object.freeze({
  "invalid-argument": "Please check your input and try again.",
  "not-found": "Transcript not found (video may not have captions).",
  "failed-precondition": "Service not ready. Please try later.",
  "permission-denied": "Service temporarily unavailable. Please try later.",
  "resource-exhausted": "Too many requests. Please wait and try again.",
  unavailable: "Service is currently unavailable. Please try again.",
  internal: "Something went wrong. Please try again.",
});

/**
 * Converts Firebase error codes to user-friendly messages.
 *
 * @param {Error} error - Error object from Firebase
 * @returns {string} User-friendly error message
 *
 * @example
 * try {
 *   await fetchTranscriptFn({ videoUrl });
 * } catch (err) {
 *   showStatus(getFriendlyErrorMessage(err), 'error');
 * }
 */
function getFriendlyErrorMessage(error) {
  const errorCode = error?.code || "";

  // Check each known error code
  for (const [code, message] of Object.entries(ERROR_MESSAGES)) {
    if (errorCode.includes(code)) {
      return message;
    }
  }

  // Default fallback message
  return "Something went wrong. Please try again.";
}

// =============================================================================
// SECURITY UTILITIES
// =============================================================================

/**
 * Escapes HTML special characters to prevent XSS attacks.
 *
 * @description
 * Used for user-generated content (questions) that will be
 * inserted into the DOM. This prevents malicious HTML/JS injection.
 *
 * @param {string} text - Raw text to escape
 * @returns {string} HTML-safe escaped text
 *
 * @example
 * escapeHtml('<script>alert("XSS")</script>')
 * // Returns: '&lt;script&gt;alert("XSS")&lt;/script&gt;'
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Renders markdown text to sanitized HTML.
 *
 * @description
 * Converts AI-generated markdown responses to HTML for display.
 * Uses DOMPurify to sanitize the output and prevent XSS attacks.
 *
 * Security flow:
 * 1. Marked.js converts markdown → raw HTML
 * 2. DOMPurify sanitizes HTML (removes scripts, event handlers, etc.)
 * 3. Safe HTML is returned for rendering
 *
 * @param {string} text - Markdown text from AI response
 * @returns {string} Sanitized HTML string
 *
 * @example
 * renderMarkdown('**Hello** world')
 * // Returns: '<p><strong>Hello</strong> world</p>'
 */
function renderMarkdown(text) {
  // Handle "Thinking..." placeholder with animation
  if (text === "Thinking...") {
    return `
      <div class="thinking">
        <span>Thinking</span>
        <div class="thinking__dot"></div>
        <div class="thinking__dot"></div>
        <div class="thinking__dot"></div>
      </div>
    `;
  }

  // Check if Marked.js is available
  if (typeof marked !== "undefined" && typeof marked.parse === "function") {
    try {
      // Configure Marked.js for GitHub-Flavored Markdown
      marked.setOptions({
        breaks: true, // Convert \n to <br>
        gfm: true, // GitHub-Flavored Markdown
      });

      // Convert markdown to HTML
      const rawHtml = marked.parse(String(text));

      // Sanitize HTML with DOMPurify to prevent XSS
      if (typeof DOMPurify !== "undefined") {
        return DOMPurify.sanitize(rawHtml, {
          ALLOWED_TAGS: [
            "p", "br", "strong", "em", "b", "i", "u",
            "h1", "h2", "h3", "h4", "h5", "h6",
            "ul", "ol", "li",
            "pre", "code",
            "blockquote",
            "a",
          ],
          ALLOWED_ATTR: ["href", "target", "rel"],
        });
      }

      // Fallback if DOMPurify not available (should not happen)
      console.warn("DOMPurify not available - falling back to escaped text");
      return escapeHtml(String(text));
    } catch (error) {
      console.error("Markdown parsing error:", error);
      return escapeHtml(String(text));
    }
  }

  // Fallback if Marked.js not available
  return escapeHtml(String(text));
}

// =============================================================================
// UI FUNCTIONS
// =============================================================================

/**
 * Shows a status message to the user.
 *
 * @param {string} message - Message text to display
 * @param {"success" | "error" | "info"} type - Message type for styling
 *
 * @example
 * showStatus('Transcript fetched successfully!', 'success');
 * showStatus('Please enter a valid URL', 'error');
 */
function showStatus(message, type) {
  elements.fetchStatus.textContent = message;
  elements.fetchStatus.className = `status status--show status--${type}`;
}

/**
 * Hides the status message.
 */
function hideStatus() {
  elements.fetchStatus.className = "status";
}

/**
 * Enables the chat interface after a transcript is loaded.
 *
 * @description
 * Called after successfully fetching a transcript.
 * Enables the question input and updates the video info bar.
 */
function enableChat() {
  elements.questionInput.disabled = false;
  elements.askBtn.disabled = false;
  elements.videoInfo.className = "video-info video-info--show";
  elements.videoIdBadge.textContent = state.currentVideoId;
  elements.videoInfoText.textContent = "Transcript loaded! Start chatting.";
}

/**
 * Disables the chat interface during loading.
 *
 * @description
 * Prevents user interaction while async operations are in progress.
 */
function disableChat() {
  elements.questionInput.disabled = true;
  elements.askBtn.disabled = true;
}

/**
 * Renders the chat history to the DOM.
 *
 * @description
 * Clears the chat container and re-renders all messages.
 * Called whenever the chat history changes.
 */
function renderChat() {
  // Handle empty state
  if (state.chatHistory.length === 0) {
    elements.chatContainer.innerHTML = `
      <div class="empty-chat">
        <div class="empty-chat__icon">💬</div>
        <p>No messages yet. Ask a question to start!</p>
      </div>
    `;
    elements.clearBtn.classList.add("hidden");
    return;
  }

  // Show clear button
  elements.clearBtn.classList.remove("hidden");

  // Render messages
  elements.chatContainer.innerHTML = state.chatHistory
    .map(
      (msg) => `
      <div class="chat-message chat-message--user">
        <div class="chat-message__label">You</div>
        <div class="chat-message__bubble">${escapeHtml(msg.question)}</div>
      </div>
      <div class="chat-message chat-message--assistant">
        <div class="chat-message__label">AI Assistant</div>
        <div class="chat-message__bubble">${renderMarkdown(msg.answer)}</div>
      </div>
    `
    )
    .join("");

  // Auto-scroll to the bottom
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

// =============================================================================
// FIRESTORE FUNCTIONS
// =============================================================================

/**
 * Subscribes to real-time updates for chat messages.
 *
 * @description
 * Sets up a Firestore listener that updates the UI whenever
 * new messages are added to the database. This enables real-time
 * sync across multiple tabs/devices.
 *
 * @param {string} videoId - YouTube video ID to subscribe to
 */
function subscribeToMessages(videoId) {
  // Clean up previous subscription
  if (state.unsubscribeFirestore) {
    state.unsubscribeFirestore();
  }

  // Create query for messages ordered by creation time
  const messagesRef = collection(firestore, "videos", videoId, "messages");
  const messagesQuery = query(messagesRef, orderBy("createdAt", "asc"));

  // Subscribe to real-time updates
  state.unsubscribeFirestore = onSnapshot(
    messagesQuery,
    (snapshot) => {
      // Rebuild chat history from Firestore documents
      state.chatHistory = snapshot.docs.map((doc) => ({
        question: doc.data().question,
        answer: doc.data().answer,
      }));

      // Re-render the chat UI
      renderChat();
    },
    (error) => {
      console.error("Firestore subscription error:", error);
    }
  );
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handles the "Fetch Transcript" button click.
 *
 * @async
 * @description
 * 1. Validates the input URL
 * 2. Calls the fetchTranscript Cloud Function
 * 3. Updates UI on success/failure
 * 4. Subscribes to chat messages for the video
 */
async function handleFetchTranscript() {
  // Validate input
  const videoUrl = elements.videoUrlInput.value.trim();

  if (!videoUrl) {
    showStatus("Please enter a YouTube URL", "error");
    return;
  }

  // Prevent duplicate requests
  if (state.isLoading) return;

  // Update UI state
  state.isLoading = true;
  showStatus("Fetching transcript... This may take a few seconds.", "info");
  state.chatHistory = [];
  renderChat();

  try {
    // Call Cloud Function
    const result = await fetchTranscriptFn({ videoUrl });

    // Update state
    state.currentVideoId = result.data.videoId;

    // Show success message
    const charCount = result.data.transcriptLength.toLocaleString();
    showStatus(`✅ Transcript fetched! (${charCount} characters)`, "success");

    // Enable chat and subscribe to messages
    enableChat();
    subscribeToMessages(state.currentVideoId);

    // Auto-hide success message
    setTimeout(hideStatus, 3000);
  } catch (error) {
    console.error("Fetch transcript error:", error);
    showStatus("❌ " + getFriendlyErrorMessage(error), "error");
  } finally {
    state.isLoading = false;
  }
}

/**
 * Handles the "Ask Question" button click.
 *
 * @async
 * @description
 * 1. Validates the input question
 * 2. Shows optimistic UI with "Thinking..." placeholder
 * 3. Calls the askQuestion Cloud Function
 * 4. Updates the message with the real answer
 */
async function handleAskQuestion() {
  // Validate state
  if (!state.currentVideoId) return;

  // Validate input
  const question = elements.questionInput.value.trim();
  if (!question) return;

  // Prevent duplicate requests
  if (state.isLoading) return;

  // Optimistic UI: show user message immediately
  state.chatHistory.push({ question, answer: "Thinking..." });
  renderChat();

  // Clear input and disable while processing
  elements.questionInput.value = "";
  disableChat();
  state.isLoading = true;

  try {
    // Call Cloud Function
    const result = await askQuestionFn({
      videoId: state.currentVideoId,
      question,
    });

    // Update the last message with the real answer
    state.chatHistory[state.chatHistory.length - 1].answer = result.data.answer;
    renderChat();
  } catch (error) {
    console.error("Ask question error:", error);

    // Update the last message with error
    state.chatHistory[state.chatHistory.length - 1].answer =
      "❌ " + getFriendlyErrorMessage(error);
    renderChat();
  } finally {
    // Re-enable chat
    enableChat();
    state.isLoading = false;
    elements.questionInput.focus();
  }
}

/**
 * Handles the "Clear Chat" button click.
 *
 * @description
 * Clears the local chat history. Note: This does NOT delete
 * messages from Firestore.
 */
function handleClearChat() {
  state.chatHistory = [];
  renderChat();
}

/**
 * Handles Enter key press in the question input.
 *
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleQuestionKeypress(event) {
  if (event.key === "Enter" && !elements.askBtn.disabled) {
    handleAskQuestion();
  }
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

/**
 * Attach event listeners to DOM elements.
 *
 * @description
 * Using addEventListener instead of inline handlers for:
 * - Better separation of concerns
 * - Easier debugging
 * - Ability to remove listeners if needed
 */
elements.fetchBtn.addEventListener("click", handleFetchTranscript);
elements.askBtn.addEventListener("click", handleAskQuestion);
elements.clearBtn.addEventListener("click", handleClearChat);
elements.questionInput.addEventListener("keypress", handleQuestionKeypress);

// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Application initialization log.
 *
 * @description
 * Logs initialization info to the console for debugging.
 * Only includes non-sensitive information.
 */
console.info("🎬 YouTube Video Chat initialized");
console.info(`📍 Functions region: ${FUNCTIONS_REGION}`);
console.info(`🔥 Project: ${FIREBASE_CONFIG.projectId}`);

// =============================================================================
// END OF FILE
// =============================================================================