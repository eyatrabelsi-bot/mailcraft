// background.js
// Runs in its own isolated context, NOT subject to mail.google.com's CSP.
// This is why the fetch to your backend happens here instead of in content.js.

const BACKEND_URL = "https://your-backend.example.com/api/classify"; // <-- point this at your real MailCraft AI backend

// Simple in-memory cache so we don't re-classify the same email every time
// Gmail re-renders a row (which it does often, e.g. on scroll).
const classificationCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CLASSIFY_EMAIL") return false;

  const { threadId, subject, sender: emailSender, snippet } = message.payload;

  if (classificationCache.has(threadId)) {
    sendResponse({ ok: true, result: classificationCache.get(threadId) });
    return true;
  }

  fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, subject, sender: emailSender, snippet }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      return res.json();
    })
    .then((data) => {
      // Expected shape from your backend, adjust to match reality:
      // { label: "Urgent" | "Newsletter" | "Follow-up" | ..., confidence: 0-1 }
      classificationCache.set(threadId, data);
      sendResponse({ ok: true, result: data });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });

  // Required: keep the message channel open for the async response above.
  return true;
});