// content.js
// Runs only on mail.google.com (see manifest.json "matches").
// Gmail is a single-page app that constantly re-renders its DOM, so we can't
// just run once on page load — we watch for changes and process new rows
// as they appear.

const PROCESSED_ATTR = "data-mailcraft-processed";

// --- Selectors -------------------------------------------------------
// tr.zA has identified an inbox row in Gmail's DOM for a long time and is
// the selector most Gmail extensions rely on. Still: open devtools on your
// own Gmail, inspect a row, and confirm/adjust these before relying on them.
const ROW_SELECTOR = "tr.zA";
const SENDER_SELECTOR = "[email]"; // sender spans carry an `email` attribute
const SUBJECT_SELECTOR = ".bog"; // subject text span
const SNIPPET_SELECTOR = ".y2"; // preview text Gmail shows after the subject
// -----------------------------------------------------------------------

function extractRowData(row) {
  const senderEl = row.querySelector(SENDER_SELECTOR);
  const subjectEl = row.querySelector(SUBJECT_SELECTOR);
  const snippetEl = row.querySelector(SNIPPET_SELECTOR);

  const sender = senderEl?.getAttribute("email") || senderEl?.textContent?.trim() || "";
  const subject = subjectEl?.textContent?.trim() || "";
  const snippet = snippetEl?.textContent?.trim() || "";

  // Gmail doesn't expose a clean, stable thread ID in the row markup across
  // all versions. Fall back to a composite key if a real ID isn't found.
  const threadId =
    row.getAttribute("data-legacy-thread-id") ||
    row.id ||
    `${sender}::${subject}`;

  // /api/triage classifies a single `body` string — the list view only has
  // subject + a truncated snippet, not the full email, but that's enough
  // signal for urgency/tag classification.
  const body = [subject, snippet].filter(Boolean).join("\n");

  return { threadId, sender, subject, body };
}

function makeBadge(label) {
  const badge = document.createElement("span");
  badge.className = "mailcraft-badge";
  badge.textContent = label;
  return badge;
}

function injectLoadingBadge(row) {
  const badge = makeBadge("…");
  badge.classList.add("mailcraft-badge--loading");
  // .xW / .xY are the cell Gmail uses for the subject column in most
  // layouts; inserting before it puts the badge right next to the subject.
  const anchor = row.querySelector(".xY") || row.querySelector(".xW") || row;
  anchor.parentElement?.insertBefore(badge, anchor);
  return badge;
}

function classifyRow(row) {
  if (row.hasAttribute(PROCESSED_ATTR)) return;
  row.setAttribute(PROCESSED_ATTR, "true");

  const data = extractRowData(row);
  if (!data.subject && !data.sender) return; // nothing usable found, skip

  const badgeEl = injectLoadingBadge(row);

  chrome.runtime.sendMessage(
    { type: "CLASSIFY_EMAIL", payload: { threadId: data.threadId, body: data.body } },
    (response) => {
      if (chrome.runtime.lastError) {
        badgeEl.remove();
        return;
      }
      if (!response?.ok) {
        badgeEl.remove();
        return;
      }
      // /api/triage returns { urgency, tag }
      const { urgency, tag } = response.result;
      badgeEl.textContent = tag || urgency || "?";
      badgeEl.classList.remove("mailcraft-badge--loading");
      badgeEl.classList.add(`mailcraft-badge--${(urgency || "default").toLowerCase()}`);
    }
  );
}

function scanForRows(root = document) {
  root.querySelectorAll(ROW_SELECTOR).forEach(classifyRow);
}

// Initial pass, in case rows are already present when the script loads.
scanForRows();

// Gmail loads/re-renders rows continuously (scrolling, new mail, switching
// views), so we watch the whole app container for added nodes.
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.(ROW_SELECTOR)) {
        classifyRow(node);
      } else {
        scanForRows(node);
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });