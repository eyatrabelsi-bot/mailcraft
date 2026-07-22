import React, { useState, useEffect, useRef } from "react";
import {
  Sparkles,
  Mail,
  Send,
  Bell,
  Trash2,
  FileText,
  Upload,
  Plus,
  X,
  ArrowLeft,
  Check,
  MessageSquare,
  Briefcase,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  Inbox,
  SendHorizontal,
  Search,
  User,
  ExternalLink,
  ChevronDown,
  Lock,
  CheckSquare,
  Edit2,
  Minimize2,
  Menu,
  History,
  Copy,
  LogOut
} from "lucide-react";

// Types for the application
interface Email {
  id: number;
  from: string;
  subject: string;
  body: string;
  date: string;
  read: boolean;
  urgency?: "Important" | "Medium" | "Faible";
  tag?: string;
  summary?: string;
  summarySource?: "ai" | "fallback"; // whether `summary` is real AI output or the degraded local fallback
  summaryReason?: string; // e.g. "quota_exceeded", "missing_api_key" — only set when summarySource is "fallback"
  gmailId?: string;   // stores the real Gmail message ID for replying
  isAutoReply?: boolean; // true for synthetic entries representing a sent auto-reply
}

interface Baseline {
  id: string;
  title: string;
  description: string;
  fileName: string;
  fileText: string;
  topicQuery: string;
}

interface MatchResult {
  emailId: number;
  matchedTopic: boolean;
  match: "perfect" | "partial" | "none";
  reasoning: string;
  draft: string;
}

// Renders an email's summary text, but tells the truth when it's the
// crude local fallback (quota exceeded, missing API key, network error)
// rather than presenting a truncated body as if it were a real AI summary.
function summaryLabel(email: Pick<Email, "summary" | "summarySource" | "summaryReason">, loadingText: string): string {
  if (!email.summary) return loadingText;
  if (email.summarySource !== "fallback") return email.summary;

  const reasonText: Record<string, string> = {
    quota_exceeded: "quota IA dépassé",
    missing_api_key: "clé API manquante",
    network_error: "serveur injoignable",
    empty_ai_response: "réponse IA vide",
    ai_error: "erreur IA",
  };
  const reason = email.summaryReason ? reasonText[email.summaryReason] || "IA indisponible" : "IA indisponible";
  return `⚠️ Résumé indisponible (${reason}) — aperçu : ${email.summary}`;
}

// --- AI request throttling & caching ---------------------------------------
// The Gemini free tier caps out at ~10 requests/minute. Without any pacing,
// summarizeAll() and triggerTriage() below each loop through every email and
// fire one fetch right after another with no delay — that alone blows
// through the quota in seconds once you have more than a handful of emails,
// independent of whatever the actual daily/monthly quota situation is.
// This serializes every AI call (summary + triage together, since they hit
// the same underlying model/quota) through one queue spaced safely under
// the limit, and caches results per email so reloading the page or
// re-triaging doesn't re-ask for something already known.
const AI_MIN_INTERVAL_MS = 6500; // ~9.2 req/min combined — comfortable margin under 10/min
let aiQueue: Promise<unknown> = Promise.resolve();
let lastAiCallAt = 0;

