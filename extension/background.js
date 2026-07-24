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

// --- Full-body fetch + real label management via the extension's OWN Gmail
// OAuth token -----------------------------------------------------------
// We deliberately do NOT reuse the web app's backend session (server.ts's
// express-session cookie is SameSite: Lax, and a background-worker fetch
// to a different origin is cross-site, so the cookie wouldn't be sent
// anyway without weakening session security). Instead the extension gets
// its own token via chrome.identity and talks to the Gmail API directly.
// This requires:
//   1. manifest.json: "identity" permission + an "oauth2" block with a
//      client_id and the gmail.modify scope (readonly alone is NOT enough —
//      creating/applying labels needs write access, which is why new mail
//      classified live in Gmail was showing a badge but never actually
//      getting a real libellé before this scope was added).
//   2. manifest.json: host_permissions including
//      "https://gmail.googleapis.com/*"
// See the manifest.json diff alongside this file.

function getAuthToken(interactive = false) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "No token"));
        return;
      }
      resolve(token);
    });
  });
}

// A non-interactive getAuthToken() call silently fails (no popup, just an
// error) if the cached token doesn't yet cover a scope that was just added
// to manifest.json (like calendar.events) — Chrome will NOT prompt the
// user on its own here. Without this fallback, calendar event creation
// would fail forever after every single call, with no way for the user to
// ever grant the new permission. Falling back to an interactive request
// opens Google's consent screen once; after that's approved, subsequent
// non-interactive calls succeed normally and this branch is never hit again.
async function getAuthTokenWithConsentFallback() {
  try {
    return await getAuthToken(false);
  } catch (err) {
    console.warn(
      "[MailCraft] Silent auth failed (likely a newly-added scope not yet granted), " +
      "requesting interactive consent:", err.message
    );
    return await getAuthToken(true);
  }
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
  const token = await getAuthTokenWithConsentFallback();
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

// --- Real Gmail label creation + assignment --------------------------------
// This is the part that was MISSING before: content.js/background.js could
// classify a row and show a colored badge, but nothing ever touched the
// user's actual Gmail labels for mail encountered this way (only mail
// fetched through the separate web app's own /api/gmail/inbox polling got
// a real label, via the backend's /api/gmail/apply-label). Newly-arrived
// mail — seen live in the Gmail tab, never pulled through that other path —
// was classified (badge shown) but never actually filed under a libellé.
//
// Labels are named EXACTLY as the classification tag (e.g. "Job",
// "Meeting", "Interview") — no "MailCraft/" prefix — per requirements.
// Set to true to also remove the thread from INBOX once labeled (a real
// "move" instead of just tagging it while it stays in the inbox).
const ARCHIVE_AFTER_LABEL = false;

// Gmail label ids rarely change once created, so this cache is persisted
// the same way the classification cache is: chrome.storage.local survives
// service-worker restarts, backed by an in-memory Map for the same tick.
const LABEL_ID_STORAGE_KEY = "mailcraft_label_id_cache";
const labelIdCache = new Map(); // tag (lowercased) -> Gmail labelId
let labelCacheLoaded = false;
let labelCacheLoadPromise = null;

function loadLabelCacheFromStorage() {
  if (labelCacheLoadPromise) return labelCacheLoadPromise;
  labelCacheLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get([LABEL_ID_STORAGE_KEY], (result) => {
      const stored = result[LABEL_ID_STORAGE_KEY] || {};
      for (const [tag, labelId] of Object.entries(stored)) {
        labelIdCache.set(tag, labelId);
      }
      labelCacheLoaded = true;
      resolve();
    });
  });
  return labelCacheLoadPromise;
}

function persistLabelCache() {
  chrome.storage.local.set({ [LABEL_ID_STORAGE_KEY]: Object.fromEntries(labelIdCache) });
}

function sanitizeLabelName(tag) {
  const clean = (tag || "").trim().replace(/[\r\n]+/g, " ").slice(0, 40);
  return clean || "Email";
}

