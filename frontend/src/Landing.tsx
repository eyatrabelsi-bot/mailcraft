import { Link } from "react-router-dom";

// Marketing landing page for MailCraft AI.
// Scoped styles live in the <style> block below (prefixed `lp-`) so they
// can't leak into / clash with the Tailwind classes used by Dashboard.tsx.
export default function Landing() {
  return (
    <div className="lp">
      <style>{`
        .lp {
          --bg:#0a0c12;
          --panel:#12151d;
          --panel-2:#171b25;
          --panel-3:#1c212c;
          --border: rgba(255,255,255,0.07);
          --border-strong: rgba(255,255,255,0.12);
          --purple:#7c6cf0;
          --purple-bright:#9b8cff;
          --purple-deep:#5a3ff0;
          --purple-wash: rgba(124,108,240,0.14);
          --green:#22c55e;
          --green-wash: rgba(34,197,94,0.14);
          --red:#ef4444;
          --red-wash: rgba(239,68,68,0.14);
          --amber:#f5a524;
          --amber-wash: rgba(245,165,36,0.14);
          --teal:#2dd4bf;
          --teal-wash: rgba(45,212,191,0.14);
          --blue:#5b9dff;
          --blue-wash: rgba(91,157,255,0.14);
          --text:#eef0f5;
          --text-dim:#9aa1b2;
          --text-faint:#6b7182;
          --radius-sm:8px;
          --radius:12px;
          --radius-lg:16px;

          background:var(--bg);
          background-image:
            radial-gradient(circle at 15% 0%, rgba(124,108,240,0.10), transparent 45%),
            radial-gradient(circle at 85% 15%, rgba(124,108,240,0.06), transparent 40%);
          color:var(--text);
          font-family:'Inter', sans-serif;
          -webkit-font-smoothing:antialiased;
          min-height:100vh;
        }
        .lp h1, .lp h2, .lp h3, .lp h4 { font-family:'Inter', sans-serif; font-weight:800; letter-spacing:-0.01em; margin:0; }
        .lp a { color:inherit; text-decoration:none; }
        .lp .wrap { max-width:1180px; margin:0 auto; padding:0 32px; }

        .lp header { position:sticky; top:0; z-index:50; background:rgba(10,12,18,0.85); backdrop-filter:blur(12px); border-bottom:1px solid var(--border); }
        .lp nav.wrap { display:flex; align-items:center; justify-content:space-between; height:72px; }
        .lp .logo { display:flex; align-items:center; gap:11px; font-size:18px; font-weight:800; color:var(--text); }
        .lp .logo-mark { width:34px; height:34px; border-radius:10px; background:linear-gradient(135deg, var(--purple-bright), var(--purple-deep)); position:relative; flex-shrink:0; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 14px rgba(124,108,240,0.35); }
        .lp .logo-mark svg { width:17px; height:17px; }
        .lp .navlinks { display:flex; gap:32px; font-size:14px; font-weight:500; color:var(--text-dim); }
        .lp .navlinks a:hover { color:var(--text); }
        .lp .nav-cta { display:flex; align-items:center; gap:12px; }

        .lp .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 20px; font-size:14px; font-weight:600; border-radius:var(--radius-sm); border:1px solid transparent; cursor:pointer; transition:all .18s ease; }
        .lp .btn-primary { background:linear-gradient(135deg, var(--purple-bright), var(--purple-deep)); color:#fff; box-shadow:0 4px 16px rgba(124,108,240,0.3); }
        .lp .btn-primary:hover { filter:brightness(1.08); transform:translateY(-1px); }
        .lp .btn-ghost { border-color:var(--border-strong); color:var(--text); background:var(--panel-2); }
        .lp .btn-ghost:hover { border-color:var(--purple-bright); }
        .lp .btn-sm { padding:8px 16px; font-size:13px; }

        .lp .pill { display:inline-flex; align-items:center; gap:6px; font-size:11px; font-weight:700; padding:4px 11px; border-radius:20px; letter-spacing:0.02em; }
        .lp .pill::before { content:""; width:6px; height:6px; border-radius:50%; }
        .lp .pill-green { background:var(--green-wash); color:var(--green); }
        .lp .pill-green::before { background:var(--green); }

        @media(max-width:860px){ .lp .navlinks{ display:none; } }

        .lp .hero { padding:88px 0 64px; border-bottom:1px solid var(--border); }
        .lp .hero-grid { display:grid; grid-template-columns:1.05fr 1fr; gap:56px; align-items:center; }
        .lp .eyebrow { font-size:12.5px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:var(--purple-bright); display:flex; align-items:center; gap:10px; margin-bottom:22px; }
        .lp .eyebrow::before { content:""; width:22px; height:2px; border-radius:2px; background:var(--purple-bright); }
        .lp .hero h1 { font-size:46px; line-height:1.16; color:var(--text); margin:0 0 24px; max-width:560px; }
        .lp .hero h1 em { font-style:normal; background:linear-gradient(135deg, var(--purple-bright), #c3b8ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
        .lp .hero p.lead { font-size:17px; font-weight:400; line-height:1.65; color:var(--text-dim); max-width:480px; margin:0 0 34px; }
        .lp .hero-ctas { display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
        .lp .hero-note { margin-top:20px; font-size:13px; color:var(--text-faint); }
        .lp .hero-note a { color:var(--purple-bright); }

        .lp .sorter { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius-lg); padding:22px; position:relative; overflow:hidden; height:430px; box-shadow:0 20px 60px rgba(0,0,0,0.35); }
        .lp .sorter-head { display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600; color:var(--text-dim); padding-bottom:16px; border-bottom:1px solid var(--border); margin-bottom:6px; }
        .lp .sort-lane { position:relative; height:200px; margin-top:10px; }
        .lp .envelope { position:absolute; top:8px; left:0; width:132px; height:46px; background:var(--panel-3); border:1px solid var(--border-strong); border-radius:var(--radius-sm); box-shadow:0 6px 16px rgba(0,0,0,0.4); animation:lp-travel 8s linear infinite; }
        .lp .envelope::before { content:""; position:absolute; top:9px; left:9px; width:8px; height:8px; border-radius:50%; background:linear-gradient(135deg, var(--purple-bright), var(--purple-deep)); }
        .lp .envelope .subj { position:absolute; bottom:6px; left:10px; right:10px; font-size:9.5px; font-weight:500; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lp .e1 { animation-delay:0s; } .lp .e2 { animation-delay:2s; } .lp .e3 { animation-delay:4s; } .lp .e4 { animation-delay:6s; }
        @keyframes lp-travel {
          0% { left:0; top:8px; opacity:0; } 6% { opacity:1; }
          45% { left:calc(100% - 152px); top:8px; opacity:1; } 55% { top:66px; }
          58% { transform:scale(0.94); } 64% { transform:scale(1); }
          78% { left:calc(100% - 152px); top:66px; opacity:1; } 92% { opacity:0; }
          100% { opacity:0; left:calc(100% - 152px); top:66px; }
        }
        .lp .stamp { position:absolute; font-size:11px; font-weight:700; padding:4px 9px; border-radius:20px; background:var(--green-wash); color:var(--green); opacity:0; }
        .lp .stamp1 { animation:lp-stampfade 8s linear infinite; animation-delay:3.2s; }
        @keyframes lp-stampfade {
          0%,50% { opacity:0; transform:scale(0.9); } 54% { opacity:1; transform:scale(1.08); }
          58% { transform:scale(1); } 90% { opacity:1; } 96%,100% { opacity:0; }
        }
        .lp .trays { display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-top:18px; }
        .lp .tray { border:1px solid var(--border); background:var(--panel-2); border-radius:var(--radius-sm); padding:12px 8px; text-align:center; }
        .lp .tray .chip { display:inline-block; font-size:10.5px; font-weight:700; padding:3px 9px; border-radius:20px; margin-bottom:8px; }
        .lp .chip-urgent { background:var(--red-wash); color:var(--red); }
        .lp .chip-clients { background:var(--blue-wash); color:var(--blue); }
        .lp .chip-factures { background:var(--amber-wash); color:var(--amber); }
        .lp .chip-news { background:var(--teal-wash); color:var(--teal); }
        .lp .tray-count { font-size:19px; font-weight:800; color:var(--text); }

        .lp .section { padding:100px 0; border-bottom:1px solid var(--border); }
        .lp .section-head { max-width:640px; margin:0 0 64px; }
        .lp .section-head .eyebrow { margin-bottom:16px; }
        .lp .section-head h2 { font-size:32px; color:var(--text); margin:0 0 14px; }
        .lp .section-head p { color:var(--text-dim); font-weight:400; font-size:16px; line-height:1.6; margin:0; }

        .lp .feature-row { display:grid; grid-template-columns:1fr 1fr; gap:64px; align-items:center; padding:56px 0; }
        .lp .feature-row:not(:last-child) { border-bottom:1px solid var(--border); }
        .lp .feature-row.reverse .feature-text { order:2; }
        .lp .feature-row.reverse .feature-visual { order:1; }
        .lp .feature-index { font-size:12px; font-weight:700; color:var(--purple-bright); letter-spacing:0.06em; margin-bottom:16px; display:block; }
        .lp .feature-text h3 { font-size:24px; font-weight:700; color:var(--text); margin:0 0 14px; }
        .lp .feature-text p { color:var(--text-dim); font-weight:400; font-size:15.5px; line-height:1.7; max-width:420px; }
        .lp .feature-visual { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius-lg); padding:24px; min-height:220px; display:flex; align-items:center; justify-content:center; }

        .lp .label-cloud { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; }
        .lp .label-cloud .chip { font-size:12.5px; font-weight:600; padding:7px 15px; border-radius:20px; border:1px solid var(--border-strong); background:var(--panel-2); }

        .lp .cal { width:230px; background:var(--panel-2); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
        .lp .cal-head { background:linear-gradient(135deg, var(--purple-bright), var(--purple-deep)); color:#fff; font-size:11px; font-weight:700; padding:10px 14px; text-transform:uppercase; letter-spacing:0.04em; }
        .lp .cal-body { padding:14px; }
        .lp .cal-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--border); color:var(--text); font-size:12.5px; font-weight:500; }
        .lp .cal-row:last-child { border-bottom:none; }
        .lp .cal-dot { width:7px; height:7px; border-radius:50%; background:var(--text-faint); flex-shrink:0; }
        .lp .cal-dot.active { background:var(--purple-bright); box-shadow:0 0 0 3px var(--purple-wash); }

        .lp .reply-card { width:100%; max-width:340px; background:var(--panel-2); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; color:var(--text); }
        .lp .reply-from { font-size:11px; font-weight:500; color:var(--text-faint); margin-bottom:8px; }
        .lp .reply-subj { font-size:14px; font-weight:700; margin-bottom:12px; }
        .lp .reply-stamp { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:var(--green); background:var(--green-wash); padding:5px 11px; border-radius:20px; }

        .lp .chat-mock { width:100%; max-width:360px; display:flex; flex-direction:column; gap:12px; }
        .lp .bubble { padding:11px 15px; border-radius:var(--radius); font-size:13px; font-weight:500; line-height:1.5; max-width:88%; }
        .lp .bubble-user { align-self:flex-end; background:linear-gradient(135deg, var(--purple-bright), var(--purple-deep)); color:#fff; border-bottom-right-radius:4px; }
        .lp .bubble-ai { align-self:flex-start; background:var(--panel-3); border:1px solid var(--border); color:var(--text); border-bottom-left-radius:4px; }
        .lp .bubble-ai.decline { color:var(--text-dim); }
        .lp .bubble-tag { display:block; font-size:10px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:var(--green); margin-bottom:5px; }
        .lp .bubble-tag.off { color:var(--amber); }

        .lp .notif-card { width:100%; max-width:360px; background:var(--red-wash); border:1.5px solid rgba(239,68,68,0.4); border-radius:var(--radius); padding:16px 18px; }
        .lp .notif-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
        .lp .notif-label { font-size:11.5px; font-weight:800; letter-spacing:0.02em; color:var(--red); }
        .lp .notif-persist { font-size:9.5px; font-weight:700; color:var(--text-dim); border:1px solid var(--border-strong); padding:3px 9px; border-radius:20px; }
        .lp .notif-subj { font-size:14px; font-weight:700; color:var(--text); margin-bottom:6px; }
        .lp .notif-summary { font-size:12.5px; color:var(--text-dim); line-height:1.5; margin-bottom:14px; }
        .lp .notif-foot { display:flex; align-items:center; justify-content:space-between; padding-top:12px; border-top:1px solid rgba(239,68,68,0.25); }
        .lp .notif-lock { font-size:10.5px; font-weight:600; color:var(--text-dim); }

        .lp .mail-view { width:100%; max-width:360px; background:var(--panel-2); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; }
        .lp .mail-view .mail-subj { font-size:13.5px; font-weight:700; color:var(--text); margin-bottom:10px; }
        .lp .summary-box { background:var(--purple-wash); border:1px solid rgba(124,108,240,0.35); border-radius:var(--radius-sm); padding:10px 12px; margin-bottom:12px; }
        .lp .summary-tag { font-size:10px; font-weight:700; color:var(--purple-bright); text-transform:uppercase; letter-spacing:0.04em; display:block; margin-bottom:5px; }
        .lp .summary-text { font-size:12.5px; color:var(--text); font-weight:500; line-height:1.5; }
        .lp .mail-body-mini { font-size:12px; color:var(--text-faint); line-height:1.6; }

        .lp .inbox-mini { width:100%; }
        .lp .inbox-row { display:flex; align-items:center; gap:12px; padding:11px 4px; border-bottom:1px solid var(--border); font-size:13px; }
        .lp .inbox-row:last-child { border:none; }
        .lp .inbox-row .who { width:110px; flex-shrink:0; color:var(--text); font-weight:600; }
        .lp .inbox-row .snip { flex:1; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .lp .badge { font-size:10px; font-weight:700; padding:4px 10px; border-radius:20px; flex-shrink:0; }

        @media(max-width:860px){
          .lp .feature-row, .lp .feature-row.reverse { grid-template-columns:1fr; gap:28px; }
          .lp .feature-row.reverse .feature-text { order:1; }
          .lp .feature-row.reverse .feature-visual { order:2; }
          .lp .hero-grid { grid-template-columns:1fr; }
        }

        .lp .platforms { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
        .lp .platform-card { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius-lg); padding:32px; }
        .lp .platform-card h4 { font-size:18px; font-weight:700; margin:0 0 10px; color:var(--text); }
        .lp .platform-card p { color:var(--text-dim); font-weight:400; font-size:14px; line-height:1.6; margin:0 0 20px; }
        @media(max-width:700px){ .lp .platforms { grid-template-columns:1fr; } }

        .lp .closing { padding:120px 0; text-align:center; border-bottom:none; }
        .lp .closing h2 { font-size:38px; color:var(--text); margin:0 0 30px; }
        .lp .closing .btn { padding:14px 30px; font-size:15px; }

        .lp footer { border-top:1px solid var(--border); padding:32px 0; font-size:13px; color:var(--text-faint); display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; }

        @media (prefers-reduced-motion: reduce){ .lp .envelope, .lp .stamp { animation:none !important; opacity:1 !important; } }
      `}</style>

      <header>
        <nav className="wrap">
          <div className="logo">
            <span className="logo-mark">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L14 9L21 11L14 13L12 20L10 13L3 11L10 9L12 2Z" fill="white" />
              </svg>
            </span>
            MailCraft AI
          </div>
          <div className="navlinks">
            <a href="#tri">Le tri</a>
            <a href="#agenda">Agenda</a>
            <a href="#reponses">Réponses</a>
            <a href="#assistant">Assistant</a>
            <a href="#partout">Extension &amp; app</a>
          </div>
          <div className="nav-cta">
            <Link to="/app" className="btn btn-ghost btn-sm">Connexion</Link>
            <Link to="/app" className="btn btn-primary btn-sm">Ajouter à Chrome</Link>
          </div>
        </nav>
      </header>

      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow">Assistant IA pour Gmail</div>
            <h1>Votre boîte de réception<br />se trie <em>toute seule.</em></h1>
            <p className="lead">MailCraft lit chaque e-mail qui arrive, l'étiquette, range les rendez-vous dans votre agenda et répond à votre place quand il le reconnaît — sans que vous ayez à ouvrir Gmail.</p>
            <div className="hero-ctas">
              <Link to="/app" className="btn btn-primary">Ajouter à Chrome — gratuit</Link>
              <Link to="/assistant" className="btn btn-ghost">Essayer l'assistant IA gratuitement</Link>
            </div>
            <div className="hero-note">Extension Chrome + application Android · connecté à votre compte Gmail · <a href="#tri">voir comment ça trie ↓</a></div>
          </div>

          <div className="sorter">
            <div className="sorter-head">
              <span>Boîte de réception — Tri IA Actif</span>
              <span className="pill pill-green">Gmail Connecté</span>
            </div>

            <div className="sort-lane">
              <div className="envelope e1"><div className="subj">Facture EDF — Novembre</div></div>
              <div className="envelope e2"><div className="subj">Réunion budget — jeudi 10h</div></div>
              <div className="envelope e3"><div className="subj">Re: Devis client Dupont</div></div>
              <div className="envelope e4"><div className="subj">-30% avant minuit !</div></div>
              <div className="stamp stamp1">RÉPONDU ✓</div>
            </div>

            <div className="trays">
              <div className="tray"><span className="chip chip-urgent">Urgent</span><div className="tray-count">02</div></div>
              <div className="tray"><span className="chip chip-clients">Clients</span><div className="tray-count">04</div></div>
              <div className="tray"><span className="chip chip-factures">Factures</span><div className="tray-count">01</div></div>
              <div className="tray"><span className="chip chip-news">Promos</span><div className="tray-count">07</div></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="tri">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Comment ça trie</div>
            <h2>Ce que MailCraft fait à votre place</h2>
            <p>Pas un simple filtre par mot-clé : MailCraft comprend le contenu de chaque e-mail avant de décider où il va.</p>
          </div>

          <div className="feature-row">
            <div className="feature-text">
              <span className="feature-index">FILTRER — CLASSIFIER</span>
              <h3>Chaque e-mail est lu et rangé à son arrivée</h3>
              <p>MailCraft analyse l'expéditeur, l'objet et le corps du message pour comprendre de quoi il s'agit, puis le classe dans la bonne catégorie avant même que vous n'ouvriez Gmail.</p>
            </div>
            <div className="feature-visual">
              <div className="inbox-mini">
                <div className="inbox-row"><span className="who">A. Dupont</span><span className="snip">Re: proposition commerciale — retour du client</span><span className="badge chip-clients">Clients</span></div>
                <div className="inbox-row"><span className="who">EDF</span><span className="snip">Votre facture de novembre est disponible</span><span className="badge chip-factures">Factures</span></div>
                <div className="inbox-row"><span className="who">Système RH</span><span className="snip">Entretien annuel à planifier avant le 30/11</span><span className="badge chip-urgent">Urgent</span></div>
                <div className="inbox-row"><span className="who">La Redoute</span><span className="snip">Derniers jours : -30% sur toute la collection</span><span className="badge chip-news">Promos</span></div>
              </div>
            </div>
          </div>

          <div className="feature-row reverse">
            <div className="feature-text">
              <span className="feature-index">LIBELLÉS AUTOMATIQUES</span>
              <h3>Des libellés Gmail créés selon le tri</h3>
              <p>Plus besoin de construire vos filtres à la main : MailCraft crée et applique directement les libellés Gmail correspondants, et les affine au fil de vos e-mails.</p>
            </div>
            <div className="feature-visual">
              <div className="label-cloud">
                <span className="chip chip-urgent">Urgent</span>
                <span className="chip chip-clients">Clients</span>
                <span className="chip chip-factures">Factures</span>
                <span className="chip chip-news">Newsletters</span>
                <span className="chip" style={{ color: "var(--text)" }}>Fournisseurs</span>
                <span className="chip" style={{ color: "var(--text)" }}>RH</span>
                <span className="chip" style={{ color: "var(--text)" }}>À suivre</span>
              </div>
            </div>
          </div>

          <div className="feature-row" id="agenda">
            <div className="feature-text">
              <span className="feature-index">AGENDA</span>
              <h3>Les rendez-vous rejoignent votre agenda seuls</h3>
              <p>Dès qu'un e-mail contient une date, une heure ou un lieu de rendez-vous, MailCraft l'ajoute à votre agenda et programme un rappel avant l'échéance.</p>
            </div>
            <div className="feature-visual">
              <div className="cal">
                <div className="cal-head">Jeudi 27 novembre</div>
                <div className="cal-body">
                  <div className="cal-row"><span className="cal-dot active"></span> 10:00 — Réunion budget (ajouté par MailCraft)</div>
                  <div className="cal-row"><span className="cal-dot"></span> 14:30 — Appel client Dupont</div>
                  <div className="cal-row"><span className="cal-dot active"></span> 18:00 — Rappel : facture EDF à régler</div>
                </div>
              </div>
            </div>
          </div>

          <div className="feature-row reverse" id="reponses">
            <div className="feature-text">
              <span className="feature-index">RÉPONSES AUTOMATIQUES</span>
              <h3>Une réponse part quand le message correspond</h3>
              <p>Pour les e-mails qui suivent un schéma que vous avez défini — confirmation de rendez-vous, accusé de réception, demande récurrente — MailCraft répond directement, dans votre style.</p>
            </div>
            <div className="feature-visual">
              <div className="reply-card">
                <div className="reply-from">De : cabinet.martin@exemple.fr</div>
                <div className="reply-subj">Confirmation de votre rendez-vous du 2 décembre</div>
                <div className="reply-stamp">RÉPONDU ✓</div>
              </div>
            </div>
          </div>

          <div className="feature-row">
            <div className="feature-text">
              <span className="feature-index">RÉSUMÉ AUTOMATIQUE</span>
              <h3>Chaque e-mail arrive déjà résumé</h3>
              <p>Plus besoin de lire le message en entier pour savoir de quoi il retourne : MailCraft place un résumé en une phrase en haut de chaque e-mail, avant même le corps du texte.</p>
            </div>
            <div className="feature-visual">
              <div className="mail-view">
                <div className="mail-subj">Mandatory Department Meeting — Tomorrow at 11:00 AM</div>
                <div className="summary-box">
                  <span className="summary-tag">Résumé IA MailCraft</span>
                  <div className="summary-text">Réunion de département obligatoire demain à 11h, à l'université.</div>
                </div>
                <div className="mail-body-mini">Dear Colleagues, this is to inform you that a department meeting is scheduled for tomorrow at 11:00 AM…</div>
              </div>
            </div>
          </div>

          <div className="feature-row reverse">
            <div className="feature-text">
              <span className="feature-index">NOTIFICATIONS PERSISTANTES</span>
              <h3>Les e-mails importants ne se laissent pas ignorer</h3>
              <p>Quand un message est jugé important, MailCraft envoie une notification persistante qui reste affichée tant qu'elle n'a pas été ouverte — impossible de la balayer ou de l'effacer sans l'avoir lue.</p>
            </div>
            <div className="feature-visual">
              <div className="notif-card">
                <div className="notif-top">
                  <span className="notif-label">⚠ URGENT IMPORTANT !</span>
                  <span className="notif-persist">Persistant</span>
                </div>
                <div className="notif-subj">Interview</div>
                <div className="notif-summary">Résumé IA : Votre entretien est prévu demain à 16h00, dans les locaux de l'entreprise.</div>
                <div className="notif-foot">
                  <span className="notif-lock">🔒 Obligatoire d'ouvrir pour effacer</span>
                  <Link to="/app" className="btn btn-primary btn-sm">Ouvrir</Link>
                </div>
              </div>
            </div>
          </div>

          <div className="feature-row" id="assistant">
            <div className="feature-text">
              <span className="feature-index">ASSISTANT PAR PROMPTS</span>
              <h3>Vous pouvez aussi juste lui demander</h3>
              <p>MailCraft fonctionne aussi comme un assistant conversationnel : "résume mes e-mails de ce matin", "trouve le devis de Dupont", "quand est mon prochain rendez-vous ?". Il ne répond qu'aux questions liées à vos e-mails — le reste, il décline poliment, pour rester concentré sur votre boîte de réception.</p>
              <Link to="/assistant" className="btn btn-primary btn-sm" style={{ marginTop: "8px" }}>Essayer l'assistant IA gratuitement</Link>
            </div>
            <div className="feature-visual">
              <div className="chat-mock">
                <div className="bubble bubble-user">Résume mes e-mails de ce matin</div>
                <div className="bubble bubble-ai">
                  <span className="bubble-tag">Lié à vos mails</span>
                  3 messages : une facture EDF, une confirmation de rendez-vous jeudi à 10h, et une relance du client Dupont.
                </div>
                <div className="bubble bubble-user">Quelle est la capitale de la France ?</div>
                <div className="bubble bubble-ai decline">
                  <span className="bubble-tag off">Hors sujet</span>
                  Je ne réponds qu'aux questions liées à vos e-mails et votre agenda.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="partout" style={{ borderBottom: "none" }}>
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow">Disponible partout</div>
            <h2>Dans votre navigateur et dans votre poche</h2>
            <p>MailCraft s'installe là où vous lisez déjà vos e-mails.</p>
          </div>
          <div className="platforms">
            <div className="platform-card">
              <h4>Extension Chrome</h4>
              <p>S'ajoute directement dans Gmail : les libellés et les badges de tri apparaissent à côté de chaque e-mail, sans changer vos habitudes.</p>
              <a href="#" className="btn btn-ghost btn-sm">Ajouter à Chrome</a>
            </div>
            <div className="platform-card">
              <h4>Application Android</h4>
              <p>Recevez vos rappels de rendez-vous et un résumé de votre tri du jour, même loin de votre bureau.</p>
              <a href="#" className="btn btn-ghost btn-sm">Télécharger l'app</a>
            </div>
          </div>
        </div>
      </section>

      <section className="closing">
        <div className="wrap">
          <h2>Une boîte de réception, enfin rangée.</h2>
          <Link to="/app" className="btn btn-primary">Ajouter à Chrome — gratuit</Link>
        </div>
      </section>

      <footer>
        <div className="wrap" style={{ display: "flex", justifyContent: "space-between", width: "100%", flexWrap: "wrap", gap: "12px" }}>
          <span>MailCraft AI — assistant e-mail IA</span>
          <span>Extension Chrome · Application Android</span>
        </div>
      </footer>
    </div>
  );
}
