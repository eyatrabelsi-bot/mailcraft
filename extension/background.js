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

// --- Full-body fetch via the extension's OWN Gmail OAuth token -----------
// We deliberately do NOT reuse the web app's backend session (server.ts's
// express-session cookie is SameSite: Lax, and a background-worker fetch
// to a different origin is cross-site, so the cookie wouldn't be sent
// anyway without weakening session security). Instead the extension gets
// its own token via chrome.identity and talks to the Gmail API directly.
// This requires:
//   1. manifest.json: "identity" permission + an "oauth2" block with a
//      client_id and the gmail.readonly scope
//   2. manifest.json: host_permissions including
//      "https://gmail.googleapis.com/*"
// See the manifest.json diff alongside this file.

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token"));
        return;
      }
      resolve(token);
    });
  });
}

// Same base64url decode + multi-part walk server.ts does for /api/gmail/inbox
// (kept in sync with the extractBody logic there) — plain text, then
// falls back to nothing if the thread is HTML-only.
function extractPlainTextBody(payload) {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return atob(payload.body.data.replace(/-/g, "+").replace(/_/g, "/"));
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const result = extractPlainTextBody(part);
      if (result) return result;
    }
  }
  return "";
}

async function fetchFullBody(threadId) {
  const token = await getAuthToken();
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Gmail API returned ${res.status}`);
  const thread = await res.json();

  // Use the most recent message in the thread — closest to what a person
  // actually cares about triaging (matches list-view ordering).
  const messages = thread.messages || [];
  const latest = messages[messages.length - 1];
  return extractPlainTextBody(latest?.payload) || "";
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CLASSIFY_EMAIL") return false;

  const { threadId, body: snippetBody } = message.payload;

  if (classificationCache.has(threadId)) {
    sendResponse({ ok: true, result: classificationCache.get(threadId) });
    return true;
  }

  (async () => {
    // Try to get the real full body first; if Gmail API/auth fails for
    // any reason, fall back to the subject+snippet content.js already
    // scraped, rather than failing the row outright. Full body gives a
    // much better classification (catches things like purge/deadline
    // warnings that a truncated snippet misses entirely), but degraded
    // triage beats no triage.
    let body = snippetBody;
    try {
      const fullBody = await fetchFullBody(threadId);
      if (fullBody) body = fullBody;
    } catch (err) {
      console.warn("[MailCraft] Full-body fetch failed, using snippet:", err.message);
    }

    try {
      const res = await fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = await res.json();
      // Real shape from /api/triage: { urgency, tag }
      classificationCache.set(threadId, data);
      sendResponse({ ok: true, result: data });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  // Required: keep the message channel open for the async response above.
  return true;
});