async function getOrCreateLabelId(token, tag) {
  if (!labelCacheLoaded) await loadLabelCacheFromStorage();

  const labelName = sanitizeLabelName(tag);
  const cacheKey = labelName.toLowerCase();
  const cached = labelIdCache.get(cacheKey);
  if (cached) return cached;

  const listRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) throw new Error(`Gmail labels.list returned ${listRes.status}`);
  const listData = await listRes.json();
  const existing = (listData.labels || []).find(
    (l) => (l.name || "").toLowerCase() === labelName.toLowerCase()
  );
  if (existing?.id) {
    labelIdCache.set(cacheKey, existing.id);
    persistLabelCache();
    return existing.id;
  }

  const createRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  if (!createRes.ok) throw new Error(`Gmail labels.create returned ${createRes.status}`);
  const created = await createRes.json();
  labelIdCache.set(cacheKey, created.id);
  persistLabelCache();
  return created.id;
}

// Tracks which threads already got their label applied, so a cached
// classification hit (see below) doesn't re-call the Gmail API every time
// the same row is re-scanned.
const LABELED_STORAGE_KEY = "mailcraft_labeled_threads";
const labeledThreadIds = new Set();
let labeledCacheLoaded = false;
let labeledCacheLoadPromise = null;

function loadLabeledCacheFromStorage() {
  if (labeledCacheLoadPromise) return labeledCacheLoadPromise;
  labeledCacheLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get([LABELED_STORAGE_KEY], (result) => {
      (result[LABELED_STORAGE_KEY] || []).forEach((id) => labeledThreadIds.add(id));
      labeledCacheLoaded = true;
      resolve();
    });
  });
  return labeledCacheLoadPromise;
}

function persistLabeledCache() {
  // Bound growth the same way the other caches do.
  const MAX = 2000;
  const arr = Array.from(labeledThreadIds);
  const trimmed = arr.length > MAX ? arr.slice(arr.length - MAX) : arr;
  chrome.storage.local.set({ [LABELED_STORAGE_KEY]: trimmed });
}

async function ensureThreadLabeled(threadId, tag) {
  if (!labeledCacheLoaded) await loadLabeledCacheFromStorage();
  const dedupeKey = `${threadId}:${tag}`;
  if (labeledThreadIds.has(dedupeKey)) return;

  const token = await getAuthTokenWithConsentFallback();
  const labelId = await getOrCreateLabelId(token, tag);

  const modifyRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        addLabelIds: [labelId],
        removeLabelIds: ARCHIVE_AFTER_LABEL ? ["INBOX"] : [],
      }),
    }
  );
  if (!modifyRes.ok) throw new Error(`Gmail threads.modify returned ${modifyRes.status}`);

  labeledThreadIds.add(dedupeKey);
  persistLabeledCache();
}
// ---------------------------------------------------------------------------

// --- Auto-create Google Calendar event when an email mentions a date -------
// Same rationale as the label cache above: the backend (/api/extract-date)
// does the actual date understanding (including resolving relative dates
// like "demain" / "vendredi prochain" against the email's own date), and
// this service worker uses its own Gmail/Calendar OAuth token (now scoped
// with calendar.events, see manifest.json) to write directly to the user's
// primary Google Calendar — no separate "connect calendar" step needed.
const CALENDAR_EVENT_STORAGE_KEY = "mailcraft_calendar_event_cache";
const calendarEventThreadIds = new Set(); // dedupe: never create 2 events for the same thread
let calendarCacheLoaded = false;
let calendarCacheLoadPromise = null;

function loadCalendarCacheFromStorage() {
  if (calendarCacheLoadPromise) return calendarCacheLoadPromise;
  calendarCacheLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get([CALENDAR_EVENT_STORAGE_KEY], (result) => {
      (result[CALENDAR_EVENT_STORAGE_KEY] || []).forEach((id) => calendarEventThreadIds.add(id));
      calendarCacheLoaded = true;
      resolve();
    });
  });
  return calendarCacheLoadPromise;
}

function persistCalendarCache() {
  const MAX = 2000;
  const arr = Array.from(calendarEventThreadIds);
  const trimmed = arr.length > MAX ? arr.slice(arr.length - MAX) : arr;
  chrome.storage.local.set({ [CALENDAR_EVENT_STORAGE_KEY]: trimmed });
}

