// background.js
// Runs in its own isolated context, NOT subject to mail.google.com's CSP.
// This is why the fetch to your backend happens here instead of in content.js.

// Your existing endpoint (server.ts line ~567). Takes { body } and returns
// { urgency: "Important" | "Medium" | "Faible", tag: string }.
// No auth needed — this route doesn't check req.session, unlike the
// /api/gmail/* routes, so no cookies/credentials required here.
const BACKEND_URL = "http://localhost:3000/api/triage";

// Simple in-memory cache so we don't re-classify the same email every time
// Gmail re-renders a row (which it does often, e.g. on scroll).
const classificationCache = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CLASSIFY_EMAIL") return false;

  const { threadId, body } = message.payload;

  if (classificationCache.has(threadId)) {
    sendResponse({ ok: true, result: classificationCache.get(threadId) });
    return true;
  }

  fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      return res.json();
    })
    .then((data) => {
      // Real shape from /api/triage: { urgency, tag }
      classificationCache.set(threadId, data);
      sendResponse({ ok: true, result: data });
    })
    .catch((err) => {
      sendResponse({ ok: false, error: err.message });
    });

  // Required: keep the message channel open for the async response above.
  return true;
});