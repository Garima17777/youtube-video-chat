/**
 * =============================================================================
 * Prompt Templates
 * =============================================================================
 *
 * @fileoverview Centralized prompt templates for LLM interactions.
 *               Using templates makes prompts easier to test and iterate.
 *
 * @author       Your Name
 * @version      2.0.0
 *
 * =============================================================================
 */

/**
 * System prompt for the Q&A assistant.
 *
 * @description
 * This prompt sets the behavior and constraints for the AI.
 * Key elements:
 * - Only use provided context (reduces hallucination)
 * - Admit when information is not available
 * - Use structured formatting
 * - Express uncertainty when appropriate
 *
 * @constant {string}
 */
const SYSTEM_PROMPT = `You are a helpful assistant that answers questions about YouTube videos based on their transcripts.

## CRITICAL RULES:
1. ONLY use information from the provided transcript context
2. If the answer is NOT in the context, say "I couldn't find this information in the video"
3. NEVER make up or infer information that isn't explicitly stated
4. When quoting the video, use quotation marks
5. If you're unsure, express your uncertainty

## FORMATTING:
- Use **bold** for key terms and important points
- Use bullet points (-) for lists
- Use numbered lists (1. 2. 3.) for steps or sequences
- Use headings (##) for longer answers with multiple sections
- Keep answers concise but complete

## CONFIDENCE:
- If the context clearly answers the question: provide a confident answer
- If the context partially answers: provide what you can and note what's missing
- If the context doesn't contain the answer: clearly state this`;

/**
 * Generates the user prompt for Q&A.
 *
 * @param {string} context - Relevant transcript chunks
 * @param {string} question - User's question
 * @returns {string} Formatted user prompt
 */
function generateUserPrompt(context, question) {
  return `## TRANSCRIPT CONTEXT:
${context}

---

## QUESTION:
${question}

---

## YOUR ANSWER:
Based on the transcript context above, provide a clear and accurate answer. Remember:
- Only use information from the context
- If the answer isn't in the context, say so
- Quote relevant parts when helpful`;
}

/**
 * Generates a prompt for answer validation/re-ranking.
 *
 * @description
 * This prompt asks the model to evaluate if its answer is well-supported
 * by the context, helping to reduce hallucination.
 *
 * @param {string} context - Original context
 * @param {string} question - Original question
 * @param {string} answer - Generated answer to validate
 * @returns {string} Validation prompt
 */
function generateValidationPrompt(context, question, answer) {
  return `## TASK: Validate this answer

## CONTEXT:
${context}

## QUESTION:
${question}

## GENERATED ANSWER:
${answer}

## VALIDATION:
Rate the answer on these criteria (1-5 scale):

1. **ACCURACY**: Is the answer factually correct based on the context?
2. **COMPLETENESS**: Does the answer fully address the question?
3. **GROUNDING**: Is every claim in the answer supported by the context?
4. **HALLUCINATION**: Does the answer include any information NOT in the context?

Then provide:
- Overall score (1-5)
- Brief explanation
- Revised answer if needed (only if the original has issues)

Format your response as:
ACCURACY: [1-5]
COMPLETENESS: [1-5]
GROUNDING: [1-5]
HALLUCINATION_FREE: [1-5]
OVERALL: [1-5]
EXPLANATION: [brief explanation]
REVISED_ANSWER: [only if needed, otherwise "N/A"]`;
}

/**
 * Generates a prompt for summarizing long transcripts.
 *
 * @param {string} transcript - Full transcript text
 * @param {number} [maxLength=500] - Maximum summary length in words
 * @returns {string} Summary prompt
 */
function generateSummaryPrompt(transcript, maxLength = 500) {
  return `Summarize this video transcript in ${maxLength} words or less.

## TRANSCRIPT:
${transcript}

## SUMMARY:
Provide a clear, comprehensive summary that covers:
1. Main topic/theme
2. Key points discussed
3. Important takeaways

Format with bullet points for easy reading.`;
}

module.exports = {
  SYSTEM_PROMPT,
  generateUserPrompt,
  generateValidationPrompt,
  generateSummaryPrompt,
};