// Builds a Calendar API events.insert body from what /api/extract-date
// returned. All-day events use exclusive end dates (Calendar API
// requirement), timed events default to a 1-hour duration when the email
// didn't specify one.
// Explicit reminders — without these, an inserted event uses whatever the
// calendar's OWN default reminders are (which can be "none"), so a user
// could get an event created but genuinely never be notified before it
// starts. Only "Important"-classified emails get a heads-up; everything
// else just sits quietly on the calendar as a record, with no notification
// and the calendar's normal (non-red) color.
const TIMED_EVENT_REMINDERS = {
  useDefault: false,
  overrides: [
    { method: "popup", minutes: 30 }, // 30 min before start
    { method: "email", minutes: 60 }, // 1h before start, as a backup channel
  ],
};
// All-day/deadline events have no specific start time to count back from,
// so instead of "minutes before", remind the evening before at a sensible
// hour (18:00 the prior day) using a popup the morning of as well.
const ALL_DAY_EVENT_REMINDERS = {
  useDefault: false,
  overrides: [
    { method: "popup", minutes: 12 * 60 }, // ~ the evening before / morning of
    { method: "email", minutes: 24 * 60 }, // 1 day before
  ],
};
// Explicitly no reminders at all (not "use calendar default" — an actual
// silent event) for anything not classified as Important.
const NO_REMINDERS = { useDefault: false, overrides: [] };

// Google Calendar's fixed color palette id for red ("Tomato"). See
// https://developers.google.com/calendar/api/v3/reference/colors/get —
// this id is stable across accounts, no need to look it up per-user.
const IMPORTANT_EVENT_COLOR_ID = "11";

function buildCalendarEventBody(extraction) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const isImportant = (extraction.urgency || "").toLowerCase() === "important";

  if (extraction.allDay) {
    const start = new Date(`${extraction.startDate}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1); // Calendar wants an exclusive end date
    const toDateStr = (d) => d.toISOString().slice(0, 10);
    return {
      summary: extraction.eventTitle,
      description: extraction.sourceNote || "",
      start: { date: extraction.startDate },
      end: { date: toDateStr(end) },
      reminders: isImportant ? ALL_DAY_EVENT_REMINDERS : NO_REMINDERS,
      ...(isImportant ? { colorId: IMPORTANT_EVENT_COLOR_ID } : {}),
    };
  }

  const start = new Date(extraction.startDateTime);
  const end = extraction.endDateTime
    ? new Date(extraction.endDateTime)
    : new Date(start.getTime() + 60 * 60 * 1000); // default 1h duration

  return {
    summary: extraction.eventTitle,
    description: extraction.sourceNote || "",
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    reminders: isImportant ? TIMED_EVENT_REMINDERS : NO_REMINDERS,
    ...(isImportant ? { colorId: IMPORTANT_EVENT_COLOR_ID } : {}),
  };
}

async function createCalendarEvent(eventBody) {
  const token = await getAuthTokenWithConsentFallback();
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(eventBody),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Calendar events.insert returned ${res.status}: ${text}`);
  }
  const created = await res.json();
  console.log("[MailCraft] Calendar event created:", created.htmlLink || created.id);
  return created;
}

// `classification` is the SAME object /api/triage already returned for
// this email (urgency/tag PLUS the hasEvent/startDate/etc. fields) — no
// extra network call needed. This used to hit its own /api/extract-date
// endpoint, but that doubled Gemini API requests per email and reliably
// blew through the free-tier per-minute quota (see the comment on
// /api/triage in server.ts).
async function ensureCalendarEventFromEmail(threadId, classification) {
  if (!calendarCacheLoaded) await loadCalendarCacheFromStorage();
  if (calendarEventThreadIds.has(threadId)) return; // already handled this thread

  // Mark as handled regardless of outcome so we don't re-attempt this
  // thread on every future classification (e.g. re-triggered by Gmail
  // re-rendering the row).
  calendarEventThreadIds.add(threadId);
  persistCalendarCache();

  if (!classification?.hasEvent) {
    console.log(`[MailCraft] No schedulable date detected for thread ${threadId}, skipping calendar.`);
    return;
  }

  console.log(`[MailCraft] Date detected for thread ${threadId}, creating calendar event:`, classification.eventTitle);
  const eventBody = buildCalendarEventBody(classification);
  await createCalendarEvent(eventBody);
  scheduleDeviceReminder(threadId, classification);
}
// ---------------------------------------------------------------------------

// --- Native OS/device notifications before important events ---------------
// Google Calendar's own "popup" reminder only surfaces if calendar.google.com
// is open in a tab, or the Calendar mobile app is running — it does NOT
// reach the OS notification tray on its own. chrome.alarms + chrome.notifications
// fire directly from this background service worker, independent of any open
// tab or page, as long as Chrome itself is running on the device.
const REMINDER_MINUTES_BEFORE_TIMED = 30;
const REMINDER_MINUTES_BEFORE_ALLDAY = 12 * 60; // ~evening before / morning of
const ALARM_PREFIX = "mailcraft-reminder:";

