import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import "dotenv/config";
import session from "express-session";
import { google } from "googleapis";
import crypto from "crypto";

const app = express();
const PORT = 3000;

// Google deprecates Gemini model IDs on a rolling basis (gemini-2.5-flash-lite
// was retired without much notice — a 404 "no longer available to new users"
// is what that looks like). Keeping the model name in ONE place means the
// next deprecation is a one-line fix instead of a grep-and-replace across
// every endpoint. gemini-3.1-flash-lite is Google's current recommended
// replacement for the flash-lite tier as of mid-2026.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

app.use(express.json({ limit: "10mb" }));

// --- CORS ---------------------------------------------------------------
// The Chrome extension's background service worker calls these endpoints
// (/api/triage, /api/summary) directly from a "chrome-extension://…"
// origin. Without any CORS headers here, the browser's preflight (OPTIONS)
// check fails with "blocked by CORS policy" and the request never reaches
// these routes at all — which is exactly what silently broke classification
// for newly-arrived mail (only mail already cached client-side from before
// this bug still showed a label/badge). Reflecting the request's own
// Origin header is safe here since this is a local dev server with no
// cookie-based auth on the AI endpoints themselves (session cookies are
// only checked by the /api/gmail/* routes, which the extension doesn't
// call — it talks to the Gmail API directly with its own OAuth token).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});
// -------------------------------------------------------------------------

app.use(
  session({
    secret: process.env.SESSION_SECRET || "mailcraft-dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }, // 1 day, secure:false for localhost (http)
  })
);

declare module "express-session" {
  interface SessionData {
    tokens?: {
      access_token?: string | null;
      refresh_token?: string | null;
      expiry_date?: number | null;
    };
  }
}

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/userinfo.email",
];
// ================= GOOGLE OAUTH ROUTES =================

// 1. Kick off login — redirects user to Google's consent screen
app.get("/api/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline", // needed to get a refresh_token
    prompt: "consent",      // forces refresh_token on every login (good for dev)
    scope: GMAIL_SCOPES,
  });
  res.redirect(url);
});

// 2. Google redirects back here after user approves
app.get("/api/auth/google/callback", async (req, res) => {
  const code = req.query.code as string;
  if (!code) {
    // /app (Dashboard) is what actually reads auth_success/auth_error —
    // Landing ("/") never looks at these params at all, which is why
    // redirecting there made a successful login look like it silently
    // failed / "did nothing".
    return res.redirect("/app?auth_error=missing_code");
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    req.session.tokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    };
    // Redirect back to the actual app/dashboard route, logged in.
    res.redirect("/app?auth_success=true");
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.redirect("/app?auth_error=token_exchange_failed");
  }
});

// 3. Frontend calls this to check "am I logged in?"
app.get("/api/auth/status", async (req, res) => {
  if (!req.session.tokens?.access_token) {
    return res.json({ connected: false });
  }

  try {
    oauth2Client.setCredentials(req.session.tokens);
    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const { data } = await oauth2.userinfo.get();
    // `picture` is the account's real Google profile photo URL — sent
    // through so the frontend can render the actual avatar instead of
    // just a fallback initial letter.
    res.json({ connected: true, email: data.email, name: data.name, picture: data.picture });
  } catch (error) {
    res.json({ connected: false });
  }
});
// Helper: get an authenticated Gmail client for the current session
function getGmailClient(req: express.Request) {
  if (!req.session.tokens?.access_token) return null;
  oauth2Client.setCredentials(req.session.tokens);
  return google.gmail({ version: "v1", auth: oauth2Client });
}

// 5. Fetch real inbox emails
app.get("/api/gmail/inbox", async (req, res) => {
  const gmail = getGmailClient(req);
  if (!gmail) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const list = await gmail.users.messages.list({
      userId: "me",
      maxResults: 15,
      labelIds: ["INBOX"],
    });

    const messages = list.data.messages || [];

    const emails = await Promise.all(
      messages.map(async (msg) => {
        const full = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const headers = full.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

        // Extract plain text body (simplified — Gmail bodies can be multi-part)
        let body = "";
        const extractBody = (part: any): string => {
          if (part.mimeType === "text/plain" && part.body?.data) {
            return Buffer.from(part.body.data, "base64").toString("utf-8");
          }
          if (part.parts) {
            for (const p of part.parts) {
              const result = extractBody(p);
              if (result) return result;
            }
          }
          return "";
        };
        if (full.data.payload) body = extractBody(full.data.payload);

        return {
          id: msg.id,
          from: getHeader("From"),
          subject: getHeader("Subject"),
          date: getHeader("Date"),
          body: body || "(No plain text content)",
          read: !full.data.labelIds?.includes("UNREAD"),
        };
      })
    );

    res.json({ emails });
  } catch (error: any) {
    console.error("Gmail inbox fetch error:", error.message);
    res.status(500).json({ error: "Failed to fetch inbox" });
  }
});

// Helper: find (or create) a Gmail label for a given classification tag.
// Labels are named EXACTLY like the classification tag (e.g. "Job",
// "Meeting", "Interview") — no prefix — so they read the same as the tag
// shown in the app/extension badges. A tiny in-memory cache avoids
// re-listing labels on every single email during a triage batch — it's
// keyed per Gmail client instance's access token so it can't leak across
// different logged-in users on the same server process.
const labelIdCache = new Map<string, string>(); // key: `${accessToken}:${labelName}` -> labelId

function sanitizeLabelName(tag: string): string {
  // Gmail label names can't contain raw newlines and shouldn't be empty;
  // keep it short and trim stray whitespace from the AI/fallback tag.
  const clean = tag.trim().replace(/[\r\n]+/g, " ").slice(0, 40);
  return clean || "Email";
}

