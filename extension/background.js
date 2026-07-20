// background.js
// Runs in its own isolated context, NOT subject to mail.google.com's CSP.
// This is why the fetch to your backend happens here instead of in content.js.

// Your existing endpoint (server.ts line ~567). Takes { body } and returns
// { urgency: "Important" | "Medium" | "Faible", tag: string }.
// No auth needed — this route doesn't check req.session, unlike the
// /api/gmail/* routes, so no cookies/credentials required here.
const BACKEND_URL = "http://localhost:3000/api/triage";

// --- Persistent classification cache --------------------------------------
// IMPORTANT: this is a Manifest V3 background *service worker*, not a
// long-lived background page. Chrome unloads it after ~30s of inactivity
// and restarts it fresh on the next event (e.g. Gmail syncing new mail).
// A plain in-memory Map does NOT survive that restart — every restart was
// silently wiping all cached classifications, which is why a new-mail
// arrival (which also makes Gmail rebuild its row DOM wholesale) caused
// the *entire* visible inbox to re-classify from scratch instead of just
// the new row. chrome.storage.local persists across restarts, so we use
// it as the source of truth, with an in-memory Map as a same-tick cache
// on top of it while the worker happens to be alive.
const STORAGE_KEY = "mailcraft_classification_cache";
const MAX_CACHE_ENTRIES = 1000; // bound growth; oldest entries evicted first

const classificationCache = new Map();
let cacheLoaded = false;
let cacheLoadPromise = null;

function loadCacheFromStorage() {
  if (cacheLoadPromise) return cacheLoadPromise;
  cacheLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY] || {};
      for (const [threadId, value] of Object.entries(stored)) {
        classificationCache.set(threadId, value);
      }
      cacheLoaded = true;
      resolve();
    });
  });
  return cacheLoadPromise;
}

function persistCache() {
  // Evict oldest entries (Map preserves insertion order) once we exceed
  // the cap, so storage.local doesn't grow unbounded over time.
  while (classificationCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = classificationCache.keys().next().value;
    classificationCache.delete(oldestKey);
  }
  const asObject = Object.fromEntries(classificationCache);
  chrome.storage.local.set({ [STORAGE_KEY]: asObject });
}
// ---------------------------------------------------------------------------

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

  (async () => {
    // On a cold service-worker start, the Map starts empty until storage
    // finishes loading — wait for that first so we don't miss a real hit.
    if (!cacheLoaded) await loadCacheFromStorage();

    if (classificationCache.has(threadId)) {
      sendResponse({ ok: true, result: classificationCache.get(threadId) });
      return;
    }

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
      persistCache();
      sendResponse({ ok: true, result: data });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  // Required: keep the message channel open for the async response above.
  return true;
});

// --- Summary endpoint (thread view, injected above the real body) --------
// Same shape of problem as the classification cache above: this is still
// the same service worker, so it gets unloaded/restarted just as
// aggressively. Reusing the classification cache's key would collide
// (different payload shape), so this gets its own storage key + Map.
const SUMMARY_BACKEND_URL = "http://localhost:3000/api/summary";
const SUMMARY_STORAGE_KEY = "mailcraft_summary_cache";
const MAX_SUMMARY_CACHE_ENTRIES = 500;

const summaryCache = new Map();
let summaryCacheLoaded = false;
let summaryCacheLoadPromise = null;

function loadSummaryCacheFromStorage() {
  if (summaryCacheLoadPromise) return summaryCacheLoadPromise;
  summaryCacheLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get([SUMMARY_STORAGE_KEY], (result) => {
      const stored = result[SUMMARY_STORAGE_KEY] || {};
      for (const [threadId, value] of Object.entries(stored)) {
        summaryCache.set(threadId, value);
      }
      summaryCacheLoaded = true;
      resolve();
    });
  });
  return summaryCacheLoadPromise;
}

function persistSummaryCache() {
  while (summaryCache.size > MAX_SUMMARY_CACHE_ENTRIES) {
    const oldestKey = summaryCache.keys().next().value;
    summaryCache.delete(oldestKey);
  }
  const asObject = Object.fromEntries(summaryCache);
  chrome.storage.local.set({ [SUMMARY_STORAGE_KEY]: asObject });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SUMMARIZE_EMAIL") return false;

  // content.js sends the FULL body text scraped directly from the open
  // thread's rendered DOM (div.a3s) — Gmail has already fetched and
  // rendered it at that point, so there's no need to hit the Gmail API
  // again here the way CLASSIFY_EMAIL does for the list view.
  const { threadId, body } = message.payload;

  (async () => {
    if (!summaryCacheLoaded) await loadSummaryCacheFromStorage();

    if (summaryCache.has(threadId)) {
      sendResponse({ ok: true, result: summaryCache.get(threadId) });
      return;
    }

    try {
      // Forward threadId as `gmailId` so the backend can cache/dedupe this
      // summary against the exact same email being summarized from the
      // MailCraft app (App.tsx) — that's what keeps both surfaces showing
      // the identical text instead of two independent (and non-
      // deterministic) AI calls producing different wording.
      const res = await fetch(SUMMARY_BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, gmailId: threadId }),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = await res.json(); // Real shape from /api/summary: { summary }
      summaryCache.set(threadId, data);
      persistSummaryCache();
      sendResponse({ ok: true, result: data });
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();

  // Required: keep the message channel open for the async response above.
  return true;
});