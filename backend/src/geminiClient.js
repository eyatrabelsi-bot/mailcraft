const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not set. Check your .env file.');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

/**
 * Send a conversation to Gemini and get back plain text.
 * @param {string} systemPrompt - system instructions (MailCraft AI's role)
 * @param {Array<{role: 'user'|'assistant', content: string}>} messages
 */
async function callGemini(systemPrompt, messages) {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: systemPrompt,
  });

  // Gemini's chat history uses "model" instead of "assistant", and wraps
  // text in a `parts` array — so we translate our simpler format into that.
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);

  return result.response.text();
}

/**
 * Same as callGemini, but strips markdown fences and parses JSON.
 * Used by routes that need structured output (classify, match).
 */
async function callGeminiForJSON(systemPrompt, messages) {
  const raw = await callGemini(systemPrompt, messages);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { callGemini, callGeminiForJSON, MODEL_NAME };