function scheduleDeviceReminder(threadId, extraction) {
  // Only "Important"-classified events get a device notification — matches
  // the same rule used for the red calendar color/reminders.
  if ((extraction.urgency || "").toLowerCase() !== "important") return;

  const eventStartMs = extraction.allDay
    ? new Date(`${extraction.startDate}T09:00:00`).getTime()
    : new Date(extraction.startDateTime).getTime();
  if (!Number.isFinite(eventStartMs)) return;

  const now = Date.now();
  if (eventStartMs <= now) return; // event already started/passed, nothing to remind about

  const offsetMinutes = extraction.allDay ? REMINDER_MINUTES_BEFORE_ALLDAY : REMINDER_MINUTES_BEFORE_TIMED;
  let reminderAt = eventStartMs - offsetMinutes * 60 * 1000;
  // Reminder threshold already passed but the event itself hasn't (e.g. we
  // only just detected an email for a meeting in 10 minutes) -> fire almost
  // immediately instead of not notifying at all.
  if (reminderAt <= now) reminderAt = now + 2000;

  const alarmName = `${ALARM_PREFIX}${threadId}`;
  const timeLabel = extraction.allDay
    ? "aujourd'hui"
    : new Date(extraction.startDateTime).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const payload = {
    title: `📅 Rappel : ${extraction.eventTitle}`,
    message: extraction.allDay
      ? `Aujourd'hui : ${extraction.eventTitle}`
      : `Dans ${offsetMinutes} min (${timeLabel}) : ${extraction.eventTitle}`,
    threadUrl: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
  };

  // chrome.alarms fires even if the payload needs to survive a service
  // worker restart in between, so the message content is persisted to
  // storage and looked up by alarm name when it actually fires.
  chrome.storage.local.set({ [`mailcraft_alarm_payload:${alarmName}`]: payload }, () => {
    chrome.alarms.create(alarmName, { when: reminderAt });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const storageKey = `mailcraft_alarm_payload:${alarm.name}`;
  chrome.storage.local.get([storageKey], (result) => {
    const payload = result[storageKey];
    chrome.storage.local.remove([storageKey]);
    if (!payload) return;
    chrome.notifications.create(alarm.name, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon128.png"),
      title: payload.title,
      message: payload.message,
      priority: 2,
      requireInteraction: true, // stays in the notification tray until the user dismisses/clicks it
    });
    chrome.storage.local.set({ [`mailcraft_notif_link:${alarm.name}`]: payload.threadUrl });
  });
});

// Clicking the notification jumps straight to the source email.
chrome.notifications.onClicked.addListener((notificationId) => {
  const linkKey = `mailcraft_notif_link:${notificationId}`;
  chrome.storage.local.get([linkKey], (result) => {
    const url = result[linkKey];
    chrome.storage.local.remove([linkKey]);
    if (url) chrome.tabs.create({ url });
    chrome.notifications.clear(notificationId);
  });
});
// ---------------------------------------------------------------------------

// --- Auto-archive + notify for aggressive/hostile emails -------------------
// Same dedupe pattern as labels/calendar: a Set backed by chrome.storage.local
// so a thread is only ever archived+notified once, even across service
// worker restarts or re-classification passes.
const AGGRESSIVE_LABEL_NAME = "⚠️ Agressif";
const AGGRESSIVE_STORAGE_KEY = "mailcraft_aggressive_handled_cache";
const aggressiveHandledThreadIds = new Set();
let aggressiveCacheLoaded = false;
let aggressiveCacheLoadPromise = null;

function loadAggressiveCacheFromStorage() {
  if (aggressiveCacheLoadPromise) return aggressiveCacheLoadPromise;
  aggressiveCacheLoadPromise = new Promise((resolve) => {
    chrome.storage.local.get([AGGRESSIVE_STORAGE_KEY], (result) => {
      (result[AGGRESSIVE_STORAGE_KEY] || []).forEach((id) => aggressiveHandledThreadIds.add(id));
      aggressiveCacheLoaded = true;
      resolve();
    });
  });
  return aggressiveCacheLoadPromise;
}

