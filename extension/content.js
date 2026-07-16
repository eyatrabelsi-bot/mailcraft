// content.js
// Runs only on mail.google.com (see manifest.json "matches").
// Gmail is a single-page app that constantly re-renders its DOM, so we can't
// just run once on page load — we watch for changes and process new rows
// as they appear.

const PROCESSED_ATTR = "data-mailcraft-processed";
const IN_FLIGHT_ATTR = "data-mailcraft-pending";

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

  // Gmail's real thread ID lives on a nested span (data-legacy-thread-id),
  // not on the row itself. row.id (":6a" etc.) is a transient DOM id that
  // changes between page loads, so prefer the real thread ID when present.
  const threadId =
    row.querySelector("[data-legacy-thread-id]")?.getAttribute("data-legacy-thread-id") ||
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

  // Insert right before the subject text itself, inside its own
  // container (div.y6 in current Gmail markup). We deliberately don't
  // target a generic cell class like .xY: that class is shared by many
  // unrelated cells in the row (checkbox cell, a narrow spacer cell,
  // etc.), which is why badges were landing in the wrong, clipped
  // leftmost column before. Anchoring to the subject element itself is
  // more precise and more resistant to Gmail's markup shuffling classes
  // around.
  const subjectEl = row.querySelector(SUBJECT_SELECTOR);
  if (subjectEl && subjectEl.parentElement) {
    subjectEl.parentElement.insertBefore(badge, subjectEl);
  } else {
    // Fallback: the dedicated subject/snippet cell seen in current Gmail
    // markup (td.a4W). Still never attach directly to <tr>.
    const cell = row.querySelector("td.a4W") || row.querySelector("td");
    cell?.insertBefore(badge, cell.firstChild);
  }
  return badge;
}

function classifyRow(row) {
  if (row.hasAttribute(IN_FLIGHT_ATTR)) return;

  // Gmail frequently recycles a row's <tr> node in place (rewriting the
  // subject/snippet cell's innerHTML after the list "settles") without
  // ever removing/re-adding the <tr> itself. That wipes out our injected
  // badge but leaves PROCESSED_ATTR sitting on the row, so trusting the
  // attribute alone causes permanently-blank rows. Verify the badge is
  // still actually present before trusting "processed".
  if (row.hasAttribute(PROCESSED_ATTR) && row.querySelector(".mailcraft-badge")) {
    return;
  }
  row.removeAttribute(PROCESSED_ATTR);
  row.setAttribute(IN_FLIGHT_ATTR, "true");

  const data = extractRowData(row);
  if (!data.subject && !data.sender) {
    row.removeAttribute(IN_FLIGHT_ATTR);
    return; // nothing usable found, skip
  }

  const badgeEl = injectLoadingBadge(row);

  chrome.runtime.sendMessage(
    { type: "CLASSIFY_EMAIL", payload: { threadId: data.threadId, body: data.body } },
    (response) => {
      row.removeAttribute(IN_FLIGHT_ATTR);

      if (chrome.runtime.lastError || !response?.ok) {
        // Leave the row unmarked so the next observer pass or periodic
        // sweep retries it, instead of permanently skipping it.
        badgeEl.remove();
        return;
      }

      row.setAttribute(PROCESSED_ATTR, "true");

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
        // The added node may be content *inside* an already-existing row
        // (Gmail rewriting a cell in place) rather than a new row itself.
        // querySelectorAll only looks at descendants, so also check
        // upward for an ancestor row that needs re-verifying.
        const ancestorRow = node.closest?.(ROW_SELECTOR);
        if (ancestorRow) classifyRow(ancestorRow);
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

// Safety net: rows that failed (server briefly unreachable, etc.) get
// unmarked but nothing guarantees a DOM mutation touches them again. Sweep
// periodically to catch and retry those.
setInterval(() => scanForRows(), 5000);