async function getOrCreateLabelId(
  gmail: ReturnType<typeof google.gmail>,
  accessToken: string,
  tag: string
): Promise<string> {
  const labelName = sanitizeLabelName(tag);
  const cacheKey = `${accessToken}:${labelName}`;
  const cached = labelIdCache.get(cacheKey);
  if (cached) return cached;

  const list = await gmail.users.labels.list({ userId: "me" });
  const existing = list.data.labels?.find(
    (l) => l.name?.toLowerCase() === labelName.toLowerCase()
  );
  if (existing?.id) {
    labelIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  const newId = created.data.id;
  if (!newId) throw new Error("Gmail did not return an id for the created label");
  labelIdCache.set(cacheKey, newId);
  return newId;
}

// 5b. Create (if needed) the libellé matching a classification tag, and
// move the given message into it. "Move" here means: apply the label, and
// optionally remove it from INBOX so it behaves like a folder rather than
// just an extra tag — controlled by `archive` (defaults to false, i.e. the
// email keeps showing in the inbox AND gets the label).
app.post("/api/gmail/apply-label", async (req, res) => {
  const gmail = getGmailClient(req);
  if (!gmail) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { gmailId, tag, archive } = req.body as {
    gmailId?: string;
    tag?: string;
    archive?: boolean;
  };
  if (!gmailId || !tag) {
    return res.status(400).json({ error: "gmailId and tag are required" });
  }

  try {
    const accessToken = req.session.tokens?.access_token || "";
    const labelId = await getOrCreateLabelId(gmail, accessToken, tag);

    await gmail.users.messages.modify({
      userId: "me",
      id: gmailId,
      requestBody: {
        addLabelIds: [labelId],
        removeLabelIds: archive ? ["INBOX"] : [],
      },
    });

    res.json({ success: true, labelId, labelName: sanitizeLabelName(tag) });
  } catch (error: any) {
    console.error("Gmail apply-label error:", {
      message: error?.message,
      status: error?.status ?? error?.response?.status,
      gmailId,
      tag,
    });
    res.status(500).json({ error: "Failed to apply label" });
  }
});

// 5c. One-shot migration: move every message off the old "MailCraft/<tag>"
// labels (created before labels were renamed to plain tag names) onto the
// new plain-named label, then delete the now-empty old label. Safe to
// call more than once — labels already migrated just won't be found again.
app.post("/api/gmail/migrate-labels", async (req, res) => {
  const gmail = getGmailClient(req);
  if (!gmail) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const accessToken = req.session.tokens?.access_token || "";
    const list = await gmail.users.labels.list({ userId: "me" });
    const oldLabels = (list.data.labels || []).filter((l) =>
      l.name?.startsWith("MailCraft/")
    );

    const migrated: { from: string; to: string; messageCount: number }[] = [];

    for (const oldLabel of oldLabels) {
      if (!oldLabel.id || !oldLabel.name) continue;
      const tag = oldLabel.name.slice("MailCraft/".length);
      const newLabelId = await getOrCreateLabelId(gmail, accessToken, tag);

      // Gather every message under the old label (paginated).
      const messageIds: string[] = [];
      let pageToken: string | undefined;
      do {
        const msgList = await gmail.users.messages.list({
          userId: "me",
          labelIds: [oldLabel.id],
          maxResults: 500,
          pageToken,
        });
        (msgList.data.messages || []).forEach((m) => m.id && messageIds.push(m.id));
        pageToken = msgList.data.nextPageToken || undefined;
      } while (pageToken);

      // batchModify handles up to 1000 ids per call — chunk defensively.
      for (let i = 0; i < messageIds.length; i += 900) {
        const chunk = messageIds.slice(i, i + 900);
        if (chunk.length === 0) continue;
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: chunk,
            addLabelIds: [newLabelId],
            removeLabelIds: [oldLabel.id],
          },
        });
      }

      // Now empty — remove the old label itself so it disappears from the sidebar.
      await gmail.users.labels.delete({ userId: "me", id: oldLabel.id });

      migrated.push({ from: oldLabel.name, to: tag, messageCount: messageIds.length });
    }

    res.json({ success: true, migrated });
  } catch (error: any) {
    console.error("Gmail label migration error:", {
      message: error?.message,
      status: error?.status ?? error?.response?.status,
    });
    res.status(500).json({ error: "Failed to migrate labels" });
  }
});

// 6. Send a real email reply
app.post("/api/gmail/send", async (req, res) => {
  const gmail = getGmailClient(req);
  if (!gmail) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { to, subject, body, threadId } = req.body;
  if (!to || !subject || !body) {
    return res.status(400).json({ error: "to, subject, and body are required" });
  }

  try {
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      "",
      body,
    ].join("\n");

    const encodedMessage = Buffer.from(message)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
        threadId: threadId || undefined,
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Gmail send error:", error.message);
    res.status(500).json({ error: "Failed to send email" });
  }
});
// 4. Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Initialize the Google GenAI SDK.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("Warning: GEMINI_API_KEY is not defined. AI features will run in fallback mode.");
}