function throttledAiFetch(url: string, body: unknown): Promise<Response> {
  const run = aiQueue.then(async () => {
    const wait = Math.max(0, AI_MIN_INTERVAL_MS - (Date.now() - lastAiCallAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAiCallAt = Date.now();
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  });
  // Swallow errors on the queue chain itself so one failed call doesn't
  // permanently stall every AI request queued after it.
  aiQueue = run.catch(() => undefined);
  return run;
}

const AI_CACHE_PREFIX = "mailcraft_ai_cache_v1_";

function getAiCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(AI_CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function setAiCache(key: string, value: unknown) {
  try {
    localStorage.setItem(AI_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // localStorage full or unavailable — non-fatal, just skip caching this one
  }
}
// -----------------------------------------------------------------------

const DEFAULT_EMAILS: Email[] = [
  {
    id: 1,
    from: "rh@innovations-tech.fr",
    subject: "Candidature Stage de développeur React - Thomas Legrand",
    body: `Bonjour,

Je me permets de postuler à votre offre de stage de développeur React.
Actuellement en Licence 3 Informatique, je recherche un stage de 6 mois à compter de juillet 2026.

J'ai déjà réalisé deux projets personnels en React et Tailwind CSS (un dashboard de gestion de budget et un clone de Trello). J'ai également de solides compétences en TypeScript et Node.js.

Vous trouverez ci-joint mon CV détaillant mon parcours.

En vous remerciant pour l'attention que vous porterez à ma candidature, je reste à votre entière disposition pour un entretien.

Cordialement,
Thomas Legrand
06 12 34 56 78`,
    date: "Aujourd'hui, 09:30",
    read: false,
    urgency: "Important",
    tag: "Stage",
    summary: "Thomas Legrand postule pour un stage de 6 mois en React/Tailwind et dispose de projets personnels solides.",
    summarySource: "ai"
  },
  {
    id: 2,
    from: "admissions@sorbonne-universite.fr",
    subject: "Candidature Master Informatique — Pièces justificatives urgentes",
    body: `Bonjour,

Nous avons bien reçu votre dossier de candidature pour le Master 1 Informatique pour l'année universitaire 2026-2027.
Cependant, après vérification, il s'avère qu'il manque vos relevés de notes officiels du semestre 5 de votre Licence.

Veuillez s'il vous plaît téléverser ce document sur votre portail candidat sous 48 heures afin que nous puissions valider votre dossier. À défaut, votre candidature sera malheureusement déclarée incomplète et rejetée d'office.

Bien cordialement,
Le secrétariat des Admissions
Sorbonne Université`,
    date: "Aujourd'hui, 08:15",
    read: false,
    urgency: "Important",
    tag: "Study",
    summary: "Relevé de notes officiel du S5 manquant sous 48h sous peine de rejet définitif du dossier de Master 1.",
    summarySource: "ai"
  },
  {
    id: 3,
    from: "jean.dupont@stage-demande.com",
    subject: "Demande de stage de fin d'études — Data Analyst",
    body: `Madame, Monsieur,

Actuellement en dernière année d'école d'ingénieur, je recherche un stage de fin d'études de 6 mois à partir de septembre en tant que Data Analyst.

J'ai de l'expérience pratique en SQL, Python et PowerBI. Je n'ai pas encore travaillé sur des projets React, mais je suis très motivé pour apprendre de nouvelles technologies si nécessaire.

Je serais ravi de rejoindre votre équipe. Vous trouverez mon CV en pièce jointe.

Cordialement,
Jean Dupont`,
    date: "Hier, 17:45",
    read: true,
    urgency: "Medium",
    tag: "Stage",
    summary: "Jean Dupont recherche un stage de fin d'études de 6 mois en tant que Data Analyst.",
    summarySource: "ai"
  },
  {
    id: 4,
    from: "newsletter@frenchweb.fr",
    subject: "L'actualité tech de la semaine en France (Hebdo)",
    body: `Bonjour abonnés,

Voici votre revue hebdomadaire de l'actualité tech :
- Les levées de fonds de la semaine (Tech & IA)
- Le recrutement dans le secteur du numérique
- Les tendances 2026 des frameworks CSS et JS.

Bonne lecture,
L'équipe FrenchWeb`,
    date: "Hier, 14:10",
    read: true,
    urgency: "Faible",
    tag: "Email",
    summary: "Revue hebdomadaire de l'actualité tech française, levées de fonds et tendances frameworks.",
    summarySource: "ai"
  },
  {
    id: 5,
    from: "isabelle.martin@boulot-recrut.net",
    subject: "Candidature Stage Web - Isabelle Martin",
    body: `Bonjour,

Je recherche un stage de 2 mois en développement web à partir de juin.
Je connais HTML, CSS et un peu de JavaScript de base. Je n'ai pas d'expérience avec React ou Tailwind CSS mais j'aimerais beaucoup découvrir ces technologies pendant mon stage.

Cordialement,
Isabelle Martin`,
    date: "Hier, 10:05",
    read: true,
    urgency: "Medium",
    tag: "Stage",
    summary: "Isabelle Martin recherche un stage de 2 mois en développement web et souhaite découvrir React.",
    summarySource: "ai"
  }
];

interface DashboardProps {
  startWithSidebarOpen?: boolean;
  // When true, hides the "Boîte de réception" preview panel at the bottom
  // of the dashboard (e.g. for the trial/assistant-only entry point).
  hideInboxPreview?: boolean;
}

export default function Dashboard({ startWithSidebarOpen = true , hideInboxPreview = false,}: DashboardProps = {}) {
  const [emails, setEmails] = useState<Email[]>(DEFAULT_EMAILS);
  const [currentMail, setCurrentMail] = useState<Email | null>(null);
  
  // Connection and Activation States
  const [connected, setConnected] = useState<boolean>(false);
  // The actually-authenticated Google account (from /api/auth/status), so the
  // avatar/name shown in the UI matches whichever account's inbox is really
  // loaded — instead of the "evadorra5@gmail.com" placeholder that used to be
  // hardcoded regardless of who was really signed in.
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleName, setGoogleName] = useState<string | null>(null);
  const [googlePicture, setGooglePicture] = useState<string | null>(null);
  const [activated, setActivated] = useState<boolean>(false);
  const [isClassifying, setIsClassifying] = useState<boolean>(false);
  const [showMatchingOverlay, setShowMatchingOverlay] = useState<boolean>(false);
  
  // Persistent Notifications
  const [notifications, setNotifications] = useState<Email[]>([]);
  
  // Gmail active tab / folder
  const [activeFolder, setActiveFolder] = useState<string>("inbox");
  const [sentEmails, setSentEmails] = useState<any[]>([]);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState<string>("");
  
  // MailCraft Sidepanel State
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [activeSubTab, setActiveSubTab] = useState<"mailcraft_inbox" | "matching" | "assistant" | "triage">("mailcraft_inbox");

  // New Navigation and Sidebar States
  const [mainTab, setMainTab] = useState<"assistant" | "inbox">("assistant");
  const [mainSidebarOpen, setMainSidebarOpen] = useState<boolean>(startWithSidebarOpen);

  // Adjust sidebars automatically based on window size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false); // Collapses right AI panel
      }
      if (window.innerWidth < 768) {
        setMainSidebarOpen(false); // Collapses main left navigation
      }
    };
    // Run once on mount
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Chat Assistant State
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Bonjour ! Je suis MailCraft AI, votre assistant de messagerie. Je peux vous aider à rédiger des réponses, relire des emails, ou vous conseiller sur votre correspondance professionnelle. Que puis-je faire pour vous ?"
    }
  ]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  // Chat Sessions History State (For registering chats when connected)
  const [chatSessions, setChatSessions] = useState<Array<{ id: string; title: string; messages: Array<{ role: "user" | "assistant"; content: string }> }>>([
    {
      id: "session-initial",
      title: "Discussion Principale",
      messages: [
        {
          role: "assistant" as const,
          content: "Bonjour ! Je suis MailCraft AI, votre assistant de messagerie. Je peux vous aider à rédiger des réponses, relire des emails, ou vous conseiller sur votre correspondance professionnelle. Que puis-je faire pour vous ?"
        }
      ]
    }
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>("session-initial");

  // Sync current chat messages with the active chat session
  useEffect(() => {
    setChatSessions(prev => {
      return prev.map(session => {
        if (session.id === activeSessionId) {
          let newTitle = session.title;
          if (session.title === "Nouvelle conversation" || session.title === "Discussion Principale") {
            const firstUser = chatMessages.find(m => m.role === "user");
            if (firstUser) {
              newTitle = firstUser.content.slice(0, 32) + (firstUser.content.length > 32 ? "..." : "");
            }
          }
          return { ...session, messages: chatMessages, title: newTitle };
        }
        return session;
      });
    });
  }, [chatMessages, activeSessionId]);

  const handleSelectSession = (id: string) => {
    setActiveSessionId(id);
    const selected = chatSessions.find(s => s.id === id);
    if (selected) {
      setChatMessages(selected.messages);
    }
  };

  const handleNewChatSession = () => {
    const newId = `session-${Date.now()}`;
    const newSession = {
      id: newId,
      title: "Nouvelle conversation",
      messages: [
        {
          role: "assistant" as const,
          content: "Bonjour ! Je suis MailCraft AI, votre assistant de messagerie. Je peux vous aider à rédiger des réponses, relire des emails, ou vous conseiller sur votre correspondance professionnelle. Que puis-je faire pour vous ?"
        }
      ]
    };
    
    setChatSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    setChatMessages(newSession.messages);
    showToast("Nouvelle conversation créée !");
  };

  // Baselines for Mail Matching
  const [baselines, setBaselines] = useState<Baseline[]>([
    {
      id: "bl-1",
      title: "Critères Baseline 1",
      description: "",
      fileName: "",
      fileText: "",
      topicQuery: ""
    }
  ]);
  
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [matchResults, setMatchResults] = useState<Record<string, MatchResult[]>>({});
  const [activeBaselineId, setActiveBaselineId] = useState<string>("bl-1");
  const [extractingId, setExtractingId] = useState<string | null>(null);

  // Success Feedbacks
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Auto-send matching results state (Defaults to true per user request)
  const [autoSend, setAutoSend] = useState<boolean>(true);
  const [sentEmailIds, setSentEmailIds] = useState<number[]>([]);
  const [notifiedEmailIds, setNotifiedEmailIds] = useState<number[]>([]);
  const [promptsLeft, setPromptsLeft] = useState<number>(25);
  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ================= REAL GOOGLE OAUTH + GMAIL WIRING =================

  const handleConnectGoogle = () => {
    window.location.href = "/api/auth/google";
  };

  // Calls the backend logout route (destroys the session server-side),
  // then resets every piece of local state that depended on being
  // connected — otherwise stale emails/account info would keep showing
  // even though the session is gone.
  const handleDisconnectGoogle = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (err) {
      console.error("Logout request failed:", err);
    } finally {
      setConnected(false);
      setActivated(false);
      setGoogleEmail(null);
      setGoogleName(null);
      setGooglePicture(null);
      setEmails(DEFAULT_EMAILS);
      showToast("Déconnecté de Google. Vos emails réels ne sont plus affichés.");
    }
  };

  const fetchRealInbox = async () => {
    try {
      const res = await fetch("/api/gmail/inbox");
      if (!res.ok) return;
      const data = await res.json();
      const incoming: any[] = data.emails || [];

      setEmails(prev => {
        // Key by gmailId (the real, stable Gmail message id) rather than
        // array index, so a poll that finds new mail at the top doesn't
        // shift everyone else's identity. For emails we already have,
        // keep whatever MailCraft already computed (urgency/tag/summary)
        // instead of clobbering it with a blank re-fetched copy — that's
        // what was forcing a full silent re-triage/re-summarize on every
        // refresh, and made "new mail" indistinguishable from "lost all
        // classifications".
        const existingByGmailId = new Map(prev.map(e => [e.gmailId, e]));
        let nextLocalId = prev.reduce((max, e) => Math.max(max, e.id), 0) + 1;

        const merged: Email[] = incoming.map((e: any) => {
          const existing = existingByGmailId.get(e.id);
          if (existing) {
            return { ...existing, from: e.from, subject: e.subject, body: e.body, date: e.date, read: e.read };
          }
          return {
            id: nextLocalId++,
            gmailId: e.id,
            from: e.from,
            subject: e.subject,
            body: e.body,
            date: e.date,
            read: e.read,
          };
        });
        return merged;
      });
    } catch (err) {
      console.error("Failed to load real inbox:", err);
    }
  };

  // On load: check if already logged in (or just redirected back from Google), then load real inbox
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/status");
        const data = await res.json();
        if (data.connected) {
          setConnected(true);
          setGoogleEmail(data.email || null);
          setGoogleName(data.name || null);
          setGooglePicture(data.picture || null);
          fetchRealInbox();
          // Clean the ?auth_success=true param from the URL bar
          window.history.replaceState({}, "", "/");
        }
      } catch (err) {
        console.error("Auth status check failed:", err);
      }
    };
    checkAuth();
  }, []);

  // Poll for new mail while connected — this is what was missing entirely
  // before: fetchRealInbox only ever ran once, on mount, so nothing short
  // of a full page reload (F5) would ever pick up mail that arrived after
  // that. fetchRealInbox itself now merges by gmailId (see above) so this
  // poll won't reset classification work already done on existing mail —
  // it only adds genuinely new messages. triggerTriage() is safe to call
  // repeatedly since it already skips anything with .urgency set, so it
  // will only classify (and, for Important, summarize + notify) the
  // newly-arrived ones each cycle.
  useEffect(() => {
    if (!connected) return;
    const intervalId = setInterval(fetchRealInbox, 25000);
    return () => clearInterval(intervalId);
  }, [connected]);

  // Classify any mail that doesn't have a urgency yet — covers both the
  // initial fetch and anything the poll above just merged in. Deliberately
  // a separate effect (rather than chaining off the poll directly) so it
  // always closes over the current `emails`/`triggerTriage`; chaining
  // triggerTriage() straight off the interval's setInterval callback would
  // capture a stale closure from whenever [connected] last changed, not
  // the freshly-merged state.
  useEffect(() => {
    if (!activated || isClassifying) return;
    if (emails.some(e => !e.urgency)) {
      triggerTriage();
    }
  }, [emails, activated]);

  // Scroll to bottom when new messages are added or loaded
  useEffect(() => {
    const container = chatEndRef.current?.parentElement;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [chatMessages, chatLoading]);

  // Automatically generate summaries for all emails on load
  useEffect(() => {
    const summarizeAll = async () => {
      let changed = false;
      const updated = [...emails];
      for (let i = 0; i < updated.length; i++) {
        if (!updated[i].summary) {
          const cacheKey = "summary:" + (updated[i].gmailId ?? updated[i].id);
          const cached = getAiCache<{ summary: string; source: string; reason?: string }>(cacheKey);
          if (cached) {
            updated[i] = {
              ...updated[i],
              summary: cached.summary,
              summarySource: cached.source === "ai" ? "ai" : "fallback",
              summaryReason: cached.source === "ai" ? undefined : cached.reason,
            };
            changed = true;
            continue;
          }
          try {
            const res = await throttledAiFetch("/api/summary", { body: updated[i].body });
            if (res.ok) {
              const data = await res.json();
              if (data.summary) {
                updated[i] = {
                  ...updated[i],
                  summary: data.summary,
                  summarySource: data.source === "ai" ? "ai" : "fallback",
                  summaryReason: data.source === "ai" ? undefined : data.reason,
                };
                // Only cache real AI results — caching a fallback would
                // permanently lock that email to the degraded summary
                // even after the quota/model issue is fixed.
                if (data.source === "ai") setAiCache(cacheKey, data);
                changed = true;
              }
            }
          } catch (err) {
            console.log("Failed to generate auto summary for email " + updated[i].id + ", using local fallback.");
            // The server itself is unreachable here (not just degraded) —
            // still flag it as a fallback so the UI doesn't present this
            // crude truncation as if it were a real AI summary.
            updated[i] = {
              ...updated[i],
              summary: updated[i].body.split(".")[0] + ".",
              summarySource: "fallback",
              summaryReason: "network_error",
            };
            changed = true;
          }
        }
      }
      if (changed) {
        setEmails(updated);
      }
    };
    summarizeAll();
  }, []);

  const triggerTriage = async () => {
    setIsClassifying(true);
    const updatedEmails = [...emails];
    
    for (let i = 0; i < updatedEmails.length; i++) {
      const email = updatedEmails[i];
      // Skip if already triaged
      if (email.urgency) continue;

      const triageCacheKey = "triage:" + (email.gmailId ?? email.id);
      const cachedTriage = getAiCache<{ urgency: "Important" | "Medium" | "Faible"; tag: string }>(triageCacheKey);

      let result: { urgency: "Important" | "Medium" | "Faible"; tag: string } | null = cachedTriage;

      if (!result) {
        try {
          const response = await throttledAiFetch("/api/triage", { body: email.body });
          if (response.ok) {
            result = await response.json();
            setAiCache(triageCacheKey, result);
          }
        } catch (err) {
          console.log("Unable to classify email, using rule-based fallback.");
        }
      }

      if (!result) continue;

      email.urgency = result.urgency;
      email.tag = result.tag;

      // If the email is classified as "Important", trigger AI Summary and a persistent notification
      if (result.urgency === "Important" && !email.summary) {
        const summaryCacheKey = "summary:" + (email.gmailId ?? email.id);
        const cachedSummary = getAiCache<{ summary: string; source: string; reason?: string }>(summaryCacheKey);

        let sumResult: { summary: string; source: string; reason?: string } | null = cachedSummary;

        if (!sumResult) {
          try {
            const sumResponse = await throttledAiFetch("/api/summary", { body: email.body });
            if (sumResponse.ok) {
              sumResult = await sumResponse.json();
              if (sumResult && sumResult.source === "ai") setAiCache(summaryCacheKey, sumResult);
            }
          } catch (err) {
            console.log("Unable to summarize email " + email.id + ".");
          }
        }

        if (sumResult) {
          email.summary = sumResult.summary;
          email.summarySource = sumResult.source === "ai" ? "ai" : "fallback";
          email.summaryReason = sumResult.source === "ai" ? undefined : sumResult.reason;

          // Trigger persistent notification if it's not already shown
          setNotifications(prev => {
            if (prev.some(n => n.id === email.id)) return prev;
            return [...prev, email];
          });

          // Add to notifiedEmailIds so it displays in the inbox
          setNotifiedEmailIds(prev => {
            if (prev.includes(email.id)) return prev;
            return [...prev, email.id];
          });
        }
      }

      // Force state update to show progress live
      setEmails([...updatedEmails]);
    }
    setIsClassifying(false);
  };

  // Auto-classify and initialize notifications only when activated
  useEffect(() => {
    if (activated) {
      // Set initial notifications and notifiedEmailIds for pre-existing important emails
      const unreadImportants = emails.filter(e => e.urgency === "Important" && !e.read);
      setNotifications(unreadImportants);
      setNotifiedEmailIds(unreadImportants.map(e => e.id));
      triggerTriage();
    } else {
      setNotifications([]);
      setNotifiedEmailIds([]);
    }
  }, [activated]);

  // Helper to trigger criteria extraction from file content
  const handleExtractCriteria = async (baselineId: string, fileText: string) => {
    if (!fileText.trim()) return;
    setExtractingId(baselineId);
    try {
      const response = await fetch("/api/extract-criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileText }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setBaselines(prev => prev.map(b => b.id === baselineId ? { ...b, description: data.criteria } : b));
        showToast("Critères extraits du fichier avec succès par l'IA !");
      }
    } catch (err) {
      console.log("Criteria extraction failed, using rule-based baseline extraction.");
    } finally {
      setExtractingId(null);
    }
  };

  // Handle local text file uploads
  const handleFileUpload = (baselineId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      setBaselines(prev => prev.map(b => b.id === baselineId ? { ...b, fileName: file.name, fileText: text } : b));
      // Trigger automatic extraction of criteria from the uploaded file
      await handleExtractCriteria(baselineId, text);
    };
    reader.readAsText(file);
  };

  // Perform the primary Mail Matching algorithm over the emails
  const handleScanInbox = async (baseline: Baseline) => {
    setIsScanning(true);
    try {
      // Prepare the emails to scan
      const emailsPayload = emails.map(e => ({
        emailId: e.id,
        subject: e.subject,
        body: e.body
      }));

      const response = await fetch("/api/match-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: baseline.topicQuery,
          criteria: baseline.description,
          emails: emailsPayload
        })
      });

      if (response.ok) {
        const data = await response.json();
        // Save the match results mapped by baseline ID
        setMatchResults(prev => ({
          ...prev,
          [baseline.id]: data.results
        }));

        const matchedList = data.results.filter((r: any) => r.matchedTopic);
        showToast(`Scan de la boîte de réception terminé. ${matchedList.length} email(s) trouvé(s) !`);

        if (autoSend && matchedList.length > 0) {
          const newSent: any[] = [];
          const autoSentIds: number[] = [];
          const updatedEmails = [...emails];

          matchedList.forEach((res: any) => {
            const originalEmail = updatedEmails.find(e => e.id === res.emailId);
            if (originalEmail && res.draft) {
              newSent.push({
                id: Date.now() + Math.random(),
                to: originalEmail.from,
                subject: `Re: ${originalEmail.subject}`,
                body: res.draft,
                date: "Envoi automatique (MailCraft AI)"
              });
              originalEmail.read = true;
              autoSentIds.push(res.emailId);
            }
          });

          if (newSent.length > 0) {
            setSentEmails(prev => [...prev, ...newSent]);
            setSentEmailIds(prev => [...prev, ...autoSentIds]);
            setEmails(updatedEmails);
            showToast(`${newSent.length} réponse(s) générée(s) et envoyée(s) automatiquement sans validation !`);
          }
        }
      }
    } catch (err) {
      console.log("Scan inbox experienced a connection limit or failure, using offline matcher.");
    } finally {
      setIsScanning(false);
    }
  };

  // Chat with integrated AI assistant
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    if (!connected && promptsLeft <= 0) {
      setShowUpgradeModal(true);
      setChatMessages(prev => [
        ...prev,
        { role: "user" as const, content: chatInput },
        {
          role: "assistant",
          content: "⚠️ Limite atteinte ! Vous avez consommé vos 25 prompts gratuits pour cette période de 6 heures.\n\nConnectez votre compte Google Gmail pour obtenir des prompts illimités et activer l'extension de triage, réponse automatique et notifications d'importance !"
        }
      ]);
      setChatInput("");
      return;
    }

    const userMsg = { role: "user" as const, content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    if (!connected) {
      setPromptsLeft(prev => {
        const next = Math.max(0, prev - 1);
        if (next === 0) {
          setShowUpgradeModal(true);
        }
        return next;
      });
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...chatMessages, userMsg]
        })
      });

      if (response.ok) {
        const data = await response.json();
        setChatMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      } else {
        setChatMessages(prev => [...prev, { role: "assistant", content: "Désolé, j'ai rencontré un problème pour générer la réponse. Veuillez réessayer." }]);
      }
    } catch (err) {
      console.log("Chat assistant connection exception, using offline assistant replies.");
      setChatMessages(prev => [...prev, { role: "assistant", content: "Erreur réseau. Veuillez vérifier votre connexion et réessayer." }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Validate a draft: send it for real via Gmail if connected, otherwise simulate
  const handleValidateDraft = async (emailId: number, draftText: string) => {
    const originalEmail = emails.find(e => e.id === emailId);
    if (!originalEmail) return;

    if (connected && originalEmail.gmailId) {
      try {
        const res = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: originalEmail.from,
            subject: `Re: ${originalEmail.subject}`,
            body: draftText,
            threadId: originalEmail.gmailId,
          }),
        });
        if (!res.ok) throw new Error("Send failed");
      } catch (err) {
        showToast("Erreur : l'email n'a pas pu être envoyé.");
        return;
      }
    }

    setSentEmails(prev => [
      ...prev,
      { id: Date.now(), to: originalEmail.from, subject: `Re: ${originalEmail.subject}`, body: draftText, date: "À l'instant" }
    ]);
    setSentEmailIds(prev => [...prev, emailId]);
    setEmails(prev => prev.map(e => e.id === emailId ? { ...e, read: true } : e));
    showToast(connected ? "Email envoyé avec succès via Gmail !" : "Le brouillon a été validé et enregistré avec succès dans Gmail !");
  };

  // Manage UI feedback toasts
  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4500);
  };

  // Clear a persistent notification only when user opens/reads the email
  const handleOpenNotification = (notification: Email) => {
    setNotifications(prev => prev.filter(n => n.id !== notification.id));
    const originalMail = emails.find(e => e.id === notification.id) || notification;
    setMainTab("inbox");
    setCurrentMail(originalMail);
    setActiveFolder("inbox");
    // Mark as read too
    setEmails(prev => prev.map(e => e.id === notification.id ? { ...e, read: true } : e));
  };

  const handleSelectMail = (email: Email) => {
    setCurrentMail(email);
    // Remove from important notifications if it was there when opened manually
    setNotifications(prev => prev.filter(n => n.id !== email.id));
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, read: true } : e));
  };

  const filteredEmails = emails.filter(e => {
    if (searchQuery.trim() === "") return true;
    return e.subject.toLowerCase().includes(searchQuery.toLowerCase()) || 
           e.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
           e.body.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Sent auto-replies, reshaped to the Email type so they can render in the
  // same list as received mail. `from` is repurposed to show who the reply
  // went to, since these are outbound, not inbound.
  const autoReplyEntries: Email[] = sentEmails.map(s => ({
    id: s.id,
    from: `Réponse → ${s.to}`,
    subject: s.subject,
    body: s.body,
    date: s.date,
    read: true,
    isAutoReply: true,
  }));

  // MailCraft AI's own inbox is a curated view, not a mirror of raw Gmail:
  // - Inbox: only mail the AI classified as "Important", plus a copy of
  //   every auto-reply MailCraft sent for a matched email. Everything else
  //   (Medium/Faible, or not yet classified) stays out of this list.
  // - Sent: regular sent emails (validated drafts + auto-replies)
  const displayEmails = activeFolder === "inbox"
    ? [
        ...filteredEmails.filter(e => e.urgency === "Important" && !sentEmailIds.includes(e.id)),
        ...autoReplyEntries,
      ].sort((a, b) => b.id - a.id)
    : filteredEmails.filter(e => !sentEmailIds.includes(e.id));

  return (
    <div className="h-screen bg-slate-900 text-slate-100 flex flex-col font-sans select-none antialiased overflow-hidden">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed bottom-6 left-6 z-50 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3.5 rounded-xl shadow-2xl border border-emerald-500 flex items-center gap-3 animate-bounce">
          <CheckCircle2 size={20} className="text-emerald-200 shrink-0" />
          <span className="font-medium text-sm">{successToast}</span>
          <button onClick={() => setSuccessToast(null)} className="text-emerald-200 hover:text-white ml-2 text-xs">
            ✕
          </button>
        </div>
      )}

      {/* Persistent Notifications Stack (Cannot be closed/deleted without opening the email) */}
      {notifications.length > 0 && (
        <div className="fixed top-20 right-6 z-50 flex flex-col gap-3 w-96 max-w-[90vw]">
          {notifications.map((notif) => (
            <div 
              key={notif.id}
              className="bg-slate-950 border-2 border-rose-500 rounded-2xl shadow-2xl overflow-hidden p-4 relative animate-pulse flex flex-col gap-2"
              id={`important-notif-${notif.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-rose-400">
                  <Bell size={18} className="animate-bounce" />
                  <span className="text-xs uppercase font-extrabold tracking-widest">Urgent important !</span>
                </div>
                <div className="text-[10px] bg-rose-500/10 text-rose-400 px-2.5 py-0.5 rounded-full font-semibold border border-rose-500/20">
                  Persistant
                </div>
              </div>

              <div className="mt-1">
                <h4 className="text-sm font-semibold text-slate-100 line-clamp-1">{notif.subject}</h4>
                <p className="text-xs text-rose-300 mt-1.5 leading-relaxed bg-rose-950/25 p-2.5 rounded-lg border border-rose-500/10">
                  <strong className="text-rose-200">Résumé IA :</strong> {summaryLabel(notif, "Génération du résumé...")}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-slate-800">
                <span className="text-[10px] text-slate-400 italic">Obligatoire d'ouvrir pour effacer</span>
                <button
                  onClick={() => handleOpenNotification(notif)}
                  className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer"
                >
                  Ouvrir <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Application Header / Masthead */}
      <header className="bg-slate-950 border-b border-slate-800 px-4 md:px-6 py-3.5 md:py-4 flex flex-col sm:flex-row sm:items-center justify-between shrink-0 gap-3">
        <div className="flex items-center gap-2.5">
          {/* Main Sidebar Toggle Button */}
          <button
            onClick={() => setMainSidebarOpen(!mainSidebarOpen)}
            className="p-2 rounded-lg hover:bg-slate-900 text-slate-400 hover:text-slate-100 transition-colors border border-slate-800/80"
            title={mainSidebarOpen ? "Masquer la barre latérale" : "Afficher la barre latérale"}
          >
            <Menu size={16} />
          </button>
          
          <div className="w-8 h-8 md:w-9 md:h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 shrink-0">
            <Sparkles size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base md:text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-300 via-purple-300 to-indigo-100 bg-clip-text text-transparent">
              MailCraft AI
            </h1>
            <p className="text-slate-400 text-[9px] md:text-[10px] uppercase tracking-wider font-semibold hidden min-[380px]:block">Triage & Correspondance Gmail</p>
          </div>
        </div>

        {/* Global Connection Controls */}
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-4 justify-end">
          {!connected ? (
            <button
              onClick={handleConnectGoogle}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4.5 py-2 rounded-xl transition-all shadow-md shadow-indigo-600/10 flex items-center gap-2 cursor-pointer"
            >
              <Plus size={15} /> Connecter avec Google
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3.5 py-1.5 rounded-xl text-xs font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Gmail Connecté
              </div>
              
              {!activated ? (
                <button
                  onClick={() => {
                    setActivated(true);
                    showToast("MailCraft AI activé ! Début du triage automatique en arrière-plan.");
                  }}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-semibold px-4.5 py-2 rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles size={14} /> Activer le tri IA
                </button>
              ) : (
                <div className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5">
                  <Sparkles size={13} className="text-purple-300 animate-spin" />
                  Tri IA Actif
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Main Unified Sidebar + Tab View Container */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* 1. Main Navigation Sidebar on Left */}
        {mainSidebarOpen && (
          <>
            {/* Backdrop for left navigation sidebar on mobile/tablet */}
            <div
              className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-40 md:hidden"
              onClick={() => setMainSidebarOpen(false)}
            />
            <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 shadow-2xl transition-all duration-300 h-full">
            <div className="flex-1 p-3.5 flex flex-col gap-1.5 overflow-y-auto">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 px-3.5 block mb-2">Navigation</span>
              
              <button
                onClick={() => setMainTab("assistant")}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all ${mainTab === "assistant" ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20" : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"}`}
              >
                <MessageSquare size={15} />
                <span>💬 Assistant IA</span>
                {connected && (
                  <span className="ml-auto text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                    Illimité
                  </span>
                )}
              </button>

              <button
                onClick={() => setMainTab("inbox")}
                className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-semibold transition-all ${mainTab === "inbox" ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20" : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 border border-transparent"}`}
              >
                <div className="flex items-center gap-3">
                  <Inbox size={15} />
                  <span>📬 Boîte de réception</span>
                </div>
                {connected && (emails.filter(e => e.urgency === "Important" && !sentEmailIds.includes(e.id)).length + autoReplyEntries.length) > 0 && (
                  <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] px-2 py-0.5 rounded-full font-bold">
                    {emails.filter(e => e.urgency === "Important" && !sentEmailIds.includes(e.id)).length + autoReplyEntries.length}
                  </span>
                )}
              </button>

              {/* Chat history section: only visible in the Assistant tab */}
              {mainTab === "assistant" && (
                <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-col gap-2 flex-1 min-h-[220px]">
                  <div className="flex items-center justify-between px-2 mb-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
                      <History size={11} /> Historique des chats
                    </span>
                    {connected && (
                      <button
                        onClick={handleNewChatSession}
                        className="p-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-500/20 transition-all cursor-pointer"
                        title="Nouvelle conversation"
                      >
                        <Plus size={11} />
                      </button>
                    )}
                  </div>

                  {!connected ? (
                    <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800/60 text-center flex flex-col items-center justify-center gap-1.5">
                      <Lock size={14} className="text-slate-500" />
                      <p className="text-[10px] font-semibold text-slate-400">Historique inactif</p>
                      <p className="text-[9px] text-slate-500 leading-normal">
                        Connectez-vous pour enregistrer l'historique de vos conversations.
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                      {chatSessions.map((session) => (
                        <button
                          key={session.id}
                          onClick={() => handleSelectSession(session.id)}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-[11px] truncate block transition-all ${activeSessionId === session.id ? "bg-slate-900 text-indigo-300 font-semibold border border-indigo-500/20" : "text-slate-400 hover:bg-slate-900/40 hover:text-slate-200 border border-transparent"}`}
                        >
                          {session.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950/40">
              {!connected ? (
                <button
                  onClick={handleConnectGoogle}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] py-2.5 px-3 rounded-xl shadow-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-indigo-400/10 animate-pulse"
                >
                  <Plus size={12} /> Connecter avec Google
                </button>
              ) : (
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center gap-2.5 p-1">
                    {googlePicture ? (
                      <img
                        src={googlePicture}
                        alt={googleName || googleEmail || "Compte Google"}
                        referrerPolicy="no-referrer"
                        onError={() => setGooglePicture(null)}
                        className="w-7 h-7 rounded-full border border-indigo-500/30 shadow-sm shrink-0 object-cover"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 text-xs font-extrabold shadow-sm shrink-0">
                        {(googleName || googleEmail || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="truncate flex-1">
                      <p className="text-[10px] font-bold text-slate-200 truncate">
                        {googleName || googleEmail || "Compte Google"}
                      </p>
                      {googleName && googleEmail ? (
                        <p className="text-[9px] text-slate-500 truncate">{googleEmail}</p>
                      ) : (
                        <p className="text-[9px] text-emerald-400 font-semibold flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-ping" />
                          Services actifs
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleDisconnectGoogle}
                    className="w-full flex items-center justify-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-slate-800/80 hover:border-rose-500/20 rounded-xl py-2 px-3 transition-all cursor-pointer"
                  >
                    <LogOut size={12} /> Déconnecter
                  </button>
                </div>
              )}
            </div>
          </aside>
          </>
        )}

        {/* 2. Main content tab area */}
        <div className="flex-1 flex overflow-hidden">
          {mainTab === "assistant" ? (
            /* ================= ASSISTANT VIEW ================= */
            <div className="flex-1 overflow-y-auto bg-slate-900/60 p-6 flex flex-col gap-6 max-w-4xl w-full mx-auto">
              
              {/* TOP: Assistant IA MailCraft Box */}
              <div className="bg-slate-950/60 rounded-2xl border border-slate-800 flex flex-col h-[400px] shadow-xl">
                <div className="p-4.5 border-b border-slate-800/80 flex items-center justify-between bg-slate-950/40 rounded-t-2xl">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <MessageSquare size={16} />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-100">Assistant IA MailCraft</h3>
                      <p className="text-[10px] text-slate-500">{connected ? "Mode connecté (Illimité)" : "Mode autonome temporaire"}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end">
                    {connected ? (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold px-2.5 py-0.5 rounded-full">
                        Requêtes Illimitées
                      </span>
                    ) : (
                      <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold px-2.5 py-0.5 rounded-full">
                        {promptsLeft} requêtes restantes
                      </span>
                    )}
                  </div>
                </div>

                {/* Chat messages list */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col bg-slate-950/20">
                  {chatMessages.map((msg, index) => {
                    const isCopied = copiedMessageIndex === index;
                    return (
                      <div key={index} className={`flex items-start gap-2.5 max-w-[85%] ${msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"} group relative`}>
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${msg.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"}`}>
                          {msg.role === "user" ? <User size={13} /> : <Sparkles size={13} />}
                        </div>
                        <div className={`p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-wrap relative ${msg.role === "user" ? "bg-indigo-600/90 text-white rounded-tr-none" : "bg-slate-900 border border-slate-800/80 text-slate-300 rounded-tl-none"}`}>
                          {msg.content}
                          
                          {/* Copy Button */}
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(msg.content);
                              setCopiedMessageIndex(index);
                              showToast("Copié dans le presse-papiers !");
                              setTimeout(() => setCopiedMessageIndex(null), 2000);
                            }}
                            className={`absolute -top-2 ${msg.role === "user" ? "-left-2" : "-right-2"} bg-slate-900 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-950 text-slate-400 hover:text-indigo-400 p-1.5 rounded-lg transition-all opacity-0 group-hover:opacity-100 shadow-lg cursor-pointer flex items-center gap-1 z-10`}
                            title="Copier le message"
                          >
                            {isCopied ? (
                              <Check size={10} className="text-emerald-400" />
                            ) : (
                              <Copy size={10} />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {chatLoading && (
                    <div className="flex items-start gap-2.5 max-w-[85%]">
                      <div className="w-7 h-7 rounded-full bg-slate-800 flex items-center justify-center text-xs shrink-0">
                        <Sparkles size={13} className="animate-spin text-indigo-400" />
                      </div>
                      <div className="bg-slate-900 border border-slate-800/80 text-slate-400 p-3.5 rounded-2xl text-xs rounded-tl-none flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  )}
                  {/* Scroll Anchor */}
                  <div ref={chatEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 rounded-b-2xl">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChatMessage();
                        }
                      }}
                      placeholder={connected || promptsLeft > 0 ? "Posez une question ou demandez de l'aide pour rédiger..." : "Limite de prompts atteinte. Cliquez pour débloquer !"}
                      onClick={() => {
                        if (!connected && promptsLeft <= 0) {
                          setShowUpgradeModal(true);
                        }
                      }}
                      disabled={chatLoading}
                      className="flex-1 bg-slate-900/80 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 transition-all disabled:opacity-50"
                    />
                    <button
                      onClick={() => {
                        if (!connected && promptsLeft <= 0) {
                          setShowUpgradeModal(true);
                        } else {
                          handleSendChatMessage();
                        }
                      }}
                      disabled={chatLoading || (!chatInput.trim() && (connected || promptsLeft > 0))}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white p-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-40 shrink-0 flex items-center justify-center"
                    >
                      <Send size={15} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Conditional "Débloquez la puissance" block: ONLY displayed when NOT connected */}
              {!connected && (
                <div className="bg-gradient-to-r from-indigo-950/50 via-purple-950/40 to-slate-950 rounded-2xl border-2 border-rose-500/40 p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl relative overflow-hidden animate-pulse">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/15 rounded-full blur-2xl -mr-10 -mt-10" />
                  <div className="flex items-center gap-4.5">
                    <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
                      <Lock size={22} className="text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-extrabold text-slate-100">Débloquez la puissance</h3>
                      <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
                        Vous êtes actuellement en mode autonome limité. Connectez votre compte Google pour débloquer les invitations illimitées, l'historique complet des discussions, le triage intelligent et la gestion de votre boîte mail.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleConnectGoogle}
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold text-xs py-3 px-5 rounded-xl shadow-lg shadow-indigo-600/10 hover:shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer border border-indigo-400/20 shrink-0"
                  >
                    <Plus size={15} /> Connecter avec Google
                  </button>
                </div>
              )}

              {/* BOTTOM: Boîte de Réception preview when not connected */}
              {!connected && !hideInboxPreview && (
                <div className="bg-slate-950/40 rounded-2xl border border-slate-800/80 p-5 flex flex-col gap-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <Inbox size={15} className="text-indigo-400" />
                      <h3 className="text-xs font-bold text-slate-200">Boîte de réception MailCraft AI</h3>
                    </div>
                    {activated ? (
                      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse">
                        Active & triée par l'IA
                      </span>
                    ) : (
                      <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full font-semibold">
                        Mails notifiés uniquement
                      </span>
                    )}
                  </div>

                  {!activated ? (
                    /* List of unread/notified emails - INACTIVE LOCK STATE */
                    <div className="p-8 text-center text-slate-500 bg-slate-950/20 rounded-xl border border-slate-800/40">
                      <Lock size={22} className="mx-auto text-indigo-400 mb-2.5" />
                      <p className="text-xs font-bold text-slate-300">Boîte de réception inactive (Extension non activée)</p>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto leading-relaxed">
                        Les alertes d'importance et les résumés automatiques de la boîte mail ne s'envoient pas tant que votre compte n'est pas connecté. Activez le tri IA dans la barre latérale pour démarrer.
                      </p>
                    </div>
                  ) : (
                    /* ACTIVE STATE: SHOW LIVE IA TRIAGED EMAILS */
                    <div className="flex flex-col gap-3">
                      {isClassifying && (
                        <div className="flex items-center gap-2 p-3 bg-indigo-950/20 border border-indigo-500/15 rounded-xl text-xs text-indigo-300">
                          <RefreshCw size={13} className="animate-spin text-indigo-400" />
                          <span>L'IA analyse et trie vos emails en direct...</span>
                        </div>
                      )}

                      {emails.length === 0 ? (
                        <p className="text-xs text-slate-500 text-center py-4">Aucun email dans la boîte.</p>
                      ) : (
                        <div className="flex flex-col gap-3 max-h-[450px] overflow-y-auto pr-1">
                          {emails.map((mail) => {
                            const isImportant = mail.urgency === "Important";
                            return (
                              <div
                                key={mail.id}
                                className={`p-4 rounded-xl border transition-all ${
                                  isImportant
                                    ? "bg-slate-950/85 border-rose-500/30 hover:border-rose-500/50 shadow-md shadow-rose-950/5"
                                    : "bg-slate-950/40 border-slate-800/60 hover:border-slate-700/50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-bold text-slate-200">{mail.from}</span>
                                    {mail.urgency && (
                                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                                        mail.urgency === "Important" ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" :
                                        mail.urgency === "Medium" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                                        "bg-slate-800 text-slate-400 border border-slate-700/50"
                                      }`}>
                                        {mail.urgency}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-slate-500 font-medium shrink-0">{mail.date}</span>
                                </div>

                                <h4 className="text-xs font-bold text-slate-100 mb-1.5">{mail.subject}</h4>
                                
                                {mail.summary ? (
                                  <div className="p-3 bg-indigo-950/15 border border-indigo-500/10 rounded-lg text-[11px] text-indigo-200 italic mb-2 flex items-start gap-1.5">
                                    <Sparkles size={11} className="text-indigo-400 shrink-0 mt-0.5" />
                                    <span>
                                      <strong>Résumé IA :</strong> {summaryLabel(mail, "")}
                                    </span>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed mb-2">{mail.body}</p>
                                )}

                                {/* Collapsible text body details */}
                                <details className="group mt-2">
                                  <summary className="text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider cursor-pointer list-none flex items-center gap-1">
                                    <span className="transition-transform group-open:rotate-90">▶</span> Voir l'e-mail complet
                                  </summary>
                                  <p className="mt-2.5 p-3 bg-slate-900/60 border border-slate-850 rounded-lg text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">
                                    {mail.body}
                                  </p>
                                </details>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>
          ) : (
            /* ================= INBOX VIEW ================= */
            !connected ? (
              <div className="flex-1 flex flex-col items-center justify-center bg-slate-900/40 p-8 text-center">
                <div className="max-w-md bg-slate-950/60 p-8 rounded-2xl border border-slate-800/80 shadow-2xl flex flex-col items-center">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-5 shadow-inner">
                    <Lock size={28} />
                  </div>
                  <h3 className="text-sm font-extrabold text-slate-100 uppercase tracking-wider mb-2">Boîte de réception verrouillée</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-6">
                    L'affichage de votre boîte de réception Gmail et le triage automatique MailCraft IA requièrent la connexion de votre compte.
                  </p>
                  <button
                    onClick={handleConnectGoogle}
                    className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs py-3 px-6 rounded-xl shadow-lg transition-all flex items-center gap-2 cursor-pointer animate-pulse"
                  >
                    <Plus size={14} /> Connecter avec Google
                  </button>
                </div>
              </div>
            ) : (
              /* When connected, we show the mockup Gmail workspace + side center. We close the layout containers at the end of the file! */
              <>
                {/* LEFT: Gmail Interface Mockup */}
                <div className="flex-1 flex flex-col bg-slate-900 border-r border-slate-800">
          
          {/* Mock Gmail Top Header / Toolbar styled like real Gmail */}
          <div className="bg-slate-950/90 border-b border-slate-800/80 px-4 md:px-6 py-2.5 flex items-center justify-between gap-4 shrink-0">
            {/* Left Brand Panel */}
            <div className="flex items-center gap-3">
              <button className="text-slate-400 hover:text-slate-200 transition-colors p-1.5 rounded-full hover:bg-slate-800" title="Menu principal">
                <Menu size={16} />
              </button>
              
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-rose-600 rounded-lg flex items-center justify-center text-[10px] font-extrabold text-white shadow-md shadow-rose-950/20">
                  M
                </div>
                <span className="text-xs font-bold tracking-wider text-slate-100 uppercase font-sans">Gmail</span>
                <span className="bg-indigo-500/10 text-indigo-300 text-[8px] font-bold px-1.5 py-0.5 rounded border border-indigo-500/20 uppercase tracking-widest">Workspace</span>
              </div>
            </div>

            {/* Middle Search Input with Advanced Filters */}
            <div className="flex-1 max-w-xl relative flex items-center">
              <Search size={14} className="absolute left-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher dans votre boîte Gmail..."
                className="w-full bg-slate-900/60 border border-slate-800 hover:border-slate-700 focus:bg-slate-900/90 rounded-full py-2 pl-9 pr-10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30 transition-all"
              />
              <button className="absolute right-3.5 text-slate-400 hover:text-slate-200 p-1 rounded-full hover:bg-slate-800" title="Options de recherche">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </button>
            </div>

            {/* Right Interactive Controls */}
            <div className="flex items-center gap-3">
              {/* Help Circle */}
              <button className="hidden sm:inline-flex text-slate-400 hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-800/60 transition-colors" title="Aide">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>

              {/* Settings Gear */}
              <button className="hidden sm:inline-flex text-slate-400 hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-800/60 transition-colors" title="Paramètres">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>

              {/* INTEGRATED EXTENSION ACTION BUTTON */}
              {activated ? (
                <button
                  onClick={() => {
                    setSidebarOpen(true);
                    setActiveSubTab("assistant");
                    setShowMatchingOverlay(true);
                    showToast("Extension MailCraft AI ouverte ! Panneau de l'assistant à droite, Mail Matching au centre.");
                  }}
                  className="relative group p-2 rounded-full hover:bg-slate-800 transition-all cursor-pointer flex items-center justify-center border border-indigo-500/30 bg-gradient-to-tr from-indigo-950/40 via-purple-950/40 to-pink-950/20 shadow-lg shadow-indigo-500/10 animate-pulse"
                  title="Ouvrir l'Extension MailCraft AI (Assistant + Mail Matching)"
                >
                  <Sparkles size={16} className="text-indigo-400 group-hover:text-pink-400 transition-colors" />
                  {/* Glowing active notification indicator */}
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-pink-500 animate-ping" />
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-pink-500" />
                </button>
              ) : (
                <div 
                  className="border border-dashed border-slate-800 p-2 rounded-full text-slate-600 flex items-center justify-center w-8 h-8 group relative"
                  title="Extension inactive. Activez le tri IA pour ajouter l'icône à la barre."
                >
                  <Sparkles size={13} className="opacity-40" />
                  <span className="hidden group-hover:block absolute bottom-full mb-2 right-0 bg-slate-950 text-[10px] text-slate-400 p-2 rounded-lg border border-slate-800 whitespace-nowrap z-20">
                    Activez le tri IA pour ajouter l'extension
                  </span>
                </div>
              )}

              {/* Sky Blue Google Workspace Upgrade Button */}
              <button 
                onClick={() => setShowUpgradeModal(true)}
                className="hidden sm:inline-flex bg-sky-400 hover:bg-sky-300 text-sky-950 text-[10px] font-extrabold uppercase tracking-wide px-3 py-1.5 rounded-full transition-all cursor-pointer"
              >
                Upgrade
              </button>

              {/* 3x3 Apps Grid */}
              <button className="hidden sm:inline-flex text-slate-400 hover:text-slate-200 p-1.5 rounded-full hover:bg-slate-800/60 transition-colors" title="Google apps">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>

              {/* Profile Badge — shows the real connected account's actual
                  Google profile photo (falls back to an initial letter if
                  no picture came back or it fails to load), so it always
                  matches whichever inbox is actually loaded below. */}
              {googlePicture ? (
                <img
                  src={googlePicture}
                  alt={googleName || googleEmail || "Compte Google"}
                  title={googleEmail || "Compte Google"}
                  referrerPolicy="no-referrer"
                  onError={() => setGooglePicture(null)}
                  className="w-7 h-7 rounded-full border border-emerald-500/20 shadow-sm cursor-pointer hover:opacity-90 object-cover"
                />
              ) : (
                <div
                  className="w-7 h-7 rounded-full bg-[#005c53] border border-emerald-500/20 flex items-center justify-center text-white text-xs font-bold shadow-sm cursor-pointer hover:opacity-90"
                  title={googleEmail || "Compte Google"}
                >
                  {(googleName || googleEmail || "?").charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

            {/* Mobile Folder Navigation Pills (Visible only on mobile/tablet) */}
            <div className="lg:hidden shrink-0 flex items-center gap-2 px-4 py-3 bg-slate-950/40 border-b border-slate-800/60 overflow-x-auto w-full">
              <button
                onClick={() => { setActiveFolder("inbox"); setCurrentMail(null); }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 ${activeFolder === "inbox" ? "bg-slate-800 text-white border border-slate-700/60 shadow-md" : "text-slate-400 hover:text-slate-200"}`}
              >
                <Mail size={13} />
                <span>Boîte de réception</span>
                <span className="bg-slate-950/50 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold border border-slate-800/40 text-slate-300">
                  {emails.filter(e => notifiedEmailIds.includes(e.id)).length}
                </span>
              </button>
              <button
                onClick={() => { setActiveFolder("sent"); setCurrentMail(null); }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all shrink-0 ${activeFolder === "sent" ? "bg-slate-800 text-white border border-slate-700/60 shadow-md" : "text-slate-400 hover:text-slate-200"}`}
              >
                <SendHorizontal size={13} />
                <span>Messages envoyés</span>
                {sentEmails.length > 0 && (
                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold">
                    {sentEmails.length}
                  </span>
                )}
              </button>

              {isClassifying && (
                <div className="ml-auto flex items-center gap-1.5 text-[9.5px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 rounded-full shrink-0 animate-pulse">
                  <RefreshCw size={10} className="animate-spin" />
                  Tri IA...
                </div>
              )}
            </div>

            {/* Sidebar Folder Navigation (desktop only — mobile uses the pills above) */}
            <div className="hidden lg:flex w-56 bg-slate-950/20 p-4 border-r border-slate-800/40 flex-col gap-1.5 shrink-0">
              <button
                onClick={() => { setActiveFolder("inbox"); setCurrentMail(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeFolder === "inbox" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"}`}
              >
                <div className="flex items-center gap-2.5">
                  <Mail size={14} />
                  <span>Boîte de réception</span>
                </div>
                <span className="bg-slate-800 text-[10px] px-2 py-0.5 rounded-full font-semibold border border-slate-700/50">
                  {emails.filter(e => notifiedEmailIds.includes(e.id)).length}
                </span>
              </button>

              <button
                onClick={() => { setActiveFolder("sent"); setCurrentMail(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeFolder === "sent" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40"}`}
              >
                <SendHorizontal size={14} />
                <span>Messages envoyés</span>
                {sentEmails.length > 0 && (
                  <span className="ml-auto bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[9px] px-2 py-0.5 rounded-full">
                    {sentEmails.length}
                  </span>
                )}
              </button>

              <div className="mt-8 pt-4 border-t border-slate-800/80">
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 px-3 block mb-3">Triage MailCraft AI</span>
                
                <div className="px-3 py-2.5 bg-slate-950/40 rounded-xl border border-slate-800/60 flex flex-col gap-2">
                  <div className="text-[11px] text-slate-400 flex items-center justify-between font-medium">
                    <span>État :</span>
                    <span className={connected ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                      {connected ? (activated ? "Analyse en cours" : "Inactif") : "Non connecté"}
                    </span>
                  </div>
                  {isClassifying && (
                    <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 animate-pulse">
                      <RefreshCw size={11} className="animate-spin text-indigo-400" />
                      Triage des mails...
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Middle Pane: Mail Reader or List */}
            <div className="flex-1 flex flex-col bg-slate-900/40 overflow-y-auto">
              
              {currentMail ? (
                /* Detail email View */
                <div className="p-4 sm:p-6 flex flex-col h-full">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
                    <button
                      onClick={() => setCurrentMail(null)}
                      className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-all font-semibold cursor-pointer"
                    >
                      <ArrowLeft size={14} /> Retour à la liste
                    </button>
                    <div className="flex items-center gap-2">
                      {currentMail.urgency && (
                        <span className={`text-[10px] px-2.5 py-1 rounded-full text-slate-100 font-semibold uppercase tracking-wider ${
                          currentMail.urgency === "Important" ? "bg-rose-600/30 text-rose-300 border border-rose-500/30" :
                          currentMail.urgency === "Medium" ? "bg-amber-600/30 text-amber-300 border border-amber-500/30" :
                          "bg-slate-700/30 text-slate-300 border border-slate-600/30"
                        }`}>
                          {currentMail.urgency}
                        </span>
                      )}
                      {currentMail.tag && (
                        <span className="text-[10px] bg-slate-800 text-indigo-300 px-2.5 py-1 rounded-full border border-slate-700/50 font-semibold uppercase tracking-wider">
                          {currentMail.tag}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-slate-100 leading-snug">{currentMail.subject}</h2>
                        <p className="text-xs text-slate-400 mt-1">De : <span className="text-slate-300 font-medium">{currentMail.from}</span></p>
                      </div>
                      <span className="text-xs text-slate-500 shrink-0">{currentMail.date}</span>
                    </div>

                    {currentMail.summary && (
                      <div className={`mt-5 p-4 rounded-xl border ${
                        currentMail.summarySource === "fallback"
                          ? "bg-amber-950/20 border-amber-500/20"
                          : "bg-indigo-950/20 border-indigo-500/20"
                      }`}>
                        <div className={`flex items-center gap-1.5 text-xs font-semibold mb-1 ${
                          currentMail.summarySource === "fallback" ? "text-amber-400" : "text-indigo-400"
                        }`}>
                          <Sparkles size={13} />
                          <span>
                            {currentMail.summarySource === "fallback"
                              ? "Résumé indisponible"
                              : "Résumé automatique de l'IA MailCraft"}
                          </span>
                        </div>
                        <p className={`text-xs leading-relaxed italic ${
                          currentMail.summarySource === "fallback" ? "text-amber-200" : "text-indigo-200"
                        }`}>
                          {summaryLabel(currentMail, "")}
                        </p>
                      </div>
                    )}

                    <div className="mt-6 text-xs text-slate-300 leading-relaxed whitespace-pre-line bg-slate-950/30 p-5 rounded-2xl border border-slate-800/60">
                      {currentMail.body}
                    </div>
                  </div>
                </div>
              ) : activeFolder === "sent" ? (
                /* Sent mails list */
                <div className="flex flex-col h-full">
                  <div className="p-4 border-b border-slate-800/60 font-semibold text-xs text-slate-400 uppercase tracking-wider">
                    Messages envoyés via la validation MailCraft AI
                  </div>
                  {sentEmails.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                      <SendHorizontal size={36} className="text-slate-600 mb-2 stroke-[1.5]" />
                      <p className="text-xs font-semibold">Aucun mail envoyé pour le moment.</p>
                      <p className="text-[11px] text-slate-600 mt-1 max-w-xs">Validez les propositions de réponses rédigées par l'IA pour les envoyer.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/50">
                      {sentEmails.map((se) => (
                        <div key={se.id} className="p-5 hover:bg-slate-800/10 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-300">À : {se.to}</span>
                            <span className="text-[10px] text-slate-500">{se.date}</span>
                          </div>
                          <div className="text-xs font-semibold text-slate-200">{se.subject}</div>
                          <div className="text-[11px] text-slate-400 whitespace-pre-line bg-slate-950/20 p-3.5 rounded-xl border border-slate-800/40 mt-1">{se.body}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* General Inbox List */
                <div className="flex flex-col">

                  {/* Header title for Inbox list */}
                  <div className="px-5 pb-3 border-b border-slate-800/60 flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                    <span>
                      {activeFolder === "inbox" 
                        ? "🛡️ Boîte de réception MailCraft AI (Important + réponses auto)" 
                        : "Messages de la boîte"}
                    </span>
                    {activeFolder === "inbox" && (
                      <span className="text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-850">
                        {displayEmails.length} messages
                      </span>
                    )}
                  </div>

                  {displayEmails.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">
                      <Mail size={32} className="mx-auto text-slate-600 mb-2 stroke-[1.5]" />
                      <p className="text-xs">
                        {searchQuery.trim() !== ""
                          ? "Aucun email trouvé correspondant à votre recherche."
                          : activeFolder === "inbox"
                          ? "Aucun email important pour l'instant. Les emails classés Important et les réponses automatiques apparaîtront ici."
                          : "Aucun message."}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-800/60">
                      {displayEmails.map((mail) => (
                        <div
                          key={mail.id}
                          onClick={() => !mail.isAutoReply && handleSelectMail(mail)}
                          className={`p-4.5 transition-all flex flex-col gap-2 ${
                            mail.isAutoReply
                              ? "bg-emerald-950/10 border-l-2 border-emerald-600/50 cursor-default"
                              : `hover:bg-slate-800/30 cursor-pointer ${!mail.read ? "bg-slate-800/10 border-l-2 border-indigo-500" : ""}`
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`text-xs flex items-center gap-1.5 ${!mail.read ? "font-bold text-slate-100" : "text-slate-300"}`}>
                              {mail.isAutoReply && <SendHorizontal size={11} className="text-emerald-400 shrink-0" />}
                              {mail.from}
                            </span>
                            <span className="text-[10px] text-slate-500">{mail.date}</span>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3">
                            <h3 className={`text-xs truncate ${!mail.read ? "font-bold text-white" : "text-slate-300"}`}>
                              {mail.subject}
                            </h3>

                            {/* Live classified tags inside the Gmail interface */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              {mail.isAutoReply ? (
                                <span className="text-[9px] px-2 py-0.5 rounded-full text-emerald-300 font-bold uppercase tracking-wider bg-emerald-500/15 border border-emerald-500/30">
                                  Réponse auto envoyée
                                </span>
                              ) : mail.urgency ? (
                                <>
                                  <span className={`text-[9px] px-2 py-0.5 rounded-full text-slate-100 font-bold uppercase tracking-wider ${
                                    mail.urgency === "Important" ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" :
                                    mail.urgency === "Medium" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                                    "bg-slate-700/20 text-slate-400 border border-slate-600/30"
                                  }`}>
                                    {mail.urgency}
                                  </span>
                                  <span className="text-[9px] bg-slate-800/80 text-indigo-300 px-2 py-0.5 rounded-full border border-slate-700 font-semibold uppercase">
                                    {mail.tag}
                                  </span>
                                </>
                              ) : (
                                connected && activated && (
                                  <span className="text-[9px] text-slate-500 italic animate-pulse">Classification...</span>
                                )
                              )}
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-400 line-clamp-1 italic">
                            {mail.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>

          </div>

        </div>

        {/* Backdrop for responsive right AI toolbar on mobile/tablet */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        {/* RIGHT: MailCraft AI Toolbar Extension Side Panel */}
        <aside
          className={`bg-slate-950 border-l border-slate-800 flex flex-col transition-all duration-300 z-40 ${
            sidebarOpen
              ? "fixed right-0 top-0 bottom-0 w-full sm:max-w-[450px] lg:relative lg:w-[500px] h-full shadow-2xl lg:shadow-none"
              : "hidden lg:flex lg:w-12 lg:relative"
          }`}
        >
          {/* Collapsed side ribbon showing shortcut icon */}
          {!sidebarOpen ? (
            <div className="flex-1 flex flex-col items-center pt-6 gap-5 bg-slate-950">
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg cursor-pointer"
                title="Ouvrir le panneau MailCraft AI"
              >
                <Sparkles size={14} className="text-white" />
              </button>

              <div className="h-[1px] w-6 bg-slate-800 my-1" />

              {/* Activer le tri IA button in the collapsed bar */}
              {!activated ? (
                <button
                  onClick={() => {
                    setActivated(true);
                    showToast("MailCraft AI activé ! Début du triage automatique en arrière-plan.");
                  }}
                  className="w-8 h-8 rounded-xl bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 border border-purple-500/30 flex items-center justify-center cursor-pointer transition-all animate-pulse"
                  title="Activer le tri IA"
                >
                  <Sparkles size={13} />
                </button>
              ) : (
                <div 
                  className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center"
                  title="Tri IA Actif"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                </div>
              )}
            </div>
          ) : (
            /* Fully Expanded Controls Panel */
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Header with side panel controls */}
              <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/60 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-indigo-400 animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-200">Extension MailCraft AI</span>
                </div>
                
                <div className="flex items-center gap-3">
                  {!activated ? (
                    <button
                      onClick={() => {
                        setActivated(true);
                        showToast("MailCraft AI activé ! Début du triage automatique en arrière-plan.");
                      }}
                      className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-md flex items-center gap-1.5 cursor-pointer animate-pulse"
                    >
                      <Sparkles size={11} /> Activer le tri IA
                    </button>
                  ) : (
                    <div className="bg-purple-500/10 text-purple-400 border border-purple-500/20 px-2.5 py-1 rounded-lg text-[10px] font-semibold flex items-center gap-1">
                      <Sparkles size={11} className="text-purple-300 animate-spin" />
                      Tri IA Actif
                    </div>
                  )}

                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="text-slate-400 hover:text-white transition-colors cursor-pointer p-1 rounded hover:bg-slate-800/40"
                    title="Masquer le panneau"
                  >
                    <Minimize2 size={15} />
                  </button>
                </div>
              </div>

              {/* Sub-Tabs selection inside the control panel */}
              <div className="flex border-b border-slate-800 bg-slate-900/30 text-[11px] shrink-0 font-medium">
                <button
                  onClick={() => setActiveSubTab("mailcraft_inbox")}
                  className={`flex-1 py-3 border-b-2 text-center transition-all ${activeSubTab === "mailcraft_inbox" ? "border-indigo-500 text-white bg-slate-800/10 font-bold" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                >
                  📬 Boîte MailCraft
                </button>
                <button
                  onClick={() => setActiveSubTab("matching")}
                  className={`flex-1 py-3 border-b-2 text-center transition-all ${activeSubTab === "matching" ? "border-indigo-500 text-white bg-slate-800/10 font-bold" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                >
                  🎯 Mail matching
                </button>
                <button
                  onClick={() => setActiveSubTab("assistant")}
                  className={`flex-1 py-3 border-b-2 text-center transition-all ${activeSubTab === "assistant" ? "border-indigo-500 text-white bg-slate-800/10 font-bold" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                >
                  💬 Assistant
                </button>
                <button
                  onClick={() => setActiveSubTab("triage")}
                  className={`flex-1 py-3 border-b-2 text-center transition-all ${activeSubTab === "triage" ? "border-indigo-500 text-white bg-slate-800/10 font-bold" : "border-transparent text-slate-400 hover:text-slate-200"}`}
                >
                  ⚙️ Triage
                </button>
              </div>

              {/* Control Panel Tab Content Container */}
              <div className="flex-1 p-5 overflow-y-auto">
                {/* 0. BOÎTE MAILCRAFT AI */}
                {activeSubTab === "mailcraft_inbox" && (
                  !activated ? (
                    <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-950/60 rounded-2xl border border-slate-800/80 my-4 shadow-xl">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-4">
                        <Lock size={24} className="text-indigo-400" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2">Option inactive</h4>
                      <p className="text-[11px] text-slate-400 max-w-sm leading-relaxed mb-6">
                        La Boîte MailCraft, le triage par importance, les notifications persistantes et le pilote automatique requièrent l'activation de l'extension MailCraft AI dans votre messagerie.
                      </p>
                      <button
                        onClick={() => {
                          setActivated(true);
                          showToast("MailCraft AI activé ! Début du triage automatique en arrière-plan.");
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer animate-pulse"
                      >
                        <Sparkles size={14} /> Activer le tri IA
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                      <div>
                        <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Boîte de Réception MailCraft AI</h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          Cette boîte contient exclusivement les emails d'importance notifiés par l'IA et les réponses automatiques gérées par le pilote automatique.
                        </p>
                      </div>

                      {/* Alertes d'importance / Solid notifications list */}
                      <div className="flex flex-col gap-3">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Bell size={12} className="text-rose-400" /> Alertes d'importance solides ({notifications.length})
                        </h4>
                        {notifications.length === 0 ? (
                          <div className="bg-slate-950 p-4.5 rounded-xl text-center border border-slate-800/60 text-slate-500 text-xs">
                            Aucune alerte en attente de lecture.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            {notifications.map((notif) => (
                              <div 
                                key={notif.id}
                                className="bg-slate-950 border border-rose-500/50 p-3.5 rounded-xl flex flex-col gap-2 relative shadow-lg shadow-rose-950/10"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-rose-400 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" /> ALERTE CRITIQUE
                                  </span>
                                  <span className="text-[9px] text-slate-500">{notif.date}</span>
                                </div>
                                <div>
                                  <h5 className="text-xs font-bold text-slate-200">{notif.subject}</h5>
                                  <span className="text-[10px] text-indigo-300">De : {notif.from}</span>
                                </div>
                                <p className="text-[11px] text-slate-300 bg-rose-950/25 border border-rose-500/10 p-2.5 rounded-lg leading-relaxed mt-1">
                                  <strong className="text-rose-300">Résumé IA :</strong> {summaryLabel(notif, "Calcul du résumé...")}
                                </p>
                                <div className="flex justify-end mt-1">
                                  <button
                                    onClick={() => handleOpenNotification(notif)}
                                    className="bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[10px] px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                                  >
                                    Ouvrir et marquer comme lu <ChevronRight size={11} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Réponses automatiques envoyées par l'IA */}
                      <div className="flex flex-col gap-3 mt-2">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <CheckCircle2 size={12} className="text-emerald-400" /> Réponses automatiques envoyées par l'IA ({sentEmails.length})
                        </h4>
                        {sentEmails.length === 0 ? (
                          <div className="bg-slate-950 p-4.5 rounded-xl text-center border border-slate-800/60 text-slate-500 text-xs">
                            Aucun email traité automatiquement pour le moment.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-3">
                            {sentEmails.map((se) => (
                              <div 
                                key={se.id}
                                className="bg-slate-950 border border-emerald-500/30 p-3.5 rounded-xl flex flex-col gap-2 shadow-lg shadow-emerald-950/10"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                                    ✓ ENVOI AUTOMATIQUE
                                  </span>
                                  <span className="text-[9px] text-slate-500">{se.date}</span>
                                </div>
                                <div>
                                  <h5 className="text-xs font-bold text-slate-200">{se.subject}</h5>
                                  <span className="text-[10px] text-slate-400">À : {se.to}</span>
                                </div>
                                <div className="text-[11px] text-emerald-300/90 font-mono bg-emerald-950/20 border border-emerald-500/10 p-2.5 rounded-lg whitespace-pre-wrap leading-relaxed mt-1">
                                  {se.body}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )}

                {/* 1. MAIL MATCHING (La fonctionnalité phare) */}
                {activeSubTab === "matching" && (
                  !activated ? (
                    <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-950/60 rounded-2xl border border-slate-800/80 my-4 shadow-xl">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-4">
                        <Lock size={24} className="text-indigo-400" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2">Option inactive</h4>
                      <p className="text-[11px] text-slate-400 max-w-sm leading-relaxed mb-6">
                        Le Mail Matching et le scan automatique de votre messagerie requièrent l'activation de l'extension MailCraft AI dans votre messagerie.
                      </p>
                      <button
                        onClick={() => {
                          setActivated(true);
                          showToast("MailCraft AI activé ! Début du triage automatique en arrière-plan.");
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer animate-pulse"
                      >
                        <Sparkles size={14} /> Activer le tri IA
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5">
                    <div>
                      <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Configurez vos Baselines</h3>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Spécifiez un sujet d'email à surveiller et un critère de vérification (rédigé manuellement ou extrait d'un CV/document). MailCraft AI scanne la boîte de réception de manière autonome pour identifier les correspondances et rédiger les réponses appropriées.
                      </p>
                    </div>

                    {/* Autopilot Mode Switcher (User preference) */}
                    <div className="bg-gradient-to-r from-emerald-950/30 to-slate-900 border border-emerald-500/20 p-4 rounded-xl flex items-center justify-between shadow-lg shadow-emerald-950/10">
                      <div className="flex items-start gap-3">
                        <div className="relative mt-0.5">
                          <div className="absolute -inset-1 rounded-full bg-emerald-500/20 animate-ping opacity-75"></div>
                          <CheckCircle2 size={16} className="text-emerald-400 relative" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                            Pilote automatique activé
                            <span className="bg-emerald-500/20 text-emerald-300 text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded tracking-wider">Live</span>
                          </h4>
                          <p className="text-[10px] text-slate-400 leading-relaxed mt-0.5">
                            Les réponses correspondantes sont envoyées instantanément et automatiquement à vos contacts sans nécessiter de validation manuelle.
                          </p>
                        </div>
                      </div>
                      <div className="ml-3 shrink-0">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={autoSend} 
                            onChange={(e) => setAutoSend(e.target.checked)}
                            className="sr-only peer" 
                          />
                          <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white peer-checked:after:border-emerald-500"></div>
                        </label>
                      </div>
                    </div>

                    {/* Baselines Manager */}
                    <div className="flex flex-col gap-4">
                      {baselines.map((baseline, bIndex) => (
                        <div 
                          key={baseline.id} 
                          className={`p-4 rounded-xl border transition-all ${activeBaselineId === baseline.id ? "bg-slate-900/80 border-indigo-500/50" : "bg-slate-950 border-slate-800/80"}`}
                        >
                          <div className="flex items-center justify-between mb-3.5">
                            <input
                              type="text"
                              value={baseline.title}
                              onChange={(e) => {
                                const newTitle = e.target.value;
                                setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, title: newTitle } : b));
                              }}
                              className="bg-transparent border-b border-transparent hover:border-slate-700 focus:border-indigo-500 focus:outline-none text-xs font-bold text-slate-200"
                            />
                            {baselines.length > 1 && (
                              <button
                                onClick={() => {
                                  setBaselines(prev => prev.filter(b => b.id !== baseline.id));
                                  if (activeBaselineId === baseline.id) {
                                    setActiveBaselineId(baselines[0].id);
                                  }
                                }}
                                className="text-rose-400 hover:text-rose-300 text-[10px] cursor-pointer"
                              >
                                Supprimer
                              </button>
                            )}
                          </div>

                          {/* File Attachment & AI Extraction Section */}
                          <div className="mb-3.5">
                            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1.5">Document de référence (Optionnel)</span>
                            
                            <div className="flex items-center gap-2">
                              <label className="flex-1 flex items-center justify-center gap-2 bg-slate-900 border border-dashed border-slate-700/80 hover:border-indigo-500/50 rounded-xl py-2 px-3 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer transition-all">
                                <Upload size={13} className="text-indigo-400" />
                                <span className="truncate">{baseline.fileName || "Joindre un document (CV, offre...)"}</span>
                                <input
                                  type="file"
                                  accept=".txt,.md,.json,.pdf,.docx"
                                  onChange={(e) => handleFileUpload(baseline.id, e)}
                                  className="hidden"
                                />
                              </label>

                              {baseline.fileName && (
                                <button
                                  onClick={() => {
                                    setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, fileName: "", fileText: "" } : b));
                                  }}
                                  className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-rose-400 hover:text-rose-300 cursor-pointer"
                                  title="Retirer le fichier"
                                >
                                  <X size={13} />
                                </button>
                              )}
                            </div>

                            {baseline.fileText && (
                              <div className="mt-2.5 bg-slate-950 p-2.5 rounded-lg border border-slate-800/60 max-h-24 overflow-y-auto">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-[9px] font-bold text-indigo-400 uppercase">Contenu texte détecté :</span>
                                  <button
                                    onClick={() => handleExtractCriteria(baseline.id, baseline.fileText)}
                                    disabled={extractingId === baseline.id}
                                    className="text-[9px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded font-semibold disabled:opacity-50 cursor-pointer"
                                  >
                                    {extractingId === baseline.id ? "Extraction..." : "Ré-extraire par l'IA"}
                                  </button>
                                </div>
                                <p className="text-[10px] text-slate-400 whitespace-pre-wrap">{baseline.fileText}</p>
                              </div>
                            )}
                          </div>

                          {/* Baseline Criteria Description */}
                          <div className="mb-3.5">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] uppercase font-bold text-slate-500">Critères d'évaluation</span>
                              {extractingId === baseline.id && (
                                <span className="text-[9px] text-indigo-400 animate-pulse font-medium">IA en cours d'analyse...</span>
                              )}
                            </div>
                            <textarea
                              rows={3}
                              value={baseline.description}
                              onChange={(e) => {
                                const desc = e.target.value;
                                setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, description: desc } : b));
                              }}
                              placeholder="Décrivez les critères précis requis (ex: compétences techniques, durée du stage minimum, disponibilité...)"
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 resize-none transition-all"
                            />
                          </div>

                          {/* Trigger Topic Query */}
                          <div className="mb-1">
                            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1.5">Type d'email à surveiller (Sujet/Objet)</span>
                            <input
                              type="text"
                              value={baseline.topicQuery}
                              onChange={(e) => {
                                const query = e.target.value;
                                setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, topicQuery: query } : b));
                              }}
                              placeholder='ex: "Candidature Stage" ou "job request"'
                              className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 transition-all"
                            />
                          </div>

                          {/* Actions relative to this baseline */}
                          <div className="mt-4 flex items-center justify-between gap-3">
                            <button
                              onClick={() => {
                                setActiveBaselineId(baseline.id);
                                handleScanInbox(baseline);
                              }}
                              disabled={isScanning || !baseline.topicQuery.trim() || !baseline.description.trim() || !connected}
                              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-indigo-600/10"
                            >
                              {isScanning && activeBaselineId === baseline.id ? (
                                <>
                                  <RefreshCw size={13} className="animate-spin" />
                                  Scan de la boîte...
                                </>
                              ) : (
                                <>
                                  <Sparkles size={13} />
                                  Lancer le scan intelligent IA
                                </>
                              )}
                            </button>
                          </div>

                        </div>
                      ))}

                      {/* Add new baseline button */}
                      <button
                        onClick={() => {
                          const id = `bl-${Date.now()}`;
                          setBaselines(prev => [
                            ...prev,
                            {
                              id,
                              title: `Critères Baseline ${prev.length + 1}`,
                              description: "",
                              fileName: "",
                              fileText: "",
                              topicQuery: ""
                            }
                          ]);
                          setActiveBaselineId(id);
                        }}
                        className="border border-dashed border-slate-800 hover:border-slate-700 rounded-xl p-3.5 flex items-center justify-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
                      >
                        <Plus size={14} /> Ajouter une nouvelle Baseline
                      </button>
                    </div>

                    {/* Scan Match Results Display */}
                    {activeBaselineId && (
                      <div className="mt-2 pt-4 border-t border-slate-800">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Résultats pour : {baselines.find(b => b.id === activeBaselineId)?.title}</h4>
                        
                        {!matchResults[activeBaselineId] ? (
                          <div className="bg-slate-950 p-6 rounded-2xl text-center border border-slate-800/60 text-slate-500 text-xs">
                            <p>Aucun scan lancé sur cette baseline.</p>
                            <p className="text-[11px] mt-1 text-slate-600">Remplissez les critères et cliquez sur le bouton pour scanner votre boîte Gmail.</p>
                          </div>
                        ) : matchResults[activeBaselineId].filter(r => r.matchedTopic).length === 0 ? (
                          <div className="bg-slate-950 p-6 rounded-2xl text-center border border-slate-800/60 text-slate-500 text-xs">
                            Aucun email correspondant au type de sujet "{baselines.find(b => b.id === activeBaselineId)?.topicQuery}" n'a été trouvé dans l'inbox.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-4">
                            {matchResults[activeBaselineId]
                              .filter(result => result.matchedTopic)
                              .map((result) => {
                                const email = emails.find(e => e.id === result.emailId);
                                if (!email) return null;
                                return (
                                  <div key={result.emailId} className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col gap-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-indigo-300 truncate max-w-[220px]">{email.subject}</span>
                                      <span className={`text-[9px] px-2.5 py-0.5 rounded-full font-bold uppercase ${
                                        result.match === "perfect" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                                        result.match === "partial" ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" :
                                        "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                      }`}>
                                        Match : {result.match === "perfect" ? "Parfait" : result.match === "partial" ? "Partiel" : "Invalide"}
                                      </span>
                                    </div>

                                    <p className="text-[11px] text-slate-400 leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60">
                                      <strong className="text-slate-300">Justification :</strong> {result.reasoning}
                                    </p>

                                    {/* Action Drafted Reply */}
                                    <div className="mt-1 pt-1 border-t border-slate-900">
                                      {sentEmailIds.includes(result.emailId) ? (
                                        <div className="flex flex-col gap-2.5">
                                          <div className="flex items-center justify-between">
                                            <span className="text-[10px] uppercase font-bold text-indigo-400">Message envoyé à l'expéditeur</span>
                                            <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-500/10">
                                              <CheckCircle2 size={11} className="text-emerald-400" /> Envoyé automatiquement
                                            </span>
                                          </div>
                                          
                                          <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 leading-relaxed font-mono whitespace-pre-wrap">
                                            {result.draft}
                                          </div>
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex items-center justify-between mb-2">
                                            <span className="text-[10px] uppercase font-bold text-indigo-400">Proposition de réponse IA</span>
                                            <span className="text-[9px] text-slate-500 italic">Modification autorisée</span>
                                          </div>
                                          
                                          <textarea
                                            rows={6}
                                            value={result.draft}
                                            onChange={(e) => {
                                              const newDraft = e.target.value;
                                              setMatchResults(prev => ({
                                                ...prev,
                                                [activeBaselineId]: prev[activeBaselineId].map(r => r.emailId === result.emailId ? { ...r, draft: newDraft } : r)
                                              }));
                                            }}
                                            className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-[11px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 resize-y leading-relaxed font-mono"
                                          />

                                          <div className="mt-3 flex items-center justify-end gap-3">
                                            <button
                                              onClick={() => handleValidateDraft(result.emailId, result.draft)}
                                              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-emerald-600/10"
                                            >
                                              <Check size={13} /> Valider le brouillon
                                            </button>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}

                    </div>
                  )
                )}

                {/* 2. CHAT WITH IA ASSISTANT */}
                {activeSubTab === "assistant" && (
                  <div className="flex flex-col h-full gap-4">
                    <div className="shrink-0">
                      <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Assistant de Correspondance IA</h3>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Demandez-lui de l'aide pour rédiger de toutes pièces, corriger ou perfectionner le ton d'un email. S'adapte au contexte professionnel.
                      </p>
                    </div>

                    {/* Messages List Area */}
                    <div className="flex-1 min-h-[250px] max-h-[380px] bg-slate-950 rounded-2xl border border-slate-800/80 p-4 overflow-y-auto flex flex-col gap-3.5">
                      {chatMessages.map((msg, index) => (
                        <div 
                          key={index}
                          className={`flex flex-col max-w-[85%] text-xs leading-relaxed ${msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
                        >
                          <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                            {msg.role === "user" ? "Vous" : "MailCraft AI"}
                          </span>
                          <div className={`p-3 rounded-2xl whitespace-pre-wrap ${msg.role === "user" ? "bg-indigo-600 text-white rounded-tr-none" : "bg-slate-900 text-slate-200 border border-slate-800 rounded-tl-none"}`}>
                            {msg.content}
                          </div>
                        </div>
                      ))}
                      {chatLoading && (
                        <div className="flex items-center gap-2 text-slate-500 text-[11px] italic">
                          <RefreshCw size={11} className="animate-spin text-indigo-400" />
                          MailCraft AI est en train d'écrire...
                        </div>
                      )}
                    </div>

                    {/* Chat input controls */}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSendChatMessage();
                        }}
                        placeholder="Ex: Aide-moi à rédiger une réponse positive..."
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl py-2.5 px-3 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40"
                      />
                      <button
                        onClick={handleSendChatMessage}
                        disabled={chatLoading || !chatInput.trim()}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2.5 px-3.5 rounded-xl transition-all flex items-center justify-center cursor-pointer"
                        title="Envoyer"
                      >
                        <SendHorizontal size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {/* 3. TRIAGE & STATUSES CONFIG */}
                {activeSubTab === "triage" && (
                  !activated ? (
                    <div className="flex flex-col items-center justify-center text-center p-8 bg-slate-950/60 rounded-2xl border border-slate-800/80 my-4 shadow-xl">
                      <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-4">
                        <Lock size={24} className="text-indigo-400" />
                      </div>
                      <h4 className="text-xs font-bold text-slate-100 uppercase tracking-wider mb-2">Option inactive</h4>
                      <p className="text-[11px] text-slate-400 max-w-sm leading-relaxed mb-6">
                        Les statistiques de triage et les configurations avancées requièrent l'activation de l'extension MailCraft AI dans votre messagerie.
                      </p>
                      <button
                        onClick={() => {
                          setActivated(true);
                          showToast("MailCraft AI activé ! Début du triage automatique en arrière-plan.");
                        }}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-3 rounded-xl transition-all shadow-lg flex items-center gap-2 cursor-pointer animate-pulse"
                      >
                        <Sparkles size={14} /> Activer le tri IA
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-5 text-xs">
                    <div>
                      <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider mb-1.5">Statistiques & Préférences de triage</h3>
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Consultez la répartition de vos emails par niveau d'urgence et configurez les mots-clés ou règles de triage automatiques.
                      </p>
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                        <span className="text-[10px] uppercase font-bold text-slate-500">Important</span>
                        <div className="text-lg font-bold text-rose-400 mt-1">
                          {emails.filter(e => e.urgency === "Important").length}
                        </div>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                        <span className="text-[10px] uppercase font-bold text-slate-500">Moyen</span>
                        <div className="text-lg font-bold text-amber-400 mt-1">
                          {emails.filter(e => e.urgency === "Medium").length}
                        </div>
                      </div>
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-center">
                        <span className="text-[10px] uppercase font-bold text-slate-500">Faible</span>
                        <div className="text-lg font-bold text-slate-400 mt-1">
                          {emails.filter(e => e.urgency === "Faible").length}
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                      <span className="text-[10px] uppercase font-extrabold text-indigo-400 tracking-wider">Fonctionnement du tri IA</span>
                      
                      <div className="flex flex-col gap-2.5 text-[11px] text-slate-300 leading-relaxed">
                        <div className="flex gap-2 items-start">
                          <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                          <p>
                            <strong className="text-white">Classification multiaxes :</strong> Les emails entrants sont immédiatement analysés par Gemini pour qualifier leur urgence et leur thématique principale (Job, Study, Meeting, Stage).
                          </p>
                        </div>
                        <div className="flex gap-2 items-start">
                          <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                          <p>
                            <strong className="text-white">Persistance critique :</strong> Un mail hautement prioritaire ou contenant une échéance importante déclenchera une alerte incontournable sur votre écran.
                          </p>
                        </div>
                        <div className="flex gap-2 items-start">
                          <Check size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                          <p>
                            <strong className="text-white">Génération automatique de résumé :</strong> Inutile de lire l'intégralité du mail pour comprendre l'action attendue. L'IA génère un condensé de moins de 20 mots.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Simulation Triggers */}
                    <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl flex flex-col gap-3">
                      <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">Simuler de nouveaux e-mails</span>
                      <p className="text-[11px] text-slate-400">Pour tester le triage IA instantané, vous pouvez injecter un nouvel e-mail dans la boîte de réception simulée :</p>
                      
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => {
                            const newMail: Email = {
                              id: Date.now(),
                              from: "alicia.v@etudes-universite.ca",
                              subject: "Candidature Admission Doctorat Informatique",
                              body: `Bonjour,
Je vous adresse mon dossier complet de candidature pour le Doctorat en Informatique à la session d'automne. 
Mon sujet porte sur le deep learning appliqué aux séries temporelles. J'ai inclus mes notes de Master et 3 lettres de recommandation.
Je sollicite également une bourse d'études pour financer mes recherches.
Cordialement,
Alicia Verner`,
                              date: "À l'instant",
                              read: false
                            };
                            setEmails(prev => [newMail, ...prev]);
                            showToast("Nouvel e-mail inséré ! Il sera trié automatiquement si l'IA est active.");
                          }}
                          className="bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 py-2 px-3 rounded-lg text-xs font-semibold text-left transition-all cursor-pointer flex items-center justify-between"
                        >
                          <span>Candidature Doctorat (Study)</span>
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">Injecter</span>
                        </button>

                        <button
                          onClick={() => {
                            const newMail: Email = {
                              id: Date.now(),
                              from: "direction-generale@corp-solutions.com",
                              subject: "Rappel : Signature de la charte de sécurité avant ce soir",
                              body: `Bonjour à tous,
Ceci est un rappel de haute importance. La nouvelle charte de sécurité informatique de l'entreprise doit impérativement être signée avant ce soir 18h00 par l'ensemble des collaborateurs.
Toute absence de signature entraînera la suspension temporaire de vos accès réseau dès demain matin.
Merci de faire le nécessaire d'urgence.
La Direction`,
                              date: "À l'instant",
                              read: false
                            };
                            setEmails(prev => [newMail, ...prev]);
                            showToast("Nouvel e-mail urgent inséré ! Il déclenchera une notification persistante.");
                          }}
                          className="bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 py-2 px-3 rounded-lg text-xs font-semibold text-left transition-all cursor-pointer flex items-center justify-between"
                        >
                          <span>Rappel urgent charte (Important)</span>
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">Injecter</span>
                        </button>
                      </div>
                    </div>
                    </div>
                  )
                )}

              </div>

            </div>
          )}
        </aside>

              </>
            )
          )}
        </div>
      </div>

      {/* 6. MAIL MATCHING OVERLAY WINDOW (HUB) */}
      {showMatchingOverlay && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-6 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-5xl shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-300">
            {/* Header */}
            <div className="px-6 py-4.5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/80">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <Sparkles size={20} className="animate-pulse" />
                </div>
                <div>
                  <h3 className="text-xs font-extrabold text-slate-100 uppercase tracking-wider flex items-center gap-2 flex-wrap">
                    MailCraft AI — Hub de Mail Matching
                    <span className="bg-emerald-500/20 text-emerald-400 text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full tracking-wider border border-emerald-500/30">
                      Pilote Automatique {autoSend ? "Actif" : "Inactif"}
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Configurez vos critères, scannez vos emails simulés et gérez les réponses rédigées par l'IA.</p>
                </div>
              </div>
              
              <button 
                onClick={() => setShowMatchingOverlay(false)}
                className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer text-xs p-1.5 hover:bg-slate-850 rounded-full border border-slate-800"
                title="Fermer le Hub"
              >
                ✕
              </button>
            </div>

            {/* Modal Body Content */}
            <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
              {/* Left Side: Configuration Panel */}
              <div className="w-full md:w-[380px] p-5 border-r border-slate-800 overflow-y-auto bg-slate-950/30 flex flex-col gap-4">
                <div>
                  <h4 className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Configuration de Tri</h4>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Spécifiez les conditions de filtrage et l'IA scannera votre messagerie pour repérer les e-mails pertinents.
                  </p>
                </div>

                {/* Baselines dropdown selector inside modal */}
                <div className="bg-slate-900/60 p-3.5 rounded-2xl border border-slate-800/80 flex flex-col gap-2">
                  <span className="text-[9px] uppercase font-bold text-slate-500">Baseline Active</span>
                  <div className="flex gap-2">
                    <select
                      value={activeBaselineId || ""}
                      onChange={(e) => setActiveBaselineId(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/40"
                    >
                      {baselines.map((bl) => (
                        <option key={bl.id} value={bl.id}>
                          {bl.title || "Baseline sans titre"}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => {
                        const id = `bl-${Date.now()}`;
                        setBaselines(prev => [
                          ...prev,
                          {
                            id,
                            title: `Critères Baseline ${prev.length + 1}`,
                            description: "",
                            fileName: "",
                            fileText: "",
                            topicQuery: ""
                          }
                        ]);
                        setActiveBaselineId(id);
                        showToast("Nouvelle baseline créée !");
                      }}
                      className="bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-600/40 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer"
                      title="Créer une nouvelle baseline"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Autopilot toggle */}
                <div className="bg-gradient-to-r from-emerald-950/15 to-slate-950/40 border border-emerald-500/20 p-3 rounded-2xl flex items-center justify-between">
                  <div>
                    <h5 className="text-[11px] font-bold text-slate-200">Pilote Automatique</h5>
                    <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">Répondre automatiquement aux profils parfaits.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={autoSend} 
                      onChange={(e) => setAutoSend(e.target.checked)}
                      className="sr-only peer" 
                    />
                    <div className="w-8 h-4 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white"></div>
                  </label>
                </div>

                {/* Edit active baseline form fields */}
                {activeBaselineId && (() => {
                  const baseline = baselines.find(b => b.id === activeBaselineId);
                  if (!baseline) return null;
                  return (
                    <div className="flex flex-col gap-3.5">
                      {/* Title */}
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Nom de la baseline</span>
                        <input
                          type="text"
                          value={baseline.title}
                          onChange={(e) => {
                            const newTitle = e.target.value;
                            setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, title: newTitle } : b));
                          }}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl py-1.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/40"
                        />
                      </div>

                      {/* Reference document file upload inside modal */}
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Fiche descriptive ou CV de référence</span>
                        <div className="flex items-center gap-2">
                          <label className="flex-1 flex items-center justify-center gap-1.5 bg-slate-900 border border-dashed border-slate-700 hover:border-indigo-500/50 rounded-xl py-1.5 px-2.5 text-[10px] text-slate-400 hover:text-slate-200 cursor-pointer transition-all">
                            <Upload size={12} className="text-indigo-400" />
                            <span className="truncate max-w-[180px]">{baseline.fileName || "Joindre un document (.txt, .pdf...)"}</span>
                            <input
                              type="file"
                              accept=".txt,.md,.json,.pdf,.docx"
                              onChange={(e) => handleFileUpload(baseline.id, e)}
                              className="hidden"
                            />
                          </label>

                          {baseline.fileName && (
                            <button
                              onClick={() => {
                                setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, fileName: "", fileText: "" } : b));
                              }}
                              className="p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-rose-400 hover:text-rose-300"
                              title="Retirer le fichier"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>

                        {baseline.fileText && (
                          <div className="mt-2 bg-slate-950 p-2 rounded-xl border border-slate-800/60 max-h-20 overflow-y-auto">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[8px] font-bold text-indigo-400 uppercase">Données extraites :</span>
                              <button
                                onClick={() => handleExtractCriteria(baseline.id, baseline.fileText)}
                                disabled={extractingId === baseline.id}
                                className="text-[8px] bg-indigo-600 text-white px-1.5 py-0.5 rounded font-semibold disabled:opacity-50"
                              >
                                {extractingId === baseline.id ? "Analyse..." : "Extraire par l'IA"}
                              </button>
                            </div>
                            <p className="text-[9px] text-slate-400 whitespace-pre-wrap">{baseline.fileText}</p>
                          </div>
                        )}
                      </div>

                      {/* Criteria */}
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Critères d'évaluation exigés</span>
                        <textarea
                          rows={3}
                          value={baseline.description}
                          onChange={(e) => {
                            const desc = e.target.value;
                            setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, description: desc } : b));
                          }}
                          placeholder="Ex: Compétences informatiques, expérience en support, stage de fin d'études, etc."
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 resize-none"
                        />
                      </div>

                      {/* Subject Filter */}
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-500 block mb-1">Objet de l'email à surveiller</span>
                        <input
                          type="text"
                          value={baseline.topicQuery}
                          onChange={(e) => {
                            const query = e.target.value;
                            setBaselines(prev => prev.map(b => b.id === baseline.id ? { ...b, topicQuery: query } : b));
                          }}
                          placeholder="Ex: Candidature Stage ou Recrutement"
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl py-1.5 px-3 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/40"
                        />
                      </div>

                      {/* Run Scan Button */}
                      <button
                        onClick={() => handleScanInbox(baseline)}
                        disabled={isScanning || !baseline.topicQuery.trim() || !baseline.description.trim() || !connected}
                        className="w-full mt-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-lg shadow-indigo-600/15"
                      >
                        {isScanning ? (
                          <>
                            <RefreshCw size={11} className="animate-spin" />
                            Scan IA en cours...
                          </>
                        ) : (
                          <>
                            <Sparkles size={11} />
                            Lancer le scan intelligent IA
                          </>
                        )}
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Right Side: Scan Results Workspace */}
              <div className="flex-1 p-5 overflow-y-visible md:overflow-y-auto flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    🎯 Résultats d'évaluation et de Triage
                  </h4>
                  <span className="text-[9px] text-slate-500">Mise à jour en temps réel</span>
                </div>

                {activeBaselineId && (() => {
                  const baseline = baselines.find(b => b.id === activeBaselineId);
                  const results = matchResults[activeBaselineId] || [];
                  const matchedResults = results.filter(r => r.matchedTopic);

                  if (!baseline) return null;

                  if (isScanning) {
                    return (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950/20 border border-slate-850 rounded-2xl">
                        <RefreshCw size={28} className="text-indigo-400 animate-spin mb-3" />
                        <h5 className="text-xs font-bold text-slate-200">Analyse de l'inbox...</h5>
                        <p className="text-[10px] text-slate-500 mt-1 max-w-xs">L'IA de MailCraft parcourt vos emails simulés pour filtrer selon vos critères de matching.</p>
                      </div>
                    );
                  }

                  if (!matchResults[activeBaselineId]) {
                    return (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950/20 border border-slate-850 rounded-2xl">
                        <Sparkles size={28} className="text-indigo-400/40 mb-3" />
                        <h5 className="text-xs font-bold text-slate-200">Prêt pour le matching</h5>
                        <p className="text-[10px] text-slate-500 mt-1 max-w-xs">Modifiez les critères à gauche puis cliquez sur "Lancer le scan intelligent IA" pour afficher les e-mails correspondants.</p>
                      </div>
                    );
                  }

                  if (matchedResults.length === 0) {
                    return (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-950/20 border border-slate-850 rounded-2xl">
                        <Inbox size={28} className="text-slate-600 mb-3" />
                        <h5 className="text-xs font-bold text-slate-200">Aucun email correspondant</h5>
                        <p className="text-[10px] text-slate-500 mt-1 max-w-xs">
                          Aucun message contenant "{baseline.topicQuery}" n'a été trouvé. Essayez d'injecter un nouvel email test ou de modifier le mot-clé !
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="flex flex-col gap-4">
                      {matchedResults.map((result) => {
                        const email = emails.find(e => e.id === result.emailId);
                        if (!email) return null;
                        const isSent = sentEmailIds.includes(result.emailId);

                        return (
                          <div key={result.emailId} className="bg-slate-950 border border-slate-800/80 p-4 rounded-xl flex flex-col gap-3 shadow-md">
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h5 className="text-xs font-bold text-slate-100">{email.subject}</h5>
                                  <span className={`text-[8px] px-2 py-0.5 rounded-full font-bold uppercase border ${
                                    result.match === "perfect" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" :
                                    result.match === "partial" ? "bg-amber-500/10 text-amber-300 border-amber-500/25" :
                                    "bg-rose-500/10 text-rose-400 border-rose-500/25"
                                  }`}>
                                    {result.match === "perfect" ? "Match Parfait ✓" : result.match === "partial" ? "Match Partiel ~" : "Rejeté ✕"}
                                  </span>
                                </div>
                                <span className="text-[9px] text-indigo-400 mt-0.5 block">De : {email.from}</span>
                              </div>
                              <span className="text-[9px] text-slate-500 shrink-0">{email.date}</span>
                            </div>

                            {/* Reasoning */}
                            <div className="bg-slate-900/60 p-2.5 rounded-xl border border-slate-850 text-[10px] text-slate-300 leading-relaxed">
                              <strong className="text-indigo-400 block mb-0.5">Raisonnement de l'IA :</strong>
                              {result.reasoning}
                            </div>

                            {/* Draft Editor / Sent Status */}
                            <div className="border-t border-slate-800/60 pt-2.5">
                              {isSent ? (
                                <div className="flex flex-col gap-1.5 bg-emerald-950/10 border border-emerald-500/10 p-2.5 rounded-xl">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">Message Envoyé ✓</span>
                                    <span className="text-[8px] text-slate-500 font-medium">Réponse automatique complétée</span>
                                  </div>
                                  <p className="text-[9.5px] text-emerald-200 font-mono whitespace-pre-wrap leading-relaxed">{result.draft}</p>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[8px] font-bold text-indigo-300 uppercase tracking-wider">Réponse proposée par l'IA</span>
                                    <span className="text-[8px] text-slate-500 italic">Modifiable</span>
                                  </div>
                                  <textarea
                                    rows={4}
                                    value={result.draft}
                                    onChange={(e) => {
                                      const newDraft = e.target.value;
                                      setMatchResults(prev => ({
                                        ...prev,
                                        [activeBaselineId]: prev[activeBaselineId].map(r => r.emailId === result.emailId ? { ...r, draft: newDraft } : r)
                                      }));
                                    }}
                                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/40 font-mono leading-relaxed resize-y"
                                  />
                                  <div className="flex justify-end">
                                    <button
                                      onClick={() => handleValidateDraft(result.emailId, result.draft)}
                                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold px-3 py-1.5 rounded-lg transition-all shadow-md flex items-center gap-1 cursor-pointer"
                                    >
                                      <Check size={11} /> Valider le brouillon
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. UPGRADE MODAL / DEBLOQUEZ LA PUISSANCE */}
      {showUpgradeModal && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl relative overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="absolute top-0 right-0 w-36 h-36 bg-indigo-500/10 rounded-full blur-3xl -mr-12 -mt-12 pointer-events-none" />
            
            {/* Close Button */}
            <button 
              onClick={() => setShowUpgradeModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer text-sm p-1.5 hover:bg-slate-800/40 rounded-full"
            >
              ✕
            </button>

            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white mb-5 shadow-lg shadow-indigo-500/20">
                <Sparkles size={28} className="animate-pulse" />
              </div>

              <h3 className="text-base font-extrabold text-slate-100 uppercase tracking-wider mb-2">
                Débloquez la puissance
              </h3>
              
              <div className="h-[1px] w-16 bg-gradient-to-r from-transparent via-indigo-500 to-transparent my-3" />

              <p className="text-xs text-slate-300 leading-relaxed mb-6">
                Vous avez consommé vos <strong className="text-indigo-300 font-bold">25 prompts gratuits</strong>. Connectez votre compte de messagerie Google pour obtenir des prompts illimités en direct, le triage intelligent des mails critiques, des réponses automatisées en pilote automatique et l'historique complet !
              </p>

              {/* Benefits list */}
              <div className="w-full bg-slate-950/40 border border-slate-800/50 rounded-2xl p-4.5 mb-6 flex flex-col gap-3 text-left">
                <div className="flex items-start gap-2.5">
                  <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-[11px] text-slate-300"><strong className="text-white">Prompts illimités :</strong> Rédaction et relecture sans aucune restriction de volume.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-[11px] text-slate-300"><strong className="text-white">Filtre et alertes :</strong> Triage immédiat des emails importants sur votre tableau de bord.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                  <span className="text-[11px] text-slate-300"><strong className="text-white">Brouillons automatiques :</strong> Réponses ultra-rapides générées en arrière-plan.</span>
                </div>
              </div>

              <button
                onClick={handleConnectGoogle}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs py-3.5 px-6 rounded-xl shadow-lg hover:shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer animate-pulse"
              >
                <Plus size={15} /> Connecter avec Google Gmail
              </button>
              
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="mt-3.5 text-[11px] text-slate-500 hover:text-slate-300 font-medium transition-colors cursor-pointer"
              >
                Plus tard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}