function persistAggressiveCache() {
  const MAX = 2000;
  const arr = Array.from(aggressiveHandledThreadIds);
  chrome.storage.local.set({
    [AGGRESSIVE_STORAGE_KEY]: arr.length > MAX ? arr.slice(arr.length - MAX) : arr,
  });
}

async function ensureAggressiveEmailHandled(threadId, classification) {
  if (!classification?.isAggressive) return;

  if (!aggressiveCacheLoaded) await loadAggressiveCacheFromStorage();
  if (aggressiveHandledThreadIds.has(threadId)) return; // already archived+notified

  aggressiveHandledThreadIds.add(threadId);
  persistAggressiveCache();

  const token = await getAuthTokenWithConsentFallback();
  const labelId = await getOrCreateLabelId(token, AGGRESSIVE_LABEL_NAME);

  // Tag it AND archive it (remove from inbox) in one call — this ignores
  // the ARCHIVE_AFTER_LABEL toggle above on purpose: normal classification
  // archiving is opt-in, but hiding a hostile email from the inbox is the
  // whole point of this feature regardless of that setting.
  const modifyRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ addLabelIds: [labelId], removeLabelIds: ["INBOX"] }),
    }
  );
  if (!modifyRes.ok) {
    throw new Error(`Gmail threads.modify (archive) returned ${modifyRes.status}`);
  }

  console.log(`[MailCraft] Aggressive email detected on thread ${threadId}, archived.`);

  // Immediate native OS notification — unlike scheduleDeviceReminder, this
  // fires right away (no chrome.alarms delay needed), since the point is
  // to tell the user right now that something was just hidden from them.
  chrome.notifications.create(`mailcraft-aggressive:${threadId}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title: "⚠️ Email agressif archivé automatiquement",
    message: classification.aggressiveSummary || "Un email au ton hostile a été détecté et archivé.",
    priority: 2,
    requireInteraction: true,
  });
  chrome.storage.local.set({
    [`mailcraft_notif_link:mailcraft-aggressive:${threadId}`]: `https://mail.google.com/mail/u/0/#inbox/${threadId}`,
  });
}
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "CLASSIFY_EMAIL") return false;

  const { threadId, body: snippetBody } = message.payload;

  (async () => {
    // On a cold service-worker start, the Map starts empty until storage
    // finishes loading — wait for that first so we don't miss a real hit.
    if (!cacheLoaded) await loadCacheFromStorage();

    if (classificationCache.has(threadId)) {
      const cachedResult = classificationCache.get(threadId);
      sendResponse({ ok: true, result: cachedResult });
      // Fire-and-forget: apply the real Gmail label too, in case a prior
      // run classified this thread but failed to label it (e.g. before the
      // gmail.modify permission was granted, or a transient API error).
      ensureThreadLabeled(threadId, cachedResult.tag).catch((err) => {
        console.warn("[MailCraft] Could not apply Gmail label:", err.message);
      });
      ensureCalendarEventFromEmail(threadId, cachedResult).catch((err) => {
        console.warn("[MailCraft] Could not create calendar event:", err.message);
      });
      ensureAggressiveEmailHandled(threadId, cachedResult).catch((err) => {
        console.warn("[MailCraft] Could not archive aggressive email:", err.message);
      });
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
        body: JSON.stringify({ body, referenceDate: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`Backend returned ${res.status}`);
      const data = await res.json();
      // Real shape from /api/triage: { urgency, tag, hasEvent, allDay,
      // startDate|startDateTime, endDateTime, eventTitle, sourceNote,
      // isAggressive, aggressiveSummary }
      classificationCache.set(threadId, data);
      persistCache();
      sendResponse({ ok: true, result: data });

      // Now that we have a tag, create/apply the matching real Gmail
      // label. Kept out of the try/catch above so a labeling failure
      // (e.g. permission not yet granted) never blocks the badge from
      // showing — the classification itself already succeeded.
      ensureThreadLabeled(threadId, data.tag).catch((err) => {
        console.warn("[MailCraft] Could not apply Gmail label:", err.message);
      });
      ensureCalendarEventFromEmail(threadId, data).catch((err) => {
        console.warn("[MailCraft] Could not create calendar event:", err.message);
      });
      ensureAggressiveEmailHandled(threadId, data).catch((err) => {
        console.warn("[MailCraft] Could not archive aggressive email:", err.message);
      });
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