const ai = new GoogleGenAI({
  apiKey: apiKey || "",
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// ================= FALLBACK MECHANISMS =================
// These smart, rule-based fallback functions ensure that if the Gemini API key
// is rate-limited (429 quota exhausted) or missing, the application remains fully functional.

function fallbackTriage(body: string) {
  const content = body.toLowerCase();
  
  // Urgency logic
  let urgency = "Medium";
  const urgentKeywords = [
    "urgente", "urgent", "immédiat", "rapidement", "important", "deadline", 
    "date limite", "prioritaire", "critical", "attention", "asap"
  ];
  const lowKeywords = [
    "newsletter", "pub", "promo", "low priority", "archive", "faible", 
    "loisir", "invitation"
  ];
  
  if (urgentKeywords.some(kw => content.includes(kw))) {
    urgency = "Important";
  } else if (lowKeywords.some(kw => content.includes(kw))) {
    urgency = "Faible";
  }

  // Tag logic
  // Order matters here: this is a fixed-priority chain, so whichever
  // category is checked first wins on any overlap. Meeting/Stage/Study
  // keywords tend to be more specific and less ambiguous than Job
  // keywords (e.g. "meeting" rarely means anything else, but generic
  // work-related words show up in almost every professional email), so
  // check those first and leave Job as more of a fallback bucket.
  let tag = "Email";
  if (["réunion", "rdv", "rendez-vous", "meeting", "entretien", "visio", "call schedule"].some(kw => content.includes(kw))) {
    tag = "Meeting";
  } else if (["stage", "stagiaire", "internship", "intern"].some(kw => content.includes(kw))) {
    tag = "Stage";
  } else if (["cours", "étude", "université", "fac", "recherche académique", "examen", "school", "university", "academic", "etudiant"].some(kw => content.includes(kw))) {
    tag = "Study";
  } else if (["recrutement", "candidature", "cv", "job", "offre d'emploi", "embauche", "poste à pourvoir", "hiring", "salaire"].some(kw => content.includes(kw))) {
    tag = "Job";
  }

  return { urgency, tag };
}

function fallbackSummary(body: string): string {
  const cleanBody = body.replace(/[\r\n]+/g, " ").trim();
  if (cleanBody.length <= 80) {
    return cleanBody;
  }
  
  // Try to find first punctuation
  const firstSentenceIndex = cleanBody.match(/[.!?]/)?.index;
  if (firstSentenceIndex && firstSentenceIndex > 15 && firstSentenceIndex < 100) {
    return cleanBody.substring(0, firstSentenceIndex + 1);
  }
  
  // Truncate cleanly to first 12-14 words
  const words = cleanBody.split(/\s+/);
  if (words.length <= 14) {
    return cleanBody;
  }
  return words.slice(0, 13).join(" ") + "...";
}

function fallbackExtractCriteria(fileText: string): string {
  const cleanText = fileText.replace(/[\r\n]+/g, " ").trim();
  
  const lowerText = cleanText.toLowerCase();
  const searchKeywords = ["recherche", "requis", "compétences", "exigences", "profil", "requirements", "skills", "criteria"];
  
  for (const kw of searchKeywords) {
    const idx = lowerText.indexOf(kw);
    if (idx !== -1) {
      const snippet = cleanText.substring(Math.max(0, idx - 20), Math.min(cleanText.length, idx + 160));
      return `Profil recherché incluant : ${snippet.trim()}...`;
    }
  }
  
  if (cleanText.length <= 150) {
    return cleanText;
  }
  return cleanText.substring(0, 150) + "...";
}

interface EvaluatedEmail {
  id: number;
  from: string;
  subject: string;
  body: string;
}

function fallbackMatchEmails(topic: string, criteria: string, emails: EvaluatedEmail[]) {
  const cleanTopic = topic.toLowerCase();
  const cleanCriteria = criteria.toLowerCase();

  const results = emails.map(email => {
    const bodyLower = email.body.toLowerCase();
    const subjectLower = email.subject.toLowerCase();
    const combinedText = `${subjectLower} ${bodyLower}`;

    // Topic match checks
    const topicKeywords = cleanTopic.split(/\s+/).filter(w => w.length > 2);
    let matchedTopic = false;
    
    if (topicKeywords.length > 0) {
      matchedTopic = topicKeywords.some(kw => combinedText.includes(kw));
    } else {
      matchedTopic = combinedText.includes(cleanTopic);
    }

    if (subjectLower.includes(cleanTopic) || cleanTopic.split(/\s+/).some(kw => kw.length > 3 && subjectLower.includes(kw))) {
      matchedTopic = true;
    }

    // Criteria match checks
    let match: "perfect" | "partial" | "none" = "none";
    let reasoning = "";
    let draft = "";

    const isEnglish = /hello|dear|thank|meeting|job|regards|apply/i.test(combinedText);

    if (matchedTopic) {
      const criteriaKeywords = cleanCriteria.split(/\s+/).filter(w => w.length > 3);
      let matchCount = 0;
      
      if (criteriaKeywords.length > 0) {
        criteriaKeywords.forEach(kw => {
          if (combinedText.includes(kw)) {
            matchCount++;
          }
        });
      }

      if (matchCount >= Math.min(2, criteriaKeywords.length) || combinedText.includes(cleanCriteria)) {
        match = "perfect";
        reasoning = isEnglish 
          ? "The email perfectly aligns with the required topic and meets all criteria."
          : "L'email correspond parfaitement au sujet et répond à tous les critères définis.";
      } else {
        match = "partial";
        reasoning = isEnglish
          ? "The email matches the topic but is missing some specific criteria elements."
          : "L'email correspond au sujet demandé mais certains critères spécifiques manquent.";
      }
    } else {
      match = "none";
      reasoning = isEnglish
        ? "The email does not seem to relate to the active topic."
        : "L'email ne semble pas être lié au sujet actif.";
    }

    // Draft reply template
    if (isEnglish) {
      if (match === "perfect") {
        draft = `Hello,\n\nThank you for your message regarding "${topic}".\n\nYour profile matches our requirements perfectly. We would be delighted to discuss this further with you. Please let us know your availability for a brief call next week.\n\nBest regards,\nThe MailCraft AI Team`;
      } else {
        draft = `Hello,\n\nThank you for your interest and your message regarding "${topic}".\n\nWe have received your application/information. Our team is currently reviewing your message and we will get back to you if we need any additional details.\n\nBest regards,\nThe MailCraft AI Team`;
      }
    } else {
      if (match === "perfect") {
        draft = `Bonjour,\n\nMerci pour votre message concernant "${topic}".\n\nVotre profil correspond parfaitement à nos critères. Nous serions ravis d'échanger plus en détail avec vous. Pourriez-vous nous indiquer vos disponibilités pour un court entretien la semaine prochaine ?\n\nCordialement,\nL'équipe MailCraft AI`;
      } else {
        draft = `Bonjour,\n\nNous vous remercions de votre intérêt et de votre message concernant "${topic}".\n\nNous avons bien reçu vos informations. Notre équipe étudie actuellement votre message et nous reviendrons vers vous si des précisions sont nécessaires.\n\nCordialement,\nL'équipe MailCraft AI`;
      }
    }

    return {
      emailId: email.id,
      matchedTopic,
      match,
      reasoning,
      draft
    };
  });

  return { results };
}

// Minimal shape of an email the chat assistant needs to answer questions
// like "résume mes emails de ce matin" or "what's the most important mail
// today" — only sent by the frontend once the extension/app is active
// (see Dashboard.tsx), since that's when real classified mail exists.
interface ChatInboxEmail {
  from: string;
  subject: string;
  date: string;
  urgency?: string;
  tag?: string;
  summary?: string;
  read?: boolean;
}

// Builds a rule-based answer to inbox-related questions (summary, most
// important mail, counts...) directly from the metadata the frontend sent,
// without needing the AI model at all. Returns null if the message doesn't
// actually look like an inbox question, so the caller can fall through to
// the rest of fallbackChat's matchers.
function answerInboxQuery(lastMsgLower: string, inboxContext?: ChatInboxEmail[] | null): string | null {
  const isMailboxQuery =
    /(résum|summar).*(mail|email|inbox|bo[iî]te)/i.test(lastMsgLower) ||
    /(mail|email).*(résum|summar)/i.test(lastMsgLower) ||
    /plus important.*(mail|email)|most important.*(mail|email)|(mail|email).*plus important|(mail|email).*important.*(today|aujourd'hui)/i.test(lastMsgLower) ||
    /combien.*(mail|email)|how many.*(mail|email)/i.test(lastMsgLower) ||
    /(mes|my) (mails|emails|inbox)|ma bo[iî]te/i.test(lastMsgLower);

  if (!isMailboxQuery) return null;

  if (!inboxContext || inboxContext.length === 0) {
    return "Je n'ai pas encore accès à ta boîte de réception ici. Active MailCraft AI (bouton \"Activer le tri IA\" → Extension Chrome ou Application Android) pour que je puisse analyser tes emails en direct et répondre à ce type de question !\n\nI don't have access to your inbox yet here — activate MailCraft AI (the \"Activer le tri IA\" button) via the Chrome extension or Android app so I can read your live emails and answer this kind of question.";
  }

  const important = inboxContext.filter((e) => e.urgency === "Important");
  const isEnglish = /how many|what's|most important|summarize|my emails|my inbox/i.test(lastMsgLower);

  // "What's the most important mail" — answer with just those, not a full dump.
  if (/plus important|most important/i.test(lastMsgLower)) {
    if (important.length === 0) {
      return isEnglish
        ? "Good news — nothing urgent in your inbox right now. No email is currently marked \"Important\"."
        : "Bonne nouvelle : rien d'urgent dans ta boîte pour le moment. Aucun email n'est actuellement marqué \"Important\".";
    }
    const lines = important
      .slice(0, 5)
      .map((e) => `- **${e.subject}** (${e.from})${e.summary ? ` — ${e.summary}` : ""}`)
      .join("\n");
    return isEnglish
      ? `Here ${important.length > 1 ? "are" : "is"} the ${important.length} email(s) marked as most important right now:\n\n${lines}`
      : `Voici ${important.length > 1 ? "les" : "l'"} email(s) marqué(s) le${important.length > 1 ? "s" : ""} plus important${important.length > 1 ? "s" : ""} en ce moment :\n\n${lines}`;
  }

  // Generic "résume mes emails" / "summarize my inbox" — short digest of everything.
  const lines = inboxContext
    .slice(0, 8)
    .map((e) => `- ${e.subject} (${e.from})${e.tag ? ` — ${e.tag}` : ""}${e.summary ? ` : ${e.summary}` : ""}`)
    .join("\n");
  const importantNote =
    important.length > 0
      ? isEnglish
        ? `\n\n📌 ${important.length} of them ${important.length > 1 ? "are" : "is"} marked Important.`
        : `\n\n📌 ${important.length} d'entre eux ${important.length > 1 ? "sont marqués" : "est marqué"} Important.`
      : "";

  return isEnglish
    ? `Here's a quick digest of your inbox (${inboxContext.length} email(s)):\n\n${lines}${importantNote}`
    : `Voici un résumé rapide de ta boîte de réception (${inboxContext.length} email(s)) :\n\n${lines}${importantNote}`;
}

function fallbackChat(messages: { role: string; content: string }[], inboxContext?: ChatInboxEmail[] | null): string {
  const lastMsg = messages[messages.length - 1]?.content || "";
  const lastMsgLower = lastMsg.toLowerCase().trim();

  // 1. Check for normal acknowledgements/short confirmations like "thank u", "thanks", "merci", etc.
  const shortAcks = ["thank u", "thank you", "thanks", "merci", "ok", "okay", "d'accord", "cool", "super", "génial", "awesome", "perfect", "parfait", "done"];
  const isShortAck = shortAcks.some(ack => lastMsgLower === ack || lastMsgLower.startsWith(ack + " ") || lastMsgLower.endsWith(" " + ack) || lastMsgLower === ack + "!" || lastMsgLower === ack + ".");

  if (isShortAck) {
    return "De rien ! Je reste toujours disponible à vos côtés dès que vous en avez besoin. / You are welcome! I am always available to assist you whenever you need.";
  }

  // 1b. Inbox-aware questions ("résume mes emails", "what's most important
  // today"...) — checked early, and independently of the AI model, so this
  // always works the instant the extension/app is active, even offline.
  const inboxAnswer = answerInboxQuery(lastMsgLower, inboxContext);
  if (inboxAnswer) return inboxAnswer;

  // 1c. Casual small talk / "how are you" — kept separate from the more
  // formal greeting branch below so a plain "hey" or "ça va ?" gets a
  // short, natural, human-sounding reply instead of the fuller pitch.
  const casualGreetings = ["hey", "yo", "coucou", "salut", "sup", "wesh", "ça va", "ca va", "how are you", "how're you", "how are u", "how r u", "comment vas-tu", "comment allez-vous", "quoi de neuf", "what's up", "whats up"];
  const isCasualGreeting = casualGreetings.some(g => lastMsgLower === g || lastMsgLower.startsWith(g + " ") || lastMsgLower.startsWith(g + "?") || lastMsgLower.startsWith(g + "!") || lastMsgLower === g + "?" || lastMsgLower === g + "!");
  if (isCasualGreeting) {
    const isEnglish = /^(hey|yo|sup|how|what)/i.test(lastMsgLower);
    return isEnglish
      ? "Hey! I'm doing great, thanks for asking 🙂 What can I help you with — an email to write, your inbox to check, or something else entirely?"
      : "Hey ! Ça va très bien, merci de demander 🙂 Sur quoi je peux t'aider — un email à rédiger, ta boîte à consulter, ou autre chose ?";
  }

  const generalQuestions = ["bonjour", "salut", "hello", "hi", "qui es-tu", "comment ça va", "how are you", "what is your name", "aide", "help"];
  const isGeneralGreeting = generalQuestions.some(g => lastMsgLower.startsWith(g) || lastMsgLower === g);

  if (isGeneralGreeting) {
    return "Bonjour ! Je suis MailCraft AI, votre assistant intelligent de rédaction, d'analyse et d'accompagnement. Comment puis-je vous aider aujourd'hui ? Que ce soit pour rédiger un email, analyser un profil, traduire un texte ou répondre à toute autre question, je suis là pour vous aider avec flexibilité !";
  }

  // 2. Check for unsafe / out of domain requests
  const isOutOfDomain = /hack|pirater|crack|malware|virus|voler|cheat|steal|kill|tuer|bombe|bomb|drogue|illegal|illégal|arme|weapon/i.test(lastMsgLower);

  if (isOutOfDomain) {
    return "Sorry, I am not designed to reply to this kind of request. / Désolé, je ne suis pas conçu pour répondre à ce type de demande.";
  }

  const isCanHelpQuery = /can (you|u) help me with|aide-moi avec|peux-tu m'aider avec|pouvez-vous m'aider avec/i.test(lastMsgLower);
  const introPrefix = isCanHelpQuery ? "Yes, I can help you do that!\n\n" : "";

  // 1. "How can you help me" / Abilities query
  if (/how can you help|how can u help|what can you do|what can u do|comment peux-tu m'aider|comment m'aider|vos capacités|capabilities/i.test(lastMsgLower)) {
    return `${introPrefix}En tant qu'assistant intelligent polyvalent de MailCraft AI, je dispose de nombreuses compétences pour faciliter votre quotidien :

1. 📧 **Gestion & Rédaction d'E-mails** : 
   - Rédaction de brouillons d'e-mails professionnels, personnels ou académiques à partir de simples consignes.
   - Reformulation, correction de style, orthographe et changement de ton (formel, amical, persuasif).
   - Traduction fluide de vos messages entre plusieurs langues (Français, Anglais, Espagnol, etc.).

2. ✉️ **Réponses intelligentes aux invitations** : 
   - Génération instantanée d'options adaptées pour accepter chaleureusement, décliner avec tact ou proposer des modifications de calendrier.

3. 📂 **Triage intelligent & Catégorisation** :
   - Analyse automatique de l'urgence et de l'importance de vos e-mails entrants.
   - Classement automatique en arrière-plan pour que vous ne manquiez jamais une information cruciale.

4. 🎯 **Mail Matching & Recrutement** :
   - Scan automatique de vos e-mails entrants pour repérer les profils qui correspondent à vos critères (ex: recherche de stage, compétences spécifiques comme React ou CSS).
   - Rédaction automatique de réponses adaptées aux candidats correspondants.

5. 💡 **Assistance générale et flexible** :
   - Je ne suis pas limité aux e-mails ! Je peux vous aider à structurer vos idées, résumer de longs documents, répondre à des questions de culture générale, ou vous donner des conseils de productivité.

Dites-moi simplement ce dont vous avez besoin, et je m'en occupe !`;
  }

  // 2. "Invitation reply" query
  if (/invitation|invite|invit|reply to|replay to|comment répondre|repondre/i.test(lastMsgLower)) {
    return `${introPrefix}J'ai bien noté que vous avez reçu une invitation ! Pour y répondre de manière professionnelle et élégante, voici les 3 options les plus courantes que vous pouvez sélectionner et personnaliser :

### Option 1 : Accepter chaleureusement et confirmer votre présence
Idéal pour confirmer votre participation avec enthousiasme.
\`\`\`
Sujet : Confirmation de présence - [Nom de l'événement]

Bonjour [Nom de l'interlocuteur],

Je vous remercie chaleureusement pour cette invitation à [Nom de l'événement]. C'est avec grand plaisir que je vous confirme ma présence le [Date] à [Heure].

Je me réjouis d'avance de participer à cet événement et d'échanger avec vous.

Bien cordialement,
[Votre Nom]
\`\`\`

### Option 2 : Décliner poliment avec tact (Empêchement)
Idéal si vous ne pouvez pas assister, tout en maintenant une excellente relation.
\`\`\`
Sujet : Invitation - [Nom de l'événement]

Bonjour [Nom de l'interlocuteur],

Je vous remercie vivement pour votre aimable invitation à [Nom de l'événement].

Malheureusement, j'ai déjà un engagement important de planifié à cette date et je ne pourrai pas me joindre à vous. Je le regrette sincèrement et j'espère que nous aurons l'occasion de nous croiser très bientôt lors d'un prochain événement.

Je vous souhaite une excellente rencontre.

Bien cordialement,
[Votre Nom]
\`\`\`

### Option 3 : Demander un report ou proposer un autre créneau
Idéal si le sujet vous intéresse mais que le créneau proposé ne vous convient pas.
\`\`\`
Sujet : Proposition de créneau alternatif - [Nom de l'événement]

Bonjour [Nom de l'interlocuteur],

Merci beaucoup pour votre invitation à échanger lors de [Nom de l'événement / Réunion].

Le créneau proposé ne me convient malheureusement pas en raison d'un conflit d'agenda. Serait-il possible de reporter notre échange à l'une des dates suivantes ?
- [Option date 1, ex: Mardi matin]
- [Option date 2, ex: Jeudi après-midi]

Je reste à votre entière disposition pour caler ce moment.

Bien cordialement,
[Votre Nom]
\`\`\`

Quelle option correspond le mieux à votre situation ? Je peux adapter le ton si vous le souhaitez !`;
  }

  if (/rédige|ecris|écris|write|draft/i.test(lastMsgLower)) {
    return `${introPrefix}Voici une proposition basée sur votre demande :

Bonjour,

Je fais suite à votre sollicitation et me tiens à votre entière disposition.

[Insérer les détails de votre demande ou personnaliser ce paragraphe]

N'hésitez pas à me faire part de vos commentaires pour ajuster le contenu.

Cordialement,
[Votre Nom]`;
  }

  if (/lettre de motivation|motivation letter|cover letter/i.test(lastMsgLower)) {
    return `${introPrefix}Voici un modèle de lettre de motivation que vous pouvez personnaliser :

[Votre Nom]
[Votre Adresse]
[Téléphone] | [Email]

À l'attention du Responsable du Recrutement

Sujet : Candidature pour le poste souhaité

Madame, Monsieur,

C'est avec une grande motivation que je vous adresse ma candidature pour rejoindre vos équipes.

De par mes expériences passées et mes compétences en résolution de problèmes, je suis convaincu(e) de pouvoir apporter une contribution positive et immédiate.

Adaptable, rigoureux(se) et doté(e) d'un excellent esprit d'équipe, je serais ravi(e) de vous exposer mes motivations de vive voix lors d'un entretien.

Dans l'attente de votre retour, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.

[Votre Nom]`;
  }

  if (/cv|resume/i.test(lastMsgLower)) {
    return `${introPrefix}Pour optimiser la structure de votre CV, voici mes recommandations principales :

1. **Titre de profil accrocheur** : Indiquez clairement votre poste cible sous votre nom (ex: "Développeur Full-Stack - React/Node").
2. **Expériences orientées résultats** : Utilisez des verbes d'action au début de chaque puce (ex: "Optimisé", "Conçu", "Négocié") et ajoutez des chiffres précis (ex: "croissance de 20%", "équipe de 5 personnes").
3. **Mise en valeur des compétences clés** : Séparez vos compétences techniques (Hard Skills) de vos compétences humaines (Soft Skills).
4. **Design sobre** : Privilégiez une mise en page aérée de 1 page, avec des marges équilibrées et une police très lisible (comme Inter).`;
  }

  // General flexible response fallback
  return `${introPrefix}J'ai bien reçu votre demande : "${lastMsg}". En tant qu'assistant polyvalent, je peux vous aider à formuler vos réponses, reformuler vos textes, organiser vos idées ou répondre à vos questions. Dites-moi comment vous souhaitez que nous procédions ou si vous souhaitez adapter ce contenu !`;
}


// ================= ENDPOINTS =================

// 1. Classification (Triage) Endpoint
app.post("/api/triage", async (req, res) => {
  const { body } = req.body;
  if (!body) {
    return res.status(400).json({ error: "Email body is required" });
  }

  try {
    if (!apiKey) {
      throw new Error("API Key is missing. Triggering fallback.");
    }
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Classify the following email body:\n\n"${body}"`,
      config: {
        systemInstruction: "You are a professional email classifier. You must categorize emails according to urgency and core topic.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            urgency: {
              type: Type.STRING,
              description: "Urgency level of the email: must be 'Important', 'Medium', or 'Faible'",
            },
            tag: {
              type: Type.STRING,
              description: "A single word summarizing the topic, such as: 'Job', 'Study', 'Meeting', 'Stage', or another single relevant word.",
            },
          },
          required: ["urgency", "tag"],
        },
      },
    });

    const resultText = response.text || "{}";
    const classification = JSON.parse(resultText);
    res.json(classification);
  } catch (error: any) {
    // Log the REAL failure reason — status code, message, whatever the SDK
    // gives us — instead of just announcing that fallback kicked in. This
    // is the only way to tell "invalid/expired key" apart from "rate
    // limited" apart from "malformed response that failed JSON.parse".
    console.error("[AI] Triage endpoint error:", {
      message: error?.message,
      status: error?.status ?? error?.response?.status,
      code: error?.code,
    });
    console.log("[AI] Triage endpoint: Using local fallback classification.");
    const result = fallbackTriage(body);
    res.json(result);
  }
});

// 2. Summary Endpoint
// Server-side summary cache, keyed by a hash of the NORMALIZED body text.
// The extension (content.js, in real gmail.com) and the app (App.tsx) each
// call this endpoint independently for the same email, and Gemini isn't
// deterministic — two separate calls for identical text can come back
// worded differently, which is exactly why the two surfaces were showing
// mismatched summaries.
//
// A gmailId-based cache key was the first instinct, but the extension's
// threadId (scraped from Gmail's URL hash permalink) and the app's gmailId
// (the raw Gmail API message id) are two different ID formats that don't
// reliably match each other — keying on them would make the cache quietly
// fail to unify anything. Hashing the actual body text instead sidesteps
// that mismatch entirely: whichever client asks first generates the
// summary, and any other client sending the same underlying content gets
// back that exact same cached text.
const summaryCacheByHash = new Map<string, { summary: string; source: string; reason?: string }>();
const MAX_SUMMARY_CACHE_ENTRIES = 2000;

function normalizedBodyHash(body: string): string {
  // Collapse all whitespace and lowercase, then hash only the first ~400
  // characters. The extension (DOM-scraped) and the app (Gmail API plain-
  // text extraction) usually agree closely on the OPENING of an email, but
  // can diverge further down — quoted thread history, signature blocks, or
  // HTML-to-text conversion quirks. Truncating first maximizes the chance
  // both sources land on the same hash for the same real email, while 400
  // characters of matching text is still specific enough that two
  // genuinely different emails won't collide.
  const normalized = body.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 400);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function cacheSummary(key: string, value: { summary: string; source: string; reason?: string }) {
  // Only cache real AI output — never let a degraded fallback get "stuck"
  // as the permanent answer for that email once the underlying issue
  // (quota, model, etc.) is fixed.
  if (value.source !== "ai") return;
  summaryCacheByHash.set(key, value);
  if (summaryCacheByHash.size > MAX_SUMMARY_CACHE_ENTRIES) {
    const oldestKey = summaryCacheByHash.keys().next().value;
    if (oldestKey !== undefined) summaryCacheByHash.delete(oldestKey);
  }
}

app.post("/api/summary", async (req, res) => {
  const { body, gmailId } = req.body;
  if (!body) {
    return res.status(400).json({ error: "Email body is required" });
  }

  // gmailId is accepted (and logged) for debugging/observability, but the
  // actual cache key is the body hash — see the comment above for why.
  const cacheKey = normalizedBodyHash(body);

  if (summaryCacheByHash.has(cacheKey)) {
    return res.json(summaryCacheByHash.get(cacheKey));
  }

  try {
    if (!apiKey) {
      throw new Error("API Key is missing. Triggering fallback.");
    }
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Summarize the following email in a single, short sentence under 20 words, suitable for a mobile notification. Do not write any introduction, quotes, or markdown. Return only the summary text.\n\nEmail body:\n"${body}"`,
    });

    const aiText = response.text?.trim();
    // If the model call technically succeeded but returned nothing usable,
    // this is STILL a fallback from the client's point of view — flag it
    // as such rather than reporting source: "ai" for text that never
    // actually came from the model.
    const result = aiText
      ? { summary: aiText, source: "ai" }
      : { summary: fallbackSummary(body), source: "fallback", reason: "empty_ai_response" };

    cacheSummary(cacheKey, result);
    res.json(result);
  } catch (error: any) {
    console.error("[AI] Summary endpoint error:", {
      message: error?.message,
      status: error?.status ?? error?.response?.status,
      code: error?.code,
      gmailId,
    });
    console.log("[AI] Summary endpoint: Using local fallback summary.");
    // Surface WHY it's degraded (quota vs. missing key vs. something else)
    // so the frontend can show an accurate, specific message instead of a
    // generic "AI unavailable" — and so you can tell them apart at a
    // glance without digging through server logs.
    const reason =
      error?.status === 429 || error?.response?.status === 429
        ? "quota_exceeded"
        : !apiKey
        ? "missing_api_key"
        : "ai_error";
    // Not cached — a fallback should never permanently stick.
    res.json({ summary: fallbackSummary(body), source: "fallback", reason });
  }
});

// 3. Criteria Extraction Endpoint
app.post("/api/extract-criteria", async (req, res) => {
  const { fileText } = req.body;
  if (!fileText) {
    return res.status(400).json({ error: "File content is required" });
  }

  try {
    if (!apiKey) {
      throw new Error("API Key is missing. Triggering fallback.");
    }
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: `Read the following text extracted from a document (like a CV, job offer, or criteria sheet) and summarize the core requirements into a concise baseline description of 1 to 3 sentences suitable for checking candidate emails against. Return only the extracted description, without any preambles, formatting, or markdown.\n\nDocument text:\n"${fileText}"`,
    });

    res.json({ criteria: response.text?.trim() || fallbackExtractCriteria(fileText) });
  } catch (error: any) {
    console.log("[AI] Criteria extraction endpoint: Using local fallback extraction.");
    res.json({ criteria: fallbackExtractCriteria(fileText) });
  }
});

// 4. Mail Matching Endpoint
app.post("/api/match-emails", async (req, res) => {
  const { topic, criteria, emails } = req.body;
  if (!topic || !criteria || !emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: "topic, criteria, and emails array are required" });
  }

  try {
    if (!apiKey) {
      throw new Error("API Key is missing. Triggering fallback.");
    }
    const prompt = `You are scanning an inbox for emails related to the topic: "${topic}".
For any email that matches this topic, you must evaluate if its content satisfies the baseline criteria:
"${criteria}"

Here is the list of emails to evaluate:
${JSON.stringify(emails)}

For each email, evaluate:
1. Does it match the topic? (matchedTopic)
2. If it matches the topic, does it satisfy the baseline criteria? ("perfect", "partial", or "none")
3. Provide a brief 1-sentence reasoning.
4. Draft a response. If the match is "perfect", draft an enthusiastic, highly professional acceptance/approval reply confirming they meet the criteria and detailing next steps. If the match is "partial" or "none", draft a polite acknowledgement of receipt (accusé de réception) stating their application/message has been received and is being processed, without confirming approval. Match the language of the original email (French or English).

Return a JSON object containing an array of evaluations.`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  emailId: { type: Type.INTEGER, description: "The ID of the evaluated email" },
                  matchedTopic: { type: Type.BOOLEAN, description: "True if the email matches the topic" },
                  match: { type: Type.STRING, description: "Must be 'perfect', 'partial', or 'none'" },
                  reasoning: { type: Type.STRING, description: "A short 1-sentence reasoning for the match level" },
                  draft: { type: Type.STRING, description: "The drafted reply in the appropriate language (French or English)" },
                },
                required: ["emailId", "matchedTopic", "match", "reasoning", "draft"],
              },
            },
          },
          required: ["results"],
        },
      },
    });

    const resultText = response.text || '{"results":[]}';
    res.json(JSON.parse(resultText));
  } catch (error: any) {
    console.log("[AI] Mail matching endpoint: Using local fallback matching.");
    const fallbackResults = fallbackMatchEmails(topic, criteria, emails);
    res.json(fallbackResults);
  }
});

// 5. Chat Assistant Endpoint
app.post("/api/chat", async (req, res) => {
  const { messages, inboxContext } = req.body as {
    messages?: { role: string; content: string }[];
    inboxContext?: ChatInboxEmail[] | null;
  };
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    if (!apiKey) {
      throw new Error("API Key is missing. Triggering fallback.");
    }
    // Only ever true once the extension/app is active on the frontend (see
    // Dashboard.tsx) — that's the point at which real classified mail
    // actually exists to answer questions about.
    const hasInboxContext = Array.isArray(inboxContext) && inboxContext.length > 0;
    const inboxSection = hasInboxContext
      ? `\n\nLIVE INBOX ACCESS:
You currently have access to the user's real, live inbox (provided by the connected Chrome extension or Android app). Here is a JSON snapshot of it — each item has from, subject, date, urgency ("Important" | "Medium" | "Faible"), tag (topic), and summary:
${JSON.stringify(inboxContext).slice(0, 6000)}

Use this data to directly answer questions like "résume mes emails de ce matin", "what's the most important mail today", "combien d'emails urgents ai-je", etc. Never say you don't have access to the inbox — you do. Keep inbox answers concise (a short digest or a focused list), not a full re-dump of every field.`
      : `\n\nNO LIVE INBOX ACCESS YET:
The user has not activated the Chrome extension or Android app yet, so you do NOT have access to their real inbox. If they ask something that requires reading their actual emails (e.g. "résume mes emails", "what's my most important mail today"), tell them briefly (matching their language) that this needs MailCraft AI activated first via the "Activer le tri IA" button (Chrome extension or Android app), rather than making up email content.`;

    const systemInstruction = `You are MailCraft AI, a highly specialized, professional, and flexible AI assistant.
Your primary expertise is writing, reviewing, critiquing, and drafting professional emails, letters of motivation, cover letters, job applications, academic inquiries, and workplace correspondence.
However, you are extremely flexible! You can help the user with any other request they have (such as explaining general topics, translating, drafting other text, giving creative suggestions, answering random questions, etc.). This includes ordinary human small talk — if the user just says something casual like "hey", "how are you", "ça va ?", reply briefly and naturally like a friendly human would, then offer to help, instead of launching into a full capabilities pitch.

STRICT BEHAVIOR AND FLEXIBILITY RULES:
1. Short Acknowledgements / Confirmation:
   - If the user says something simple/short like "thank u", "thanks", "merci", "ok", "merci beaucoup", "cool", "super", etc., you MUST reply with a simple, polite response stating that you are always available to help (e.g., "De rien ! Je reste toujours disponible à vos côtés." or "You're welcome! I am always available to help you.").

2. Assistance Requests & Domain Checks:
   - When the user asks "can you help me with [topic]" or makes a request, analyze whether it is in your domain of assistance (writing, emails, templates, translations, productivity, general helpful information, coding, etc. - basically anything that is safe and helpful).
   - If it is in your domain, you MUST start your response with: "Yes, I can help you do that!" (or French equivalent: "Oui, je peux tout à fait vous aider à faire cela !") followed by the detailed solution/response.
   - If the request is completely outside your capabilities or unsafe (such as hacking, malware, illegal activities, physical harm, etc.), you MUST respond with: "Sorry, I am not designed to reply to this kind of request." (or French equivalent: "Désolé, je ne suis pas conçu pour répondre à ce type de demande.").
${inboxSection}

DRAFTING & COMMUNICATION RULES:
- Match the language of the user (French or English).
- Adopt flawless, polished, and polite communication etiquette.
- Keep answers clear, comprehensive, and highly actionable.`;

    const contents = messages.map((m: any) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: contents,
      config: {
        systemInstruction,
      },
    });

    res.json({ reply: response.text || fallbackChat(messages, inboxContext) });
  } catch (error: any) {
    console.log("[AI] Chat endpoint: Using local fallback assistant chatbot.");
    res.json({ reply: fallbackChat(messages, inboxContext) });
  }
});

// Vite server integration
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: path.join(process.cwd(), "frontend"),
      configFile: path.join(process.cwd(), "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
});
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "frontend", "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();