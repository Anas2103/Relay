// Génère Relay_Presentation.pptx (16:9, formes PowerPoint natives et modifiables).
// Usage : node generate.mjs   (les valeurs PERT / Gantt / burndown viennent de pert.mjs)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computePert, computeBurndown, STORIES, START_DATE } from "./pert.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.chdir(HERE);
const require = createRequire(import.meta.url);
const pptxgen = require("pptxgenjs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa6");
const { applyTheme } = require("./apply_theme.cjs");

// ---------- Paramètres ----------
const AUTHOR = "Hardouch Anas";
const PARTNER = "Bradli Riad";
const TEAM = `${AUTHOR} & ${PARTNER}`;
const OUT = process.argv[2] ?? "Relay_Presentation.pptx"; // ex. : node generate.mjs brouillon.pptx

// ---------- Thème : 1 couleur principale (indigo de Relay) + 1 accent (orange) ----------
const P = "4F46E5"; // principale
const PD = "1E1B4B"; // principale foncée (titres, fonds sombres)
const PL = "EEF2FF"; // teinte claire
const PB = "C7D2FE"; // bordures claires
const A = "EA580C"; // accent : chemin critique, mises en avant
const AL = "FFEDD5"; // teinte accent
const TX = "1F2937";
const MU = "6B7280";
const GR = "F3F4F6";
const WH = "FFFFFF";
const FONT = "Calibri";

const THEME = {
  name: "Relay",
  headFontFace: FONT,
  bodyFontFace: FONT,
  colors: {
    dk1: "000000", lt1: "FFFFFF", dk2: PD, lt2: PL,
    accent1: P, accent2: A, accent3: "6366F1", accent4: "0EA5E9", accent5: "10B981", accent6: "A855F7",
    hlink: P, folHlink: "7C3AED",
  },
};

const pert = computePert();
const bd = computeBurndown(pert);
const T = Object.fromEntries(pert.tasks.map((t) => [t.id, t]));
const fr = (n) => String(n).replace(".", ",");

const SHORT = {
  A: "Analyse des besoins", B: "Conception", C: "BD D1 & authentification", D: "Messagerie temps réel",
  E: "Interface React", F: "Appels WebRTC", G: "Demandes & groupes", H: "Chats secrets (E2EE)",
  I: "2FA, appareils & PWA", J: "Administration", K: "Chill & jeux", L: "Tests E2E & CI", M: "Déploiement",
};

// ---------- Icônes (react-icons → PNG) ----------
async function icon(name, color = WH, size = 256) {
  const svg = renderToStaticMarkup(React.createElement(fa[name], { color: "#" + color, size: String(size) }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// ---------- Présentation ----------
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13,333 × 7,5 po
pres.author = TEAM;
pres.title = "Relay – Présentation du projet";
pres.subject = "Gestion de projet Agile – SupMTI ISI";
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

pres.defineSlideMaster({
  title: "CONTENU",
  background: { color: WH },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.3, w: 12.13, h: 0.75, fontFace: FONT, fontSize: 30, bold: true, color: PD, valign: "middle", align: "center", margin: 0 }, text: "" } },
    { text: { text: "Relay · SupMTI – ISI · 2026–2027", options: { x: 0.6, y: 7.05, w: 5, h: 0.3, fontFace: FONT, fontSize: 10, color: MU, margin: 0 } } },
  ],
  slideNumber: { x: 12.13, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: MU, align: "right" },
});
pres.defineSlideMaster({
  title: "SOMBRE",
  background: { color: PD },
  objects: [],
  slideNumber: { x: 12.13, y: 7.05, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: "A5B4FC", align: "right" },
});

// ---------- Aides ----------
function txt(s, text, x, y, w, h, o = {}) {
  s.addText(text, { x, y, w, h, fontFace: FONT, fontSize: 14, color: TX, margin: 0, valign: "top", isTextBox: true, ...o });
}
function box(s, x, y, w, h, o = {}) {
  s.addShape(o.round === false ? pres.shapes.RECTANGLE : pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h,
    fill: { color: o.fill ?? WH },
    line: o.line === null ? { type: "none" } : { color: o.line ?? PB, width: o.lw ?? 1, dashType: o.dash ?? "solid" },
    ...(o.round === false ? {} : { rectRadius: o.r ?? 0.08 }),
    ...(o.shadow ? { shadow: { type: "outer", color: "000000", opacity: 0.12, blur: 6, offset: 2, angle: 90 } } : {}),
  });
}
// Ligne de (x1,y1) à (x2,y2) ; flèche sur l'extrémité finale si `end`
function line(s, x1, y1, x2, y2, o = {}) {
  s.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
    flipH: x2 < x1, flipV: y2 < y1,
    line: {
      color: o.color ?? MU, width: o.w ?? 1.25, dashType: o.dash ?? "solid",
      endArrowType: o.end ?? "none", beginArrowType: o.begin ?? "none",
    },
  });
}
// Polyligne : flèche seulement sur le dernier segment
function poly(s, pts, o = {}) {
  for (let i = 0; i < pts.length - 1; i++) {
    const last = i === pts.length - 2;
    line(s, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], { ...o, end: last ? o.end ?? "none" : "none" });
  }
}
// Point du bord d'un rectangle (centre cx,cy) dans la direction de (tx,ty)
function edge(cx, cy, w, h, tx, ty) {
  const dx = tx - cx, dy = ty - cy;
  const k = Math.min(Math.abs(dx) > 1e-9 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * k, cy + dy * k];
}
function connect(s, a, b, o = {}) {
  const [x1, y1] = edge(a.cx, a.cy, a.w, a.h, b.cx, b.cy);
  const [x2, y2] = edge(b.cx, b.cy, b.w, b.h, a.cx, a.cy);
  line(s, x1, y1, x2, y2, o);
  return [x1, y1, x2, y2];
}
async function iconCircle(s, name, x, y, d, bg = P, fg = WH) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: bg }, line: { type: "none" } });
  const p = d * 0.26;
  s.addImage({ data: await icon(name, fg), x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p });
}
function numCircle(s, n, x, y, d, bg = P, size = 14) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: bg }, line: { type: "none" } });
  txt(s, String(n), x, y, d, d, { fontSize: size, bold: true, color: WH, align: "center", valign: "middle" });
}
function newSlide(title, section) {
  const s = pres.addSlide({ masterName: "CONTENU", sectionTitle: section });
  s.addText(title, { placeholder: "title" });
  return s;
}
function actor(s, cx, top, label) {
  const c = PD;
  s.addShape(pres.shapes.OVAL, { x: cx - 0.15, y: top, w: 0.3, h: 0.3, fill: { color: WH }, line: { color: c, width: 1.75 } });
  line(s, cx, top + 0.3, cx, top + 0.72, { color: c, w: 1.75 });
  line(s, cx - 0.3, top + 0.45, cx + 0.3, top + 0.45, { color: c, w: 1.75 });
  line(s, cx, top + 0.72, cx - 0.25, top + 1.02, { color: c, w: 1.75 });
  line(s, cx, top + 0.72, cx + 0.25, top + 1.02, { color: c, w: 1.75 });
  txt(s, label, cx - 0.85, top + 1.07, 1.7, 0.28, { fontSize: 13, bold: true, align: "center", color: PD });
}
const hdrCell = (t) => ({ text: t, options: { bold: true, color: WH, fill: { color: PD }, align: "center", valign: "middle" } });
const dayLabel = (d, o = { weekday: "short", day: "numeric", month: "short" }) => {
  const dt = new Date(START_DATE);
  dt.setDate(dt.getDate() + d);
  return dt.toLocaleDateString("fr-FR", o);
};
const SPRINTS = [
  { n: 1, from: 0, to: 1, goal: "Socle : comptes et messagerie temps réel" },
  { n: 2, from: 2, to: 3, goal: "Appels, groupes, chats secrets, Chill" },
  { n: 3, from: 4, to: 5, goal: "Sécurité, administration, tests, mise en ligne" },
];
const sprintPts = SPRINTS.map((sp) => STORIES.filter((u) => u.sprint === sp.n).reduce((a, u) => a + u.pts, 0));

// =====================================================================
// 1. Titre
// =====================================================================
{
  pres.addSection({ title: "Introduction" });
  const s = pres.addSlide({ masterName: "SOMBRE", sectionTitle: "Introduction" });
  await iconCircle(s, "FaComments", 0.9, 1.15, 1.1, P);
  txt(s, "Relay", 0.9, 2.45, 8, 1.2, { fontSize: 66, bold: true, color: WH, valign: "middle" });
  txt(s, "Messagerie instantanée sécurisée, en temps réel", 0.9, 3.65, 9, 0.55, { fontSize: 24, color: "C7D2FE", italic: true });
  txt(s, [
    { text: "Réalisé par : ", options: { bold: true, color: WH } },
    { text: TEAM, options: { color: WH, breakLine: true } },
    { text: "SupMTI – Ingénierie des Systèmes Informatiques (ISI)", options: { color: "C7D2FE", breakLine: true } },
    { text: "Module : Gestion de projet Agile", options: { color: "C7D2FE", breakLine: true } },
    { text: "Année universitaire 2026–2027", options: { color: "C7D2FE" } },
  ], 0.9, 4.65, 8, 1.7, { fontSize: 18, paraSpaceAfter: 4 });
  // Motif : bulles de discussion
  box(s, 9.3, 1.6, 3.0, 0.8, { fill: P, line: null, r: 0.3 });
  txt(s, "Salut ! On s'appelle ?", 9.5, 1.6, 2.7, 0.8, { fontSize: 16, color: WH, valign: "middle" });
  box(s, 8.6, 2.65, 3.0, 0.8, { fill: "312E81", line: null, r: 0.3 });
  txt(s, "Oui, je lance l'appel", 8.8, 2.65, 2.7, 0.8, { fontSize: 16, color: WH, valign: "middle" });
  box(s, 9.3, 3.7, 3.0, 0.8, { fill: A, line: null, r: 0.3 });
  txt(s, "Chat secret activé", 9.5, 3.7, 2.7, 0.8, { fontSize: 16, color: WH, valign: "middle", bold: true });
  s.addNotes(
    `Bonjour à tous. Nous sommes ${AUTHOR} et ${PARTNER}, et nous allons vous présenter Relay, une application web de messagerie instantanée en temps réel que nous avons réalisée en binôme. ` +
    "Relay permet de discuter, d'appeler et d'échanger des fichiers de façon sécurisée, et elle est en ligne aujourd'hui. " +
    "Nous présenterons le projet, son analyse et sa conception, puis la gestion de projet Agile qui l'a accompagné.",
  );
}

// =====================================================================
// 2. Plan
// =====================================================================
{
  const s = newSlide("Plan de la présentation", "Introduction");
  const parts = [
    ["Contexte et problématique", "Objectifs et problèmes identifiés"],
    ["Solution et fonctionnalités", "Réponses apportées, aperçu de l'application"],
    ["Analyse et conception", "Besoins, cas d'utilisation, classes, séquence, activité"],
    ["Architecture et sécurité", "Cloudflare, technologies, chiffrement"],
    ["Méthodologie Scrum", "Rôles, backlog produit, sprints"],
    ["Planification", "WBS, tâches, PERT, Gantt"],
    ["Suivi et qualité", "Burndown, vélocité, Kanban, tests et CI"],
    ["Bilan et conclusion", "Résultats et perspectives"],
  ];
  parts.forEach(([t, d], i) => {
    const col = Math.floor(i / 4), row = i % 4;
    const x = 0.6 + col * 6.17, y = 1.35 + row * 1.33;
    box(s, x, y, 5.96, 1.13, { fill: row % 2 === 0 ? PL : WH, line: row % 2 === 0 ? null : PB });
    numCircle(s, i + 1, x + 0.25, y + 0.26, 0.6, P, 18);
    txt(s, t, x + 1.1, y + 0.15, 4.7, 0.45, { fontSize: 19, bold: true, color: PD, valign: "middle" });
    txt(s, d, x + 1.1, y + 0.6, 4.7, 0.38, { fontSize: 14, color: MU, valign: "middle" });
  });
  s.addNotes(
    "Notre présentation suit huit parties. Nous commençons par le contexte, la problématique et la solution, avec un aperçu de l'application. " +
    "Nous détaillons ensuite l'analyse et la conception, avec les diagrammes UML, puis l'architecture et la sécurité. " +
    "Enfin, nous présentons la gestion de projet : Scrum, planification, suivi et qualité, avant le bilan.",
  );
}

// =====================================================================
// 3. Contexte et objectifs
// =====================================================================
{
  pres.addSection({ title: "Contexte et solution" });
  const s = newSlide("Contexte et objectifs", "Contexte et solution");
  box(s, 0.6, 1.3, 5.9, 2.75, { fill: PL, line: null, r: 0.12 });
  txt(s, "Contexte", 0.9, 1.45, 5.3, 0.45, { fontSize: 20, bold: true, color: PD });
  txt(s, [
    { text: "Application web de messagerie inspirée de Telegram et Discord", options: { bullet: true, breakLine: true } },
    { text: "Projet réalisé en binôme du 11 au 16 novembre 2026", options: { bullet: true, breakLine: true } },
    { text: "En ligne sur Cloudflare (offre gratuite), installable comme une application", options: { bullet: true } },
  ], 0.9, 1.95, 5.4, 2.0, { fontSize: 16, paraSpaceAfter: 8 });
  const stats = [["55", "tests E2E automatisés"], ["15", "migrations SQL"], ["≈ 36 k", "lignes de TypeScript"]];
  stats.forEach(([n, l], i) => {
    const x = 0.6 + i * 2.03;
    box(s, x, 4.3, 1.84, 2.0, { fill: WH, line: PB });
    txt(s, n, x, 4.5, 1.84, 0.8, { fontSize: 34, bold: true, color: i === 0 ? A : P, align: "center", valign: "middle" });
    txt(s, l, x + 0.1, 5.35, 1.64, 0.7, { fontSize: 13, color: MU, align: "center" });
  });
  txt(s, "Objectifs", 6.85, 1.35, 5.88, 0.45, { fontSize: 20, bold: true, color: PD });
  const goals = [
    ["FaBolt", "Temps réel", "Messages, présence et appels instantanés"],
    ["FaShieldHalved", "Sécurité", "Confidentialité et protection des comptes"],
    ["FaMoneyBillWave", "Gratuité", "Hébergement sur l'offre gratuite Cloudflare"],
    ["FaMobileScreen", "Accessibilité", "Ordinateur et mobile, application installable"],
  ];
  for (let i = 0; i < 4; i++) {
    const [ic, t, d] = goals[i];
    const y = 1.95 + i * 1.1;
    await iconCircle(s, ic, 6.85, y + 0.1, 0.7, P);
    txt(s, t, 7.8, y + 0.05, 4.9, 0.4, { fontSize: 17, bold: true, color: PD });
    txt(s, d, 7.8, y + 0.45, 4.9, 0.4, { fontSize: 15, color: MU });
  }
  s.addNotes(
    `Relay est une application web de messagerie inspirée de Telegram et de Discord, que nous avons développée en binôme du 11 au 16 novembre 2026. ` +
    "Nos quatre objectifs étaient le temps réel, la sécurité, la gratuité de l'hébergement et l'accessibilité sur ordinateur comme sur mobile. " +
    "Quelques chiffres : 55 tests de bout en bout, 15 migrations de base de données et environ 36 000 lignes de TypeScript.",
  );
}

// =====================================================================
// 4. Problématique
// =====================================================================
const PROBLEMS = [
  ["FaEye", "Confidentialité", "Les messages restent lisibles par la plateforme qui les héberge"],
  ["FaMoneyBillWave", "Coût du temps réel", "Un serveur WebSocket coûte cher ou se met en veille sur les offres gratuites"],
  ["FaKey", "Sécurité des comptes", "Mots de passe volés, appareils perdus ou restés connectés"],
  ["FaUserSlash", "Abus et spam", "Contacts non désirés, harcèlement, contenus à signaler"],
];
{
  const s = newSlide("Problématique", "Contexte et solution");
  txt(s, "Comment offrir une messagerie temps réel, sûre et gratuite à un cercle d'amis et de proches ?", 0.6, 1.25, 12.13, 0.5, { fontSize: 18, italic: true, color: P, align: "center" });
  for (let i = 0; i < 4; i++) {
    const [ic, t, d] = PROBLEMS[i];
    const x = 0.6 + i * 3.08;
    box(s, x, 2.15, 2.87, 3.6, { fill: WH, line: PB, shadow: true });
    await iconCircle(s, ic, x + 0.98, 2.5, 0.9, PL, P);
    txt(s, t, x + 0.2, 3.65, 2.47, 0.5, { fontSize: 19, bold: true, color: PD, align: "center" });
    txt(s, d, x + 0.25, 4.25, 2.37, 1.3, { fontSize: 15, color: TX, align: "center" });
  }
  s.addNotes(
    "Notre question de départ : comment offrir une messagerie en temps réel, sûre et gratuite à un petit cercle d'utilisateurs ? " +
    "Nous avons identifié quatre problèmes : la confidentialité des messages, le coût d'hébergement du temps réel, la sécurité des comptes, et enfin les abus comme le spam ou les contacts non désirés.",
  );
}

// =====================================================================
// 5. Solutions
// =====================================================================
{
  const s = newSlide("Solutions apportées", "Contexte et solution");
  const SOL = [
    "Chats secrets chiffrés de bout en bout (ECDH + AES-GCM) : ni le serveur ni les admins ne peuvent les lire",
    "Cloudflare Workers + Durable Objects (hibernation WebSocket) : 0 € d'hébergement",
    "2FA (TOTP), liste des appareils, déconnexion à distance, mots de passe hachés (PBKDF2)",
    "Demandes de contact, blocage, signalements et modération par rôles",
  ];
  txt(s, "Problème", 0.6, 1.25, 3.6, 0.4, { fontSize: 15, bold: true, color: MU });
  txt(s, "Solution dans Relay", 5.05, 1.25, 7, 0.4, { fontSize: 15, bold: true, color: MU });
  for (let i = 0; i < 4; i++) {
    const y = 1.75 + i * 1.3;
    box(s, 0.6, y, 3.6, 1.1, { fill: PL, line: null });
    await iconCircle(s, PROBLEMS[i][0], 0.8, y + 0.25, 0.6, P);
    txt(s, PROBLEMS[i][1], 1.55, y, 2.55, 1.1, { fontSize: 16, bold: true, color: PD, valign: "middle" });
    line(s, 4.3, y + 0.55, 4.95, y + 0.55, { color: A, w: 2.25, end: "triangle" });
    box(s, 5.05, y, 7.68, 1.1, { fill: WH, line: PB });
    txt(s, SOL[i], 5.3, y, 7.25, 1.1, { fontSize: 15, valign: "middle" });
  }
  s.addNotes(
    "Chaque problème a une réponse précise dans Relay. Pour la confidentialité, les chats secrets sont chiffrés de bout en bout : seuls les appareils des deux participants peuvent les lire. " +
    "Pour le coût, Cloudflare Workers et les Durable Objects gèrent les WebSockets sans serveur à payer. " +
    "Les comptes sont protégés par la double authentification et la gestion des appareils, et les abus sont traités par les demandes de contact, le blocage et la modération.",
  );
}

// =====================================================================
// 6. Fonctionnalités
// =====================================================================
{
  const s = newSlide("Fonctionnalités principales", "Contexte et solution");
  const F = [
    ["FaComments", "Messagerie temps réel", "Réponses, réactions, accusés de lecture"],
    ["FaVideo", "Appels audio et vidéo", "WebRTC pair à pair, partage d'écran"],
    ["FaLock", "Chats secrets", "Chiffrement de bout en bout"],
    ["FaUsers", "Groupes et demandes", "Liens d'invitation, blocage"],
    ["FaMicrophone", "Médias et notes vocales", "Photos éphémères, transcription IA"],
    ["FaMobileScreen", "Application installable", "PWA, hors ligne, notifications push"],
    ["FaUserShield", "Administration", "Rôles, signalements, journal d'audit"],
    ["FaMusic", "Espace « Chill »", "Musique, radio, podcasts, jeux"],
  ];
  for (let i = 0; i < 8; i++) {
    const [ic, t, d] = F[i];
    const col = i % 4, row = Math.floor(i / 4);
    const x = 0.6 + col * 3.08, y = 1.35 + row * 2.8;
    box(s, x, y, 2.87, 2.55, { fill: row === 0 ? PL : WH, line: row === 0 ? null : PB });
    await iconCircle(s, ic, x + 0.25, y + 0.3, 0.75, i === 2 ? A : P);
    txt(s, t, x + 0.25, y + 1.2, 2.45, 0.5, { fontSize: 17, bold: true, color: PD });
    txt(s, d, x + 0.25, y + 1.7, 2.45, 0.7, { fontSize: 14, color: MU });
  }
  s.addNotes(
    "Voici les huit fonctionnalités principales. La messagerie temps réel et les appels audio-vidéo forment le cœur de l'application, avec les chats secrets chiffrés. " +
    "On trouve aussi les groupes, les médias et notes vocales avec transcription par IA, et une application installable qui fonctionne hors ligne. " +
    "Enfin, l'administration permet la modération, et l'espace Chill propose musique, radio et jeux.",
  );
}

// =====================================================================
// 7. Aperçu de l'application (captures réelles)
// =====================================================================
{
  const s = newSlide("Aperçu de l'application", "Contexte et solution");
  const H = 4.25, DW = H * 1.6, PW = (H * 390) / 844, G = 0.45;
  const x0 = 0.6 + (12.13 - (DW + 2 * PW + 2 * G)) / 2, y = 1.6;
  // Ordinateur : fenêtre de navigateur
  box(s, x0 - 0.06, y - 0.32, DW + 0.12, H + 0.38, { fill: "E5E7EB", line: null, r: 0.06 });
  ["EF4444", "F59E0B", "22C55E"].forEach((c, i) =>
    s.addShape(pres.shapes.OVAL, { x: x0 + 0.06 + i * 0.17, y: y - 0.22, w: 0.11, h: 0.11, fill: { color: c }, line: { type: "none" } }));
  s.addImage({ path: "assets/desktop.png", x: x0, y, w: DW, h: H, altText: "Relay sur ordinateur : conversation en thème clair" });
  // Mobiles
  const phones = [["assets/phone.png", "Relay sur mobile : conversation en thème sombre"], ["assets/secret-phone.png", "Relay sur mobile : chat secret chiffré de bout en bout"]];
  phones.forEach(([p, alt], i) => {
    const x = x0 + DW + G + i * (PW + G);
    box(s, x - 0.08, y - 0.08, PW + 0.16, H + 0.16, { fill: "111827", line: null, r: 0.16 });
    s.addImage({ path: p, x, y, w: PW, h: H, altText: alt });
  });
  const caps = [
    [x0, DW, "Ordinateur · thème clair"],
    [x0 + DW + G - 0.12, PW + 0.24, "Mobile · thème sombre"],
    [x0 + DW + 2 * G + PW - 0.12, PW + 0.24, "Chat secret chiffré"],
  ];
  caps.forEach(([x, w, t], i) => {
    box(s, x, 6.05, w, 0.42, { fill: i === 2 ? AL : PL, line: null, r: 0.2 });
    txt(s, t, x, 6.05, w, 0.42, { fontSize: 13, bold: true, color: i === 2 ? A : PD, align: "center", valign: "middle" });
  });
  txt(s, "Captures réelles de Relay, prises en local (interface en anglais)", 0.6, 6.58, 12.13, 0.3, { fontSize: 12, italic: true, color: MU, align: "center" });
  s.addNotes(
    "Voici l'application réelle. À gauche, la version ordinateur en thème clair : la liste des conversations, puis la discussion avec les réactions et les accusés de lecture. " +
    "Au centre, la même conversation sur mobile en thème sombre, et à droite un chat secret : le bandeau vert indique que seuls les deux appareils peuvent lire les messages. " +
    "Ce sont de vraies captures de l'application, dont l'interface est en anglais.",
  );
}

// =====================================================================
// 8. Analyse des besoins
// =====================================================================
{
  pres.addSection({ title: "Analyse et conception" });
  const s = newSlide("Analyse des besoins", "Analyse et conception");
  const cols = [
    ["FaListCheck", "Besoins fonctionnels", [
      ["FaKey", "S'authentifier", "inscription, connexion, 2FA"],
      ["FaComments", "Échanger", "messages, photos, notes vocales en direct"],
      ["FaVideo", "Appeler", "audio et vidéo, partage d'écran"],
      ["FaUsers", "S'organiser", "groupes, demandes de contact, blocage"],
      ["FaUserShield", "Modérer", "comptes, signalements, journal d'audit"],
    ]],
    ["FaGaugeHigh", "Besoins non fonctionnels", [
      ["FaLock", "Sécurité", "chiffrement E2EE, PBKDF2, en-têtes CSP"],
      ["FaBolt", "Performance", "WebSocket, chargement à la demande"],
      ["FaServer", "Disponibilité", "Cloudflare sans mise en veille, 0 €"],
      ["FaMobileScreen", "Portabilité", "PWA installable, mobile, hors ligne"],
      ["FaCode", "Maintenabilité", "TypeScript, 55 tests E2E, CI"],
    ]],
  ];
  for (let c = 0; c < 2; c++) {
    const [hic, title, items] = cols[c];
    const x = 0.6 + c * 6.17, w = 5.96;
    box(s, x, 1.3, w, 0.7, { fill: c === 0 ? P : PD, line: null });
    await iconCircle(s, hic, x + 0.15, 1.38, 0.54, WH, c === 0 ? P : PD);
    txt(s, title, x + 0.85, 1.3, w - 1, 0.7, { fontSize: 19, bold: true, color: WH, valign: "middle" });
    for (let i = 0; i < items.length; i++) {
      const [ic, k, d] = items[i];
      const y = 2.2 + i * 0.9;
      box(s, x, y, w, 0.75, { fill: i % 2 ? WH : PL, line: i % 2 ? PB : null });
      await iconCircle(s, ic, x + 0.15, y + 0.13, 0.5, c === 0 ? P : PD);
      txt(s, [
        { text: k + " : ", options: { bold: true, color: PD } },
        { text: d, options: { color: TX } },
      ], x + 0.8, y, w - 0.95, 0.75, { fontSize: 15, valign: "middle" });
    }
  }
  s.addNotes(
    "L'analyse des besoins distingue deux familles. Les besoins fonctionnels décrivent ce que l'utilisateur peut faire : s'authentifier, échanger, appeler, s'organiser en groupes et modérer. " +
    "Les besoins non fonctionnels décrivent la qualité attendue : la sécurité, la performance du temps réel, la disponibilité sans coût, la portabilité sur mobile et la maintenabilité grâce à TypeScript et aux tests automatisés.",
  );
}

// =====================================================================
// 9. Cas d'utilisation
// =====================================================================
{
  const s = newSlide("Diagramme de cas d'utilisation", "Analyse et conception");
  box(s, 2.35, 1.25, 8.6, 5.35, { fill: "FAFAFF", line: P, lw: 1.5, r: 0.05 });
  txt(s, "Système Relay", 2.5, 1.3, 3, 0.3, { fontSize: 12, bold: true, color: P });
  const uc = (x, y, label) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: 3.6, h: 0.52, fill: { color: WH }, line: { color: P, width: 1.25 } });
    txt(s, label, x + 0.2, y, 3.2, 0.52, { fontSize: 12, align: "center", valign: "middle", color: PD });
    return { x, y, l: x, r: x + 3.6, cy: y + 0.26 };
  };
  const L = ["S'inscrire", "Se connecter (2FA)", "Envoyer messages et médias", "Passer un appel audio/vidéo", "Créer et gérer un groupe", "Démarrer un chat secret", "Bloquer / signaler", "Personnaliser, Chill et jeux"]
    .map((t, i) => uc(2.6, 1.68 + i * 0.6, t));
  const R = [
    ["Gérer les administrateurs", 1.68], ["Lire les chats non secrets", 2.28], ["Piloter le site (maintenance)", 2.88],
    ["Gérer les comptes", 4.68], ["Traiter les signalements", 5.28], ["Consulter le journal d'audit", 5.88],
  ].map(([t, y]) => uc(7.1, y, t));
  actor(s, 1.2, 1.55, "Visiteur");
  actor(s, 1.2, 3.75, "Utilisateur");
  actor(s, 12.1, 1.5, "Propriétaire");
  actor(s, 12.1, 4.55, "Administrateur");
  const ln = { color: MU, w: 1 };
  L.slice(0, 2).forEach((u) => line(s, 1.55, 2.0, u.l, u.cy, ln));
  L.slice(2).forEach((u) => line(s, 1.55, 4.2, u.l, u.cy, ln));
  R.slice(0, 3).forEach((u) => line(s, 11.75, 1.95, u.r, u.cy, ln));
  R.slice(3).forEach((u) => line(s, 11.75, 5.0, u.r, u.cy, ln));
  // Généralisations : Propriétaire → Administrateur → Utilisateur
  line(s, 12.1, 2.88, 12.1, 4.55, { color: PD, w: 1.5, end: "triangle" });
  poly(s, [[12.1, 5.95], [12.1, 6.8], [0.6, 6.8], [0.6, 4.6], [0.88, 4.6]], { color: PD, w: 1.5, end: "triangle" });
  txt(s, "« hérite de »", 11.15, 3.55, 0.95, 0.3, { fontSize: 12, color: PD, italic: true, align: "right" });
  s.addNotes(
    "Ce diagramme montre les quatre acteurs réels de l'application. Le visiteur peut s'inscrire et se connecter ; l'utilisateur connecté envoie des messages, appelle, gère ses groupes, démarre un chat secret ou signale un abus. " +
    "L'administrateur hérite des droits de l'utilisateur et gère les comptes, les signalements et le journal d'audit. " +
    "Le propriétaire hérite de l'administrateur : il gère aussi les administrateurs, pilote le site et peut relire les conversations non secrètes, mais jamais les chats secrets.",
  );
}

// =====================================================================
// 10. Description d'un cas d'utilisation
// =====================================================================
{
  const s = newSlide("Description du cas « Envoyer un message »", "Analyse et conception");
  const card = (y, h, title, lines) => {
    box(s, 0.6, y, 4.3, h, { fill: PL, line: null });
    txt(s, title, 0.85, y + 0.12, 3.9, 0.35, { fontSize: 15, bold: true, color: P });
    txt(s, lines.map((l, i) => ({ text: l, options: { bullet: lines.length > 1, breakLine: i < lines.length - 1 } })), 0.85, y + 0.5, 3.85, h - 0.6, { fontSize: 14, paraSpaceAfter: 3 });
  };
  card(1.3, 0.95, "Acteur principal", ["Utilisateur connecté"]);
  card(2.45, 1.75, "Préconditions", ["Membre de la conversation", "Demande de contact acceptée", "Aucun blocage entre les deux"]);
  card(4.4, 1.95, "Postconditions", ["Message enregistré dans D1", "Diffusé en direct aux membres", "Liste et notifications mises à jour"]);
  // Scénario nominal
  txt(s, "Scénario nominal", 5.25, 1.3, 7.4, 0.4, { fontSize: 17, bold: true, color: PD });
  const steps = [
    "L'utilisateur saisit son message et l'envoie",
    "Le navigateur le transmet par WebSocket",
    "Le serveur vérifie les droits (demande, blocage, mode lent)",
    "Le message est enregistré dans la base D1",
    "Il est diffusé aux membres, qui sont notifiés",
  ];
  steps.forEach((t, i) => {
    const y = 1.8 + i * 0.5;
    numCircle(s, i + 1, 5.25, y + 0.04, 0.36, P, 13);
    txt(s, t, 5.8, y, 6.9, 0.44, { fontSize: 15, valign: "middle" });
  });
  txt(s, "Scénarios alternatifs", 5.25, 4.4, 7.4, 0.4, { fontSize: 17, bold: true, color: PD });
  const alts = [
    ["A1", "Demande non acceptée ou blocage : envoi refusé"],
    ["A2", "Mode lent ou groupe « annonces » : refus avec la raison"],
    ["A3", "Hors connexion : message mis en attente, envoyé à la reconnexion"],
  ];
  alts.forEach(([k, t], i) => {
    const y = 4.9 + i * 0.5;
    box(s, 5.25, y + 0.05, 0.55, 0.34, { fill: AL, line: A, r: 0.15 });
    txt(s, k, 5.25, y + 0.05, 0.55, 0.34, { fontSize: 12, bold: true, color: A, align: "center", valign: "middle" });
    txt(s, t, 5.95, y, 6.75, 0.44, { fontSize: 15, valign: "middle" });
  });
  s.addNotes(
    "Nous avons décrit en détail le cas d'utilisation le plus important : envoyer un message. L'acteur est un utilisateur connecté, membre de la conversation, dont la demande de contact a été acceptée et qui n'est pas bloqué. " +
    "Dans le scénario nominal, le message part par WebSocket, le serveur vérifie les droits, l'enregistre dans D1 puis le diffuse. " +
    "Trois cas alternatifs existent : le refus en cas de blocage, le mode lent ou les groupes d'annonces, et l'envoi différé quand l'utilisateur est hors ligne.",
  );
}

// =====================================================================
// 11. Diagramme de classes
// =====================================================================
{
  const s = newSlide("Diagramme de classes (simplifié)", "Analyse et conception");
  const W = 2.6, GX = (12.13 - 4 * W) / 3, X = [0, 1, 2, 3].map((i) => 0.6 + i * (W + GX)), Y = [1.2, 3.25, 5.15];
  const cls = (c, r, name, attrs) => {
    const x = X[c], y = Y[r], h = 0.36 + attrs.length * 0.22 + 0.1;
    box(s, x, y, W, h, { fill: WH, line: P, lw: 1.25, round: false });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: W, h: 0.36, fill: { color: P }, line: { color: P, width: 1.25 } });
    txt(s, name, x, y, W, 0.36, { fontSize: 13, bold: true, color: WH, align: "center", valign: "middle" });
    txt(s, attrs.map((a, i) => ({ text: a, options: { breakLine: i < attrs.length - 1 } })), x + 0.12, y + 0.41, W - 0.2, attrs.length * 0.22, { fontSize: 12, color: TX, lineSpacing: 15.8 });
    return { cx: x + W / 2, cy: y + h / 2, w: W, h, x, y, r: x + W, b: y + h };
  };
  const user = cls(1, 0, "User", ["id, username", "display_name", "role (user | admin)", "super_admin", "suspended_until"]);
  const sess = cls(0, 0, "Session", ["token_hash", "user_id", "device", "expires_at"]);
  const block = cls(2, 0, "Block", ["blocker_id", "blocked_id", "created_at"]);
  const report = cls(0, 1, "Report", ["id, reporter_id", "reason", "status"]);
  const member = cls(1, 1, "RoomMember", ["room_id, user_id", "role (member | admin)", "last_read_at", "archived"]);
  const msg = cls(2, 1, "Message", ["id, room_id, user_id", "kind, body", "reply_to_id", "created_at", "expires_at"]);
  const react = cls(3, 1, "MessageReaction", ["message_id", "user_id", "emoji"]);
  const room = cls(1, 2, "Room", ["id, type (dm | group)", "name, status", "theme", "disappear_ms"]);
  const key = cls(0, 2, "SecretKey", ["room_id, user_id", "public_key"]);
  const lk = { color: PD, w: 1.25 };
  const lab = (x, y, t) => txt(s, t, x - 0.25, y - 0.14, 0.5, 0.28, { fontSize: 12, bold: true, color: A, align: "center", valign: "middle" });
  const d = 0.17;
  poly(s, [[user.x, 1.75], [sess.r, 1.75]], lk); lab(user.x - d, 1.75 - d, "1"); lab(sess.r + d, 1.75 + d, "*");
  poly(s, [[user.r, 1.75], [block.x, 1.75]], lk); lab(user.r + d, 1.75 - d, "1"); lab(block.x - d, 1.75 + d, "*");
  poly(s, [[user.cx, user.b], [user.cx, member.y]], lk); lab(user.cx - d, user.b + 0.12, "1"); lab(user.cx + d, member.y - 0.12, "*");
  const yb = (user.b + member.y) / 2 + 0.02;
  poly(s, [[user.x + 0.3, user.b], [user.x + 0.3, yb], [report.cx, yb], [report.cx, report.y]], lk);
  lab(user.x + 0.3 - d, user.b + 0.1, "1"); lab(report.cx + d, report.y - 0.12, "*");
  poly(s, [[user.r - 0.3, user.b], [user.r - 0.3, yb], [msg.cx, yb], [msg.cx, msg.y]], lk);
  lab(user.r - 0.3 + d, user.b + 0.1, "1"); lab(msg.cx + d, msg.y - 0.12, "*");
  txt(s, "écrit", (user.r - 0.3 + msg.cx) / 2 - 0.5, yb - 0.3, 1.0, 0.26, { fontSize: 12, italic: true, color: MU, align: "center", valign: "middle" });
  poly(s, [[room.cx, member.b], [room.cx, room.y]], lk); lab(room.cx - d, member.b + 0.12, "*"); lab(room.cx + d, room.y - 0.12, "1");
  const yr = msg.y + 0.65;
  poly(s, [[msg.r, yr], [react.x, yr]], lk); lab(msg.r + d, yr - d, "1"); lab(react.x - d, yr + d, "*");
  const yk = room.y + 0.5;
  poly(s, [[room.x, yk], [key.r, yk]], lk); lab(room.x - d, yk - d, "1"); lab(key.r + 0.27, yk + d, "0..2");
  poly(s, [[room.r, yk], [msg.cx, yk], [msg.cx, msg.b]], lk); lab(room.r + d, yk - d, "1"); lab(msg.cx + d, msg.b + 0.12, "*");
  box(s, X[3], Y[2], W, 1.45, { fill: PL, line: null });
  txt(s, [
    { text: "Base Cloudflare D1 (SQLite)", options: { bold: true, color: PD, breakLine: true } },
    { text: "9 tables principales sur 27", options: { color: MU, breakLine: true } },
    { text: "Multiplicités en orange", options: { color: A } },
  ], X[3] + 0.15, Y[2], W - 0.3, 1.45, { fontSize: 13, valign: "middle" });
  s.addNotes(
    "Ce diagramme simplifié reprend les tables réelles de la base D1. Un utilisateur possède plusieurs sessions, participe à des conversations via la table RoomMember, et écrit des messages. " +
    "Une conversation, appelée Room, est soit privée soit un groupe ; chaque message peut recevoir des réactions. " +
    "On retrouve aussi le blocage, les signalements, et les clés publiques des chats secrets, au maximum deux par conversation.",
  );
}

// =====================================================================
// 12. Diagramme de séquence : envoyer un message
// =====================================================================
{
  const s = newSlide("Diagramme de séquence : envoyer un message", "Analyse et conception");
  const lanes = ["Utilisateur A", "Navigateur A", "Worker", "DO ChatRoom", "D1", "DO Lobby", "Navigateur B"];
  const LX = lanes.map((_, i) => 1.4 + (i * (11.93 - 1.4)) / 6);
  const HW = 1.55, Y0 = 1.2, YEND = 6.42;
  lanes.forEach((t, i) => {
    line(s, LX[i], Y0 + 0.5, LX[i], YEND, { color: "9CA3AF", w: 1, dash: "dash" });
    box(s, LX[i] - HW / 2, Y0, HW, 0.5, { fill: i === 0 ? PD : i === 3 ? AL : PL, line: i === 0 ? null : i === 3 ? A : P, r: 0.06 });
    txt(s, t, LX[i] - HW / 2, Y0, HW, 0.5, { fontSize: 13, bold: true, color: i === 0 ? WH : i === 3 ? A : PD, align: "center", valign: "middle" });
  });
  // Barre d'activation du Durable Object
  s.addShape(pres.shapes.RECTANGLE, { x: LX[3] - 0.07, y: 3.62, w: 0.14, h: 2.36, fill: { color: AL }, line: { color: A, width: 1 } });
  const label = (t, cx, y, o = {}) => {
    const w = Math.max(...t.split("\n").map((l) => l.length)) * 0.083 + 0.25;
    const h = t.includes("\n") ? 0.44 : 0.26;
    txt(s, t, o.left ? cx : cx - w / 2, y, w, h, { fontSize: 12, color: o.color ?? TX, align: o.left ? "left" : "center", valign: "middle", fill: { color: WH } });
  };
  const msgArrow = (a, b, y, t, o = {}) => {
    const off = (i) => (i === 3 ? 0.07 : 0);
    const x1 = LX[a] + (b > a ? off(a) : -off(a)), x2 = LX[b] + (b > a ? -off(b) : off(b));
    line(s, x1, y, x2, y, { color: o.ret ? MU : PD, w: 1.25, dash: o.ret ? "dash" : "solid", end: "triangle" });
    label(t, (x1 + x2) / 2, y - 0.29, { color: o.ret ? MU : TX });
  };
  const self = (i, y, t) => {
    const x = LX[i] + (i === 3 ? 0.07 : 0);
    poly(s, [[x, y], [x + 0.35, y], [x + 0.35, y + 0.25], [x + 0.02, y + 0.25]], { color: PD, w: 1.25, end: "triangle" });
    label(t, x + 0.45, y - 0.1, { left: true });
  };
  msgArrow(1, 2, 2.05, "1. Connexion WSS");
  self(2, 2.3, "2. Vérifie session\net appartenance");
  msgArrow(2, 3, 3.0, "3. Relaie le WebSocket");
  msgArrow(0, 1, 3.35, "4. Saisit et envoie");
  msgArrow(1, 3, 3.7, "5. send (WebSocket)");
  self(3, 3.95, "6. Vérifie demande,\nblocage, mode lent");
  msgArrow(3, 4, 4.6, "7. INSERT message");
  msgArrow(4, 3, 4.92, "8. OK", { ret: true });
  msgArrow(3, 6, 5.27, "9. message (diffusion)");
  msgArrow(3, 1, 5.6, "10. message (accusé)");
  msgArrow(3, 5, 5.93, "11. notify(membres)");
  msgArrow(5, 6, 6.26, "12. liste + alerte");
  txt(s, "Si un destinataire est hors ligne : notification Web Push, sans le contenu du message", 0.6, 6.55, 12.13, 0.3, { fontSize: 12, italic: true, color: MU, align: "center" });
  s.addNotes(
    "Ce diagramme de séquence montre le trajet réel d'un message. À l'ouverture de la conversation, le Worker vérifie la session et l'appartenance, puis relaie le WebSocket vers le Durable Object de la conversation. " +
    "Quand l'utilisateur envoie un message, le Durable Object vérifie les droits, l'enregistre dans D1, puis le diffuse à tous les membres connectés, y compris l'expéditeur comme accusé. " +
    "Il prévient enfin le Lobby, qui met à jour la liste des conversations et affiche une alerte ; les personnes hors ligne reçoivent une notification push sans le contenu.",
  );
}

// =====================================================================
// 13. Diagramme d'activité : se connecter
// =====================================================================
{
  const s = newSlide("Diagramme d'activité : se connecter", "Analyse et conception");
  const YM = 2.6, DS = 0.6;
  const action = (x, y, w, t, o = {}) => {
    box(s, x, y, w, 0.8, { fill: o.fill ?? PL, line: o.line ?? P, r: 0.15 });
    txt(s, t, x + 0.06, y, w - 0.12, 0.8, { fontSize: 12, color: o.color ?? PD, align: "center", valign: "middle", bold: !!o.bold });
    return { x, y, w, r: x + w, b: y + 0.8, cx: x + w / 2, cy: y + 0.4 };
  };
  const diamond = (cx, cy, q, qpos = "top") => {
    s.addShape(pres.shapes.DIAMOND, { x: cx - DS / 2, y: cy - DS / 2, w: DS, h: DS, fill: { color: WH }, line: { color: PD, width: 1.5 } });
    if (qpos === "top") txt(s, q, cx - 0.72, cy - DS / 2 - 0.62, 1.44, 0.55, { fontSize: 12, bold: true, color: PD, align: "center", valign: "bottom" });
    else txt(s, q, cx + DS / 2 + 0.1, cy - 0.2, 1.4, 0.4, { fontSize: 12, bold: true, color: PD, valign: "middle" });
  };
  const final = (cx, cy) => {
    s.addShape(pres.shapes.OVAL, { x: cx - 0.18, y: cy - 0.18, w: 0.36, h: 0.36, fill: { color: WH }, line: { color: PD, width: 1.5 } });
    s.addShape(pres.shapes.OVAL, { x: cx - 0.11, y: cy - 0.11, w: 0.22, h: 0.22, fill: { color: PD }, line: { type: "none" } });
  };
  const guard = (t, x, y, w = 0.55, align = "center") => txt(s, t, x, y, w, 0.26, { fontSize: 12, italic: true, color: MU, align, valign: "middle" });
  const ar = { color: PD, w: 1.25, end: "triangle" };
  // Chemin principal
  s.addShape(pres.shapes.OVAL, { x: 0.75, y: YM - 0.15, w: 0.3, h: 0.3, fill: { color: PD }, line: { type: "none" } });
  const a1 = action(1.45, YM - 0.4, 1.85, "Saisir identifiant et mot de passe");
  const D = [4.05, 5.6, 7.15, 8.7];
  diamond(D[0], YM, "Tentatives autorisées ?");
  diamond(D[1], YM, "Mot de passe correct ?");
  diamond(D[2], YM, "Compte actif ?");
  diamond(D[3], YM, "2FA activée ?");
  const a2 = action(9.55, YM - 0.4, 2.25, "Créer la session et alerter les autres appareils", { fill: AL, line: A, color: A, bold: true });
  final(12.33, YM);
  line(s, 1.05, YM, a1.x, YM, ar);
  line(s, a1.r, YM, D[0] - DS / 2, YM, ar);
  for (let i = 0; i < 3; i++) {
    line(s, D[i] + DS / 2, YM, D[i + 1] - DS / 2, YM, ar);
    guard("[oui]", (D[i] + D[i + 1]) / 2 - 0.28, YM - 0.3);
  }
  line(s, D[3] + DS / 2, YM, a2.x, YM, ar);
  guard("[non]", D[3] + DS / 2 - 0.02, YM - 0.3);
  line(s, a2.r, YM, 12.15, YM, ar);
  // Branches d'erreur
  const YE = 3.7;
  const errs = ["Erreur 429 : réessayer plus tard", "Erreur : identifiants incorrects", "Refus : compte suspendu (motif)"];
  errs.forEach((t, i) => {
    const e = action(D[i] - 0.65, YE, 1.3, t, { fill: GR, line: MU, color: TX });
    line(s, D[i], YM + DS / 2, D[i], YE, ar);
    guard("[non]", D[i] + 0.05, 3.15, 0.55, "left");
    line(s, D[i], e.b, D[i], 4.92, ar);
    final(D[i], 5.1);
  });
  // Deuxième facteur
  const c1 = action(8.0, YE, 1.4, "Saisir le code (TOTP ou secours)");
  line(s, D[3], YM + DS / 2, D[3], YE, ar);
  guard("[oui]", D[3] + 0.05, 3.15, 0.55, "left");
  const D5 = { cx: 10.15, cy: YE + 0.4 };
  diamond(D5.cx, D5.cy, "Code valide ?", "right");
  line(s, c1.r, D5.cy, D5.cx - DS / 2, D5.cy, ar);
  line(s, D5.cx, D5.cy - DS / 2, D5.cx, a2.b, ar);
  guard("[oui]", D5.cx - 0.6, 3.2, 0.55, "right");
  poly(s, [[D5.cx, D5.cy + DS / 2], [D5.cx, 5.0], [c1.cx, 5.0], [c1.cx, c1.b]], ar);
  txt(s, "[non] nouvel essai (5 au maximum, puis mot de passe)", 7.45, 5.06, 4.1, 0.28, { fontSize: 12, italic: true, color: MU, align: "center", valign: "middle" });
  // Règles
  box(s, 0.6, 5.75, 12.13, 0.95, { fill: PL, line: null });
  txt(s, [
    { text: "Règles du code : ", options: { bold: true, color: PD } },
    { text: "20 essais par IP et 10 par compte toutes les 15 min · mot de passe toujours vérifié (même durée, compte existant ou non) · code TOTP non rejouable · session stockée sous forme de hachage SHA-256", options: { color: TX } },
  ], 0.85, 5.75, 11.65, 0.95, { fontSize: 13, valign: "middle" });
  s.addNotes(
    "Ce diagramme d'activité décrit la connexion telle qu'elle est codée. L'utilisateur saisit ses identifiants ; le serveur vérifie d'abord la limite de tentatives, puis le mot de passe, puis que le compte n'est pas suspendu. " +
    "Si la double authentification est activée, l'utilisateur saisit un code TOTP ou un code de secours ; après cinq erreurs, il doit recommencer avec son mot de passe. " +
    "Une fois connecté, la session est créée et ses autres appareils reçoivent une alerte de nouvelle connexion.",
  );
}

// =====================================================================
// 14. Architecture
// =====================================================================
{
  pres.addSection({ title: "Architecture et sécurité" });
  const s = newSlide("Architecture de l'application", "Architecture et sécurité");
  const comp = (x, y, w, h, title, lines, o = {}) => {
    box(s, x, y, w, h, { fill: o.fill ?? WH, line: o.line ?? P, lw: 1.5 });
    txt(s, title, x + 0.15, y + 0.1, w - 0.3, 0.38, { fontSize: 15, bold: true, color: o.tc ?? PD });
    txt(s, lines.map((l, i) => ({ text: l, options: { bullet: true, breakLine: i < lines.length - 1 } })), x + 0.15, y + 0.5, w - 0.3, h - 0.55, { fontSize: 12, paraSpaceAfter: 2 });
    return { cx: x + w / 2, cy: y + h / 2, w, h, x, y };
  };
  comp(0.6, 1.5, 3.0, 2.2, "Navigateur (client)", ["React 19 + Tailwind", "PWA : Service Worker, IndexedDB", "WebRTC, WebCrypto (E2EE)"], { fill: PL, line: P });
  comp(0.6, 5.0, 3.0, 1.5, "Autre utilisateur", ["Même application React", "Appel en pair à pair"], { fill: PL, line: P });
  comp(5.05, 1.5, 3.4, 2.2, "Cloudflare Worker", ["API REST /api/*", "Sessions et contrôle d'accès", "Sert l'application React", "Cron : toutes les 15 min"], { fill: WH, line: A, tc: A });
  const room = comp(4.85, 4.55, 1.8, 1.95, "DO ChatRoom", ["1 par conversation", "WebSocket + médias"]);
  const lobby = comp(6.85, 4.55, 1.8, 1.95, "DO Lobby", ["Présence", "Notifications"]);
  comp(9.75, 1.5, 2.98, 1.55, "Cloudflare D1", ["SQLite : 27 tables", "users, rooms, messages…"]);
  comp(9.75, 3.3, 2.98, 1.3, "Workers AI", ["Whisper, traduction"]);
  comp(9.75, 4.85, 2.98, 1.65, "APIs externes", ["YouTube, iTunes", "Radio Browser, Web Push"], { line: MU });
  line(s, 3.6, 2.25, 5.05, 2.25, { color: P, w: 1.75, end: "triangle", begin: "triangle" });
  txt(s, "HTTPS /api/*", 3.65, 1.9, 1.4, 0.3, { fontSize: 12, color: P, bold: true, align: "center" });
  line(s, 3.6, 3.05, 5.05, 3.05, { color: P, w: 1.75, end: "triangle", begin: "triangle" });
  txt(s, "WSS", 3.65, 3.1, 1.4, 0.3, { fontSize: 12, color: P, bold: true, align: "center" });
  line(s, room.cx, 3.7, room.cx, 4.55, { color: P, w: 1.5, end: "triangle" });
  line(s, lobby.cx, 3.7, lobby.cx, 4.55, { color: P, w: 1.5, end: "triangle" });
  line(s, 8.45, 2.27, 9.75, 2.27, { color: P, w: 1.5, end: "triangle" });
  txt(s, "SQL", 8.5, 1.92, 1.2, 0.3, { fontSize: 12, color: P, bold: true, align: "center" });
  line(s, 8.45, 3.25, 9.75, 3.95, { color: P, w: 1.5, end: "triangle" });
  line(s, 8.45, 3.6, 9.75, 5.65, { color: MU, w: 1.5, end: "triangle", dash: "dash" });
  txt(s, "fetch", 9.2, 4.2, 0.7, 0.3, { fontSize: 12, color: MU, bold: true });
  line(s, 2.1, 3.7, 2.1, 5.0, { color: A, w: 2, dash: "dash", end: "triangle", begin: "triangle" });
  txt(s, "WebRTC P2P (DTLS-SRTP)\nSTUN / TURN Cloudflare", 2.25, 4.05, 2.5, 0.65, { fontSize: 12, color: A, bold: true });
  s.addNotes(
    "Le navigateur charge l'application React servie par le Worker Cloudflare, puis communique avec lui en HTTPS pour l'API et en WebSocket pour le temps réel. " +
    "Le Worker vérifie la session et les droits, puis transmet les connexions à un Durable Object ChatRoom par conversation, et au Lobby pour la présence. " +
    "Les données sont dans D1, l'IA passe par Workers AI, et les appels audio-vidéo circulent directement entre les deux navigateurs grâce à WebRTC.",
  );
}

// =====================================================================
// 15. Technologies
// =====================================================================
{
  const s = newSlide("Technologies utilisées", "Architecture et sécurité");
  const G = [
    ["FaCode", "Frontend", ["React 19", "TypeScript", "Tailwind CSS 4", "Vite 8", "WebRTC", "WebCrypto", "PWA / Service Worker", "IndexedDB"]],
    ["FaServer", "Backend", ["Cloudflare Workers", "Durable Objects", "WebSocket (Hibernation)", "Workers AI", "Web Push", "Cron Triggers"]],
    ["FaDatabase", "Base de données", ["Cloudflare D1 (SQLite)", "SQLite des Durable Objects", "15 migrations SQL"]],
    ["FaRocket", "Outils & Déploiement", ["Git & GitHub", "GitHub Actions (CI)", "Playwright (tests E2E)", "Wrangler", "Cloudflare workers.dev"]],
  ];
  for (let i = 0; i < 4; i++) {
    const [ic, t, items] = G[i];
    const x = 0.6 + i * 3.08;
    box(s, x, 1.35, 2.87, 5.45, { fill: PL, line: null });
    await iconCircle(s, ic, x + 0.25, 1.55, 0.6, P);
    txt(s, t, x + 0.95, 1.55, 1.85, 0.6, { fontSize: 17, bold: true, color: PD, valign: "middle" });
    items.forEach((it, j) => {
      const y = 2.4 + j * 0.53;
      box(s, x + 0.22, y, 2.43, 0.42, { fill: WH, line: P, r: 0.2 });
      txt(s, it, x + 0.22, y, 2.43, 0.42, { fontSize: 13, color: PD, align: "center", valign: "middle", bold: true });
    });
  }
  s.addNotes(
    "Côté frontend, nous avons utilisé React 19 avec TypeScript, Tailwind CSS et Vite, ainsi que les API du navigateur WebRTC et WebCrypto. " +
    "Le backend tourne sur Cloudflare Workers, avec les Durable Objects pour les WebSockets et Workers AI pour la transcription et la traduction. " +
    "Les données sont dans Cloudflare D1, une base SQLite, et la qualité est assurée par Playwright et GitHub Actions avant le déploiement avec Wrangler.",
  );
}

// =====================================================================
// 16. Chats secrets : chiffrement de bout en bout
// =====================================================================
{
  const s = newSlide("Chats secrets : chiffrement de bout en bout", "Architecture et sécurité");
  const CW = 3.2, XA = 0.6, XS = 0.6 + (12.13 - CW) / 2, XB = 12.73 - CW;
  const head = (x, t, c) => {
    box(s, x, 1.3, CW, 0.55, { fill: c, line: null });
    txt(s, t, x, 1.3, CW, 0.55, { fontSize: 16, bold: true, color: WH, align: "center", valign: "middle" });
  };
  head(XA, "Appareil A", P);
  head(XS, "Serveur Relay", MU);
  head(XB, "Appareil B", P);
  const step = (x, y, t, o = {}) => {
    box(s, x, y, CW, 0.9, { fill: o.fill ?? PL, line: o.line ?? null, dash: o.dash });
    txt(s, t, x + 0.15, y, CW - 0.3, 0.9, { fontSize: 13, color: o.color ?? TX, align: "center", valign: "middle", bold: !!o.bold });
  };
  const R1 = 2.1, R2 = 3.3, R3 = 4.5;
  step(XA, R1, "1. Génère une paire de clés ECDH P-256 (clé privée non extractible)");
  step(XB, R1, "1. Génère une paire de clés ECDH P-256 (clé privée non extractible)");
  step(XS, R1, "Stocke et transmet les clés publiques (table secret_keys)", { fill: GR });
  const derive = "2. ECDH + HKDF-SHA256\nclé AES-256 commune";
  step(XA, R2, derive, { fill: AL, line: A, color: A, bold: true });
  step(XB, R2, derive, { fill: AL, line: A, color: A, bold: true });
  step(XS, R2, "Ne connaît jamais la clé de chiffrement", { fill: WH, line: MU, dash: "dash", color: MU });
  step(XA, R3, "3. Chiffre le message (AES-256-GCM, lié à l'expéditeur)");
  step(XB, R3, "4. Déchiffre le message sur l'appareil");
  step(XS, R3, "Stocke uniquement le texte chiffré, refuse le texte en clair", { fill: GR });
  // Flèches
  const gx1 = XA + CW, gx2 = XS, gx3 = XS + CW, gx4 = XB;
  line(s, gx1, R1 + 0.45, gx2, R1 + 0.45, { color: PD, w: 1.5, end: "triangle", begin: "triangle" });
  line(s, gx3, R1 + 0.45, gx4, R1 + 0.45, { color: PD, w: 1.5, end: "triangle", begin: "triangle" });
  txt(s, "clés publiques", gx1, R1 + 0.1, gx2 - gx1, 0.3, { fontSize: 12, color: PD, align: "center" });
  txt(s, "clés publiques", gx3, R1 + 0.1, gx4 - gx3, 0.3, { fontSize: 12, color: PD, align: "center" });
  line(s, gx1, R3 + 0.45, gx2, R3 + 0.45, { color: A, w: 2, end: "triangle" });
  line(s, gx3, R3 + 0.45, gx4, R3 + 0.45, { color: A, w: 2, end: "triangle" });
  txt(s, "texte chiffré", gx1, R3 + 0.1, gx2 - gx1, 0.3, { fontSize: 12, color: A, bold: true, align: "center" });
  txt(s, "texte chiffré", gx3, R3 + 0.1, gx4 - gx3, 0.3, { fontSize: 12, color: A, bold: true, align: "center" });
  for (const x of [XA, XB]) {
    line(s, x + CW / 2, R1 + 0.9, x + CW / 2, R2, { color: PD, w: 1.25, end: "triangle" });
    line(s, x + CW / 2, R2 + 0.9, x + CW / 2, R3, { color: PD, w: 1.25, end: "triangle" });
  }
  // Garanties supplémentaires
  const extras = [
    ["FaFingerprint", "Empreinte de 8 émojis", "à comparer contre l'interception"],
    ["FaImage", "Photos chiffrées", "taille masquée par remplissage"],
    ["FaTrashCan", "Fin du chat secret", "messages effacés, clés détruites"],
  ];
  for (let i = 0; i < 3; i++) {
    const [ic, t, d] = extras[i];
    const x = 0.6 + i * 4.11;
    box(s, x, 5.7, 3.91, 1.0, { fill: WH, line: PB });
    await iconCircle(s, ic, x + 0.18, 5.88, 0.64, P);
    txt(s, t, x + 1.0, 5.78, 2.8, 0.4, { fontSize: 15, bold: true, color: PD, valign: "middle" });
    txt(s, d, x + 1.0, 6.18, 2.8, 0.4, { fontSize: 13, color: MU, valign: "middle" });
  }
  s.addNotes(
    "Voici comment fonctionnent les chats secrets. Chaque appareil génère sa propre paire de clés ECDH ; la clé privée est non extractible et ne quitte jamais l'appareil. Le serveur ne fait que transmettre les clés publiques. " +
    "Chaque appareil calcule alors la même clé AES-256 grâce à ECDH et HKDF, sans que le serveur la connaisse. Les messages sont chiffrés avant l'envoi, et le serveur refuse tout texte en clair dans un chat secret. " +
    "Une empreinte de huit émojis permet de vérifier qu'il n'y a pas d'interception, et terminer le chat efface les messages et détruit les clés.",
  );
}

// =====================================================================
// 17. Scrum
// =====================================================================
{
  pres.addSection({ title: "Gestion de projet" });
  const s = newSlide("Méthodologie Agile : Scrum", "Gestion de projet");
  const roles = [
    ["FaUserTie", "Product Owner", AUTHOR, "Priorise le backlog"],
    ["FaRotate", "Scrum Master", PARTNER, "Anime les cérémonies"],
    ["FaPeopleGroup", "Équipe de développement", "Le binôme (full-stack)", "Développe et teste"],
  ];
  for (let i = 0; i < 3; i++) {
    const [ic, r, who, d] = roles[i];
    const y = 1.35 + i * 1.45;
    box(s, 0.6, y, 5.1, 1.25, { fill: PL, line: null });
    await iconCircle(s, ic, 0.8, y + 0.25, 0.75, P);
    txt(s, r, 1.75, y + 0.12, 3.85, 0.38, { fontSize: 17, bold: true, color: PD });
    txt(s, who, 1.75, y + 0.5, 3.85, 0.32, { fontSize: 14, color: TX });
    txt(s, d, 1.75, y + 0.83, 3.85, 0.3, { fontSize: 13, color: MU, italic: true });
  }
  txt(s, `3 sprints de 2 jours · ${bd.total} story points`, 0.6, 5.85, 5.1, 0.45, { fontSize: 17, bold: true, color: A });
  const cx = 9.4, cy = 4.15, rx = 2.38, ry = 1.95, bw = 2.05, bh = 0.62;
  const steps = ["Backlog produit", "Sprint planning", "Sprint (2 jours)", "Incrément livré", "Revue & rétrospective"];
  const nodes = steps.map((t, i) => {
    const ang = ((-90 + i * 72) * Math.PI) / 180;
    const n = { cx: cx + rx * Math.cos(ang), cy: cy + ry * Math.sin(ang), w: bw, h: bh };
    box(s, n.cx - bw / 2, n.cy - bh / 2, bw, bh, { fill: i === 2 ? A : P, line: null, r: 0.3 });
    txt(s, t, n.cx - bw / 2, n.cy - bh / 2, bw, bh, { fontSize: 14, bold: true, color: WH, align: "center", valign: "middle" });
    return n;
  });
  nodes.forEach((n, i) => connect(s, n, nodes[(i + 1) % 5], { color: PD, w: 1.75, end: "triangle" }));
  const daily = { cx, cy: cy + 0.05, w: 1.9, h: 0.95 };
  s.addShape(pres.shapes.OVAL, { x: daily.cx - 0.95, y: daily.cy - 0.475, w: 1.9, h: 0.95, fill: { color: AL }, line: { color: A, width: 1.5 } });
  txt(s, "Daily scrum\n15 min / jour", daily.cx - 0.95, daily.cy - 0.475, 1.9, 0.95, { fontSize: 13, bold: true, color: A, align: "center", valign: "middle" });
  connect(s, daily, nodes[2], { color: A, w: 1.5, dash: "dash", begin: "triangle", end: "triangle" });
  s.addNotes(
    `Nous avons suivi la méthode Scrum. ${AUTHOR} jouait le rôle de Product Owner et priorisait le backlog, ${PARTNER} était Scrum Master et animait les cérémonies, et nous formions ensemble l'équipe de développement. ` +
    "Le projet a été découpé en trois sprints de deux jours, chacun commençant par un sprint planning, avec un daily scrum chaque jour. " +
    "Chaque sprint se terminait par une revue et une rétrospective, et l'incrément livré enrichissait le backlog pour le sprint suivant.",
  );
}

// =====================================================================
// 18. Backlog produit
// =====================================================================
const STORY_TEXT = {
  US1: "En tant que visiteur, je veux créer un compte et me connecter afin d'accéder à mes conversations",
  US2: "En tant qu'utilisateur, je veux envoyer des messages, des photos et des notes vocales en temps réel afin d'échanger instantanément",
  US3: "En tant qu'utilisateur, je veux passer des appels audio et vidéo afin de parler en direct",
  US4: "En tant qu'utilisateur, je veux accepter les demandes, bloquer et créer des groupes afin de contrôler qui me contacte",
  US5: "En tant qu'utilisateur, je veux démarrer un chat secret chiffré afin que personne d'autre ne puisse le lire",
  US6: "En tant qu'utilisateur, je veux écouter de la musique et jouer avec mes amis afin de me détendre",
  US7: "En tant qu'utilisateur, je veux activer la 2FA et gérer mes appareils afin de sécuriser mon compte",
  US8: "En tant qu'administrateur, je veux suspendre des comptes et traiter les signalements afin de modérer la plateforme",
};
const PRIO_COLOR = { Must: A, Should: P, Could: MU };
{
  const s = newSlide("Backlog produit", "Gestion de projet");
  const rows = [[hdrCell("ID"), hdrCell("User story"), hdrCell("Priorité (MoSCoW)"), hdrCell("Points")]];
  STORIES.forEach((u, i) => {
    const f = { color: i % 2 ? WH : PL };
    rows.push([
      { text: u.id, options: { bold: true, color: PD, align: "center", fill: f } },
      { text: STORY_TEXT[u.id], options: { fill: f } },
      { text: u.prio + " have", options: { bold: true, color: PRIO_COLOR[u.prio], align: "center", fill: f } },
      { text: String(u.pts), options: { bold: true, align: "center", fill: f } },
    ]);
  });
  rows.push([
    { text: "", options: {} },
    { text: "Total du backlog", options: { bold: true, align: "right" } },
    { text: "", options: {} },
    { text: String(bd.total), options: { bold: true, color: WH, fill: { color: A }, align: "center" } },
  ]);
  s.addTable(rows, {
    x: 0.6, y: 1.3, w: 12.13, colW: [0.8, 8.63, 1.7, 1.0], rowH: 0.5,
    fontFace: FONT, fontSize: 13, color: TX, valign: "middle", margin: [0.03, 0.08, 0.03, 0.08],
    border: { type: "solid", pt: 0.75, color: PB },
  });
  s.addNotes(
    "Le backlog produit contient huit user stories rédigées sous la forme « En tant que…, je veux…, afin de… ». " +
    "Elles sont priorisées avec la méthode MoSCoW : l'authentification, la messagerie, les groupes et la modération sont indispensables, tandis que l'espace Chill est un bonus. " +
    `Chaque story est estimée en story points, pour un total de ${bd.total} points.`,
  );
}

// =====================================================================
// 19. Planification des sprints
// =====================================================================
{
  const s = newSlide("Planification des sprints", "Gestion de projet");
  const rows = [[hdrCell("Sprint"), hdrCell("Dates (2026)"), hdrCell("Objectif du sprint"), hdrCell("User stories"), hdrCell("Points")]];
  SPRINTS.forEach((sp, i) => {
    const us = STORIES.filter((u) => u.sprint === sp.n);
    const f = { color: i % 2 ? WH : PL };
    rows.push([
      { text: "Sprint " + sp.n, options: { bold: true, color: PD, align: "center", fill: f } },
      { text: `${dayLabel(sp.from)} → ${dayLabel(sp.to)}`, options: { align: "center", fill: f } },
      { text: sp.goal, options: { fill: f } },
      { text: us.map((u) => u.id).join(", "), options: { align: "center", bold: true, color: P, fill: f } },
      { text: String(sprintPts[i]), options: { align: "center", bold: true, fill: f } },
    ]);
  });
  rows.push([
    { text: "", options: {} }, { text: "", options: {} }, { text: "", options: {} },
    { text: "Total", options: { bold: true, align: "center" } },
    { text: String(bd.total), options: { bold: true, color: WH, fill: { color: A }, align: "center" } },
  ]);
  s.addTable(rows, {
    x: 0.6, y: 1.3, w: 12.13, colW: [1.3, 3.1, 4.53, 2.0, 1.2], rowH: 0.55,
    fontFace: FONT, fontSize: 14, color: TX, valign: "middle", margin: [0.03, 0.1, 0.03, 0.1],
    border: { type: "solid", pt: 0.75, color: PB },
  });
  const x0 = 0.6, wd = 12.13 / 6, y = 4.75;
  txt(s, "Frise du projet", 0.6, 4.25, 4, 0.4, { fontSize: 15, bold: true, color: MU });
  SPRINTS.forEach((sp, i) => {
    box(s, x0 + sp.from * wd + 0.04, y, 2 * wd - 0.08, 0.6, { fill: i === 1 ? A : P, line: null, r: 0.25 });
    txt(s, `Sprint ${sp.n}`, x0 + sp.from * wd, y, 2 * wd, 0.6, { fontSize: 16, bold: true, color: WH, align: "center", valign: "middle" });
  });
  for (let d = 0; d < 6; d++) txt(s, dayLabel(d), x0 + d * wd, y + 0.75, wd, 0.35, { fontSize: 13, color: TX, align: "center" });
  txt(s, "Chaque sprint : planning → daily scrums → revue → rétrospective", 0.6, 6.15, 12.13, 0.4, { fontSize: 14, italic: true, color: MU, align: "center" });
  s.addNotes(
    "Les huit user stories ont été réparties sur trois sprints de deux jours. Le premier sprint a posé le socle : comptes et messagerie temps réel. " +
    `Le deuxième, le plus chargé avec ${sprintPts[1]} points, a ajouté les appels, les groupes, les chats secrets et l'espace Chill. ` +
    "Le troisième a apporté la sécurité, l'administration, puis les tests automatisés et la mise en ligne.",
  );
}

// =====================================================================
// 20. WBS
// =====================================================================
{
  pres.addSection({ title: "Planification" });
  const s = newSlide("WBS : découpage du projet", "Planification");
  const PH = [
    ["1. Analyse & conception", ["A", "B"]],
    ["2. Back-end & données", ["C", "D", "H"]],
    ["3. Front-end & fonctions", ["E", "F", "G", "K"]],
    ["4. Sécurité & admin", ["I", "J"]],
    ["5. Qualité & mise en ligne", ["L", "M"]],
  ];
  const rootW = 3.4, rootX = 0.6 + 12.13 / 2 - rootW / 2;
  box(s, rootX, 1.25, rootW, 0.6, { fill: PD, line: null });
  txt(s, `Projet Relay (${fr(pert.total)} jours)`, rootX, 1.25, rootW, 0.6, { fontSize: 17, bold: true, color: WH, align: "center", valign: "middle" });
  const pw = 2.29, gap = 0.17;
  const centers = PH.map((_, i) => 0.6 + i * (pw + gap) + pw / 2);
  line(s, 0.6 + 12.13 / 2, 1.85, 0.6 + 12.13 / 2, 2.1, { color: PD, w: 1.5 });
  line(s, centers[0], 2.1, centers[4], 2.1, { color: PD, w: 1.5 });
  PH.forEach(([name, ids], i) => {
    const x = 0.6 + i * (pw + gap);
    line(s, centers[i], 2.1, centers[i], 2.35, { color: PD, w: 1.5 });
    box(s, x, 2.35, pw, 0.65, { fill: P, line: null });
    txt(s, name, x + 0.05, 2.35, pw - 0.1, 0.65, { fontSize: 14, bold: true, color: WH, align: "center", valign: "middle" });
    const lx = x + 0.15;
    const ys = ids.map((_, j) => 3.25 + j * 0.8);
    line(s, lx, 3.0, lx, ys.at(-1) + 0.3, { color: PD, w: 1.25 });
    ids.forEach((id, j) => {
      const crit = T[id].critical;
      line(s, lx, ys[j] + 0.3, x + 0.3, ys[j] + 0.3, { color: PD, w: 1.25 });
      box(s, x + 0.3, ys[j], pw - 0.3, 0.6, { fill: crit ? AL : PL, line: crit ? A : PB });
      txt(s, `${i + 1}.${j + 1} ${SHORT[id]} (${id})`, x + 0.38, ys[j], pw - 0.44, 0.6, { fontSize: 12, color: TX, valign: "middle" });
    });
  });
  box(s, 0.6, 6.45, 0.35, 0.3, { fill: AL, line: A });
  txt(s, "Tâche du chemin critique (voir PERT)", 1.05, 6.45, 5, 0.3, { fontSize: 12, color: MU, valign: "middle" });
  s.addNotes(
    "Le WBS découpe le projet en cinq lots : analyse et conception, back-end et données, front-end et fonctionnalités, sécurité et administration, puis qualité et mise en ligne. " +
    "Chaque lot regroupe des tâches concrètes, identifiées par une lettre de A à M, que l'on retrouve dans le PERT et le Gantt. " +
    "Les tâches en orange appartiennent au chemin critique.",
  );
}

// =====================================================================
// 21. Tableau des tâches
// =====================================================================
{
  const s = newSlide("Tableau des tâches", "Planification");
  const rows = [[hdrCell("ID"), hdrCell("Tâche"), hdrCell("Durée (j)"), hdrCell("Antériorités"), hdrCell("ES"), hdrCell("EF"), hdrCell("LS"), hdrCell("LF"), hdrCell("Marge")]];
  pert.tasks.forEach((t, i) => {
    const f = { color: t.critical ? AL : i % 2 ? WH : "F8F8FF" };
    const c = (v, o = {}) => ({ text: String(v), options: { align: "center", fill: f, ...o } });
    rows.push([
      c(t.id, { bold: true, color: t.critical ? A : PD }), { text: t.name, options: { fill: f } }, c(fr(t.d)), c(t.pred.join(", ") || "–"),
      c(fr(t.ES)), c(fr(t.EF)), c(fr(t.LS)), c(fr(t.LF)), c(fr(t.slack), { bold: true, color: t.critical ? A : TX }),
    ]);
  });
  s.addTable(rows, {
    x: 0.6, y: 1.2, w: 12.13, colW: [0.6, 5.33, 1.1, 1.3, 0.76, 0.76, 0.76, 0.76, 0.76], rowH: 0.375,
    fontFace: FONT, fontSize: 12, color: TX, valign: "middle", margin: [0.03, 0.08, 0.03, 0.08],
    border: { type: "solid", pt: 0.75, color: PB },
  });
  txt(s, `Durée totale : ${fr(pert.total)} jours · lignes orange = chemin critique (marge nulle) · valeurs calculées par pert.mjs`, 0.6, 6.55, 12.13, 0.35, { fontSize: 12, color: MU, italic: true });
  s.addNotes(
    "Ce tableau liste les treize tâches du projet, avec leur durée en jours et leurs antériorités. Les durées sont exprimées en demi-journées, car le projet a été réalisé en six jours. " +
    "Les dates au plus tôt et au plus tard ainsi que les marges ont été calculées automatiquement par un script, avec la passe avant puis la passe arrière. " +
    "Les lignes en orange ont une marge nulle : elles forment le chemin critique.",
  );
}

// =====================================================================
// 22. PERT
// =====================================================================
{
  const s = newSlide("Diagramme de PERT", "Planification");
  txt(s, [
    { text: `Durée totale : ${fr(pert.total)} jours   ·   Chemin critique : `, options: { bold: true, color: PD } },
    { text: pert.criticalPath.join(" → "), options: { bold: true, color: A } },
  ], 0.6, 1.15, 12.13, 0.4, { fontSize: 16, align: "center" });
  const NW = 1.0, NH = 1.0, x0 = 0.7, sx = (12.65 - x0 - NW) / 8;
  const ROW = { top: 2.25, mid: 3.95, bot: 5.55 };
  const POS = {
    A: [0, "mid"], B: [1, "mid"], C: [2, "mid"], D: [3, "mid"], G: [4, "mid"], H: [5, "mid"], I: [6, "mid"], L: [7, "mid"], M: [8, "mid"],
    E: [2, "top"], F: [4, "top"], K: [5, "bot"], J: [6, "bot"],
  };
  const N = {};
  for (const [id, [c, r]] of Object.entries(POS)) N[id] = { cx: x0 + c * sx + NW / 2, cy: ROW[r], w: NW, h: NH };
  const crit = (a, b) => T[a].critical && T[b].critical && T[b].ES === T[a].EF;
  const eo = (a, b) => ({ color: crit(a, b) ? A : PD, w: crit(a, b) ? 2.5 : 1.25, end: "triangle" });
  const straight = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "G"], ["G", "H"], ["H", "I"], ["I", "L"], ["L", "M"], ["B", "E"], ["D", "F"], ["E", "F"], ["G", "K"], ["H", "J"], ["J", "L"]];
  for (const [a, b] of straight) connect(s, N[a], N[b], eo(a, b));
  poly(s, [[N.F.cx + NW / 2, ROW.top], [N.L.cx, ROW.top], [N.L.cx, ROW.mid - NH / 2]], { color: PD, w: 1.25, end: "triangle" });
  const lane = ROW.bot + NH / 2 + 0.38;
  poly(s, [[N.K.cx, ROW.bot + NH / 2], [N.K.cx, lane], [N.M.cx, lane], [N.M.cx, ROW.mid + NH / 2]], { color: PD, w: 1.25, end: "triangle" });
  const node = (x, y, cells, id, isCrit) => {
    const c = isCrit ? A : P;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: NW, h: NH, fill: { color: WH }, line: { color: c, width: isCrit ? 2.25 : 1.25 } });
    s.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.3, w: NW, h: 0.4, fill: { color: isCrit ? AL : PL }, line: { color: c, width: isCrit ? 2.25 : 1.25 } });
    const cw = NW / 3;
    for (const k of [1, 2]) {
      line(s, x + k * cw, y, x + k * cw, y + 0.3, { color: c, w: 0.75 });
      line(s, x + k * cw, y + 0.7, x + k * cw, y + NH, { color: c, w: 0.75 });
    }
    const t3 = (v, i, yy, o = {}) => txt(s, v, x + i * cw, yy, cw, 0.3, { fontSize: 12, align: "center", valign: "middle", color: TX, ...o });
    t3(cells[0], 0, y); t3(cells[1], 1, y, { color: MU }); t3(cells[2], 2, y);
    txt(s, id, x, y + 0.3, NW, 0.4, { fontSize: 18, bold: true, align: "center", valign: "middle", color: isCrit ? A : PD });
    t3(cells[3], 0, y + 0.7); t3(cells[4], 1, y + 0.7, { bold: true, color: isCrit ? A : TX }); t3(cells[5], 2, y + 0.7);
  };
  for (const t of pert.tasks) {
    const n = N[t.id];
    node(n.cx - NW / 2, n.cy - NH / 2, [fr(t.ES), fr(t.d), fr(t.EF), fr(t.LS), fr(t.slack), fr(t.LF)], t.id, t.critical);
  }
  node(0.7, 5.05, ["ES", "D", "EF", "LS", "M", "LF"], "ID", false);
  txt(s, [
    { text: "ES / EF : début / fin au plus tôt", options: { breakLine: true } },
    { text: "LS / LF : début / fin au plus tard", options: { breakLine: true } },
    { text: "D : durée (jours) · M : marge = LS − ES", options: { breakLine: true } },
    { text: "Orange : chemin critique (M = 0)", options: { color: A, bold: true } },
  ], 1.85, 5.05, 3.4, 1.0, { fontSize: 12, color: TX, valign: "middle" });
  s.addNotes(
    "Le PERT représente chaque tâche par un nœud : en haut la date de début au plus tôt, la durée et la date de fin au plus tôt ; en bas les dates au plus tard et, au centre, la marge. " +
    `Le chemin critique, en orange, est ${pert.criticalPath.join(", ")} : tout retard sur l'une de ces tâches retarde la fin du projet, qui dure ${fr(pert.total)} jours. ` +
    "Les autres tâches, comme l'interface React ou les appels, ont de la marge ; comme nous étions deux, elles ont pu avancer en parallèle.",
  );
}

// =====================================================================
// 23. Gantt
// =====================================================================
{
  const s = newSlide("Diagramme de Gantt", "Planification");
  const LX = 0.6, LW = 3.15, X0 = 3.85, X1 = 12.73, days = Math.ceil(pert.total), dw = (X1 - X0) / days;
  const Y0 = 2.0, RH = 0.355;
  SPRINTS.forEach((sp, i) => {
    box(s, X0 + sp.from * dw + 0.02, 1.2, 2 * dw - 0.04, 0.35, { fill: i === 1 ? A : P, line: null, r: 0.15 });
    txt(s, `Sprint ${sp.n}`, X0 + sp.from * dw, 1.2, 2 * dw, 0.35, { fontSize: 13, bold: true, color: WH, align: "center", valign: "middle" });
  });
  for (let d = 0; d < days; d++) {
    box(s, X0 + d * dw, 1.6, dw, 0.35, { fill: PL, line: PB, round: false });
    txt(s, dayLabel(d), X0 + d * dw, 1.6, dw, 0.35, { fontSize: 12, bold: true, color: PD, align: "center", valign: "middle" });
  }
  txt(s, "Tâche", LX, 1.6, LW, 0.35, { fontSize: 13, bold: true, color: PD, valign: "middle" });
  const YE = Y0 + pert.tasks.length * RH;
  for (let k = 0; k <= days * 2; k++) {
    line(s, X0 + (k * dw) / 2, Y0, X0 + (k * dw) / 2, YE, { color: k % 2 ? "E5E7EB" : PB, w: 0.75, dash: k % 2 ? "dash" : "solid" });
  }
  pert.tasks.forEach((t, i) => {
    const y = Y0 + i * RH;
    if (i % 2 === 0) s.addShape(pres.shapes.RECTANGLE, { x: LX, y, w: X0 - LX - 0.05, h: RH, fill: { color: "F8F8FF" }, line: { type: "none" } });
    txt(s, [
      { text: t.id + "  ", options: { bold: true, color: t.critical ? A : PD } },
      { text: SHORT[t.id], options: { color: TX } },
    ], LX + 0.08, y, LW, RH, { fontSize: 12, valign: "middle" });
    const bx = X0 + t.ES * dw, bw = t.d * dw, by = y + 0.06, bh = RH - 0.12;
    if (t.slack > 0) {
      s.addShape(pres.shapes.RECTANGLE, { x: X0 + t.EF * dw, y: by + 0.07, w: t.slack * dw, h: bh - 0.14, fill: { color: "E5E7EB" }, line: { color: "9CA3AF", width: 0.75, dashType: "dash" } });
    }
    box(s, bx, by, bw, bh, { fill: t.critical ? A : P, line: null, r: 0.06 });
    txt(s, fr(t.d) + " j", bx, by, bw, bh, { fontSize: 12, bold: true, color: WH, align: "center", valign: "middle" });
  });
  const ly = 6.68;
  const leg = (x, fill, lineC, label, dash) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y: ly + 0.06, w: 0.4, h: 0.2, fill: { color: fill }, line: lineC ? { color: lineC, width: 0.75, dashType: dash } : { type: "none" } });
    txt(s, label, x + 0.5, ly, 2.6, 0.32, { fontSize: 12, color: MU, valign: "middle" });
  };
  leg(0.6, A, null, "Tâche critique");
  leg(2.6, P, null, "Tâche non critique");
  leg(4.8, "E5E7EB", "9CA3AF", "Marge (jusqu'à LF)", "dash");
  txt(s, "1 colonne = 1 jour (pointillés : demi-journée)", 7.4, ly, 5.33, 0.32, { fontSize: 12, color: MU, valign: "middle", align: "right" });
  s.addNotes(
    "Le diagramme de Gantt reprend exactement les dates du PERT sur une frise allant du mercredi 11 au lundi 16 novembre 2026. " +
    "Les barres orange sont les tâches critiques, enchaînées sans interruption, et les barres grises en pointillés montrent la marge des autres tâches. " +
    "On voit aussi le découpage en trois sprints de deux jours en haut du diagramme.",
  );
}

// =====================================================================
// 24. Burndown et vélocité
// =====================================================================
const chartText = {
  catAxisLabelFontFace: "+mn-lt", catAxisLabelFontSize: 12, catAxisLabelColor: TX,
  valAxisLabelFontFace: "+mn-lt", valAxisLabelFontSize: 12, valAxisLabelColor: TX,
  titleFontFace: "+mn-lt", titleFontSize: 16, titleColor: PD,
  dataLabelFontFace: "+mn-lt", dataLabelFontSize: 12, dataLabelColor: TX,
  valGridLine: { color: "E5E7EB", size: 0.75 }, catGridLine: { style: "none" },
};
{
  pres.addSection({ title: "Suivi et qualité" });
  const s = newSlide("Suivi : burndown et vélocité", "Suivi et qualité");
  const labels = ["Début", ...Array.from({ length: bd.days }, (_, d) => dayLabel(d, { day: "numeric", month: "numeric" }))];
  s.addChart(pres.charts.LINE, [
    { name: "Idéal", labels, values: bd.ideal },
    { name: "Réel", labels, values: bd.actual },
  ], {
    x: 0.6, y: 1.25, w: 6.9, h: 5.55, ...chartText,
    chartColors: ["9CA3AF", A], lineSize: 3, lineDataSymbol: "circle", lineDataSymbolSize: 8,
    showTitle: true, title: `Burndown du projet (${bd.total} story points)`,
    showLegend: true, legendPos: "b", legendFontFace: "+mn-lt", legendFontSize: 13, legendColor: TX,
    valAxisMinVal: 0, valAxisMaxVal: 50, valAxisMajorUnit: 10,
    showValAxisTitle: true, valAxisTitle: "Points restants", valAxisTitleFontSize: 12, valAxisTitleColor: MU, valAxisTitleFontFace: "+mn-lt",
  });
  s.addChart(pres.charts.BAR, [{ name: "Points livrés", labels: SPRINTS.map((sp) => `Sprint ${sp.n}`), values: sprintPts }], {
    x: 7.8, y: 1.25, w: 4.93, h: 3.9, ...chartText, barDir: "col",
    chartColors: [P], barGapWidthPct: 60,
    showTitle: true, title: "Vélocité par sprint (points)",
    showLegend: false, showValue: true, dataLabelPosition: "outEnd",
    valAxisMinVal: 0, valAxisMaxVal: 25, valAxisMajorUnit: 5,
  });
  const avg = bd.total / SPRINTS.length;
  box(s, 7.8, 5.4, 4.93, 1.4, { fill: PL, line: null });
  txt(s, fr(avg.toFixed(1)), 7.95, 5.4, 1.6, 1.4, { fontSize: 36, bold: true, color: A, align: "center", valign: "middle" });
  txt(s, [
    { text: "Vélocité moyenne", options: { bold: true, color: PD, breakLine: true } },
    { text: `points par sprint (${bd.total} / ${SPRINTS.length})`, options: { color: MU } },
  ], 9.65, 5.4, 2.95, 1.4, { fontSize: 15, valign: "middle" });
  s.addNotes(
    `Le burndown montre les story points restants à la fin de chaque jour, sur les ${bd.total} points du backlog. ` +
    "La ligne réelle reste plate le premier jour, consacré à l'analyse et à la conception, puis descend à chaque story terminée ; toutes les stories sont terminées le 15 novembre. " +
    `La vélocité mesure les points livrés par sprint : ${sprintPts.join(", ")}, soit une moyenne d'environ ${fr(avg.toFixed(1))} points ; le sprint 2 était le plus chargé.`,
  );
}

// =====================================================================
// 25. Kanban
// =====================================================================
{
  const s = newSlide("Tableau Kanban", "Suivi et qualité");
  txt(s, "État au lundi 16 novembre 2026, au matin (sprint 3)", 0.6, 1.2, 12.13, 0.4, { fontSize: 16, italic: true, color: MU, align: "center" });
  const cols = [
    { name: "À faire", c: MU, x: 0.6, w: 2.95 },
    { name: "En cours", c: A, x: 3.75, w: 2.95 },
    { name: "Terminé", c: P, x: 6.9, w: 5.83 },
  ];
  const done = pert.tasks.filter((t) => !["L", "M"].includes(t.id));
  const counts = [1, 1, done.length];
  cols.forEach((col, i) => {
    box(s, col.x, 1.75, col.w, 5.0, { fill: "F8F8FF", line: PB });
    box(s, col.x, 1.75, col.w, 0.5, { fill: col.c, line: null });
    txt(s, `${col.name} (${counts[i]})`, col.x, 1.75, col.w, 0.5, { fontSize: 15, bold: true, color: WH, align: "center", valign: "middle" });
  });
  const card = (x, y, w, id, t, c, o = {}) => {
    box(s, x, y, w, 0.6, { fill: WH, line: c, dash: o.dash, shadow: !o.dash });
    txt(s, id ? [
      { text: id + "  ", options: { bold: true, color: c } },
      { text: t, options: { color: TX } },
    ] : t, x + 0.12, y, w - 0.2, 0.6, { fontSize: 12, valign: "middle", italic: !!o.dash, color: o.dash ? MU : TX });
  };
  card(0.75, 2.45, 2.65, "M", SHORT.M + " sur Cloudflare", MU);
  card(0.75, 3.2, 2.65, null, "Backlog futur : application mobile native", MU, { dash: "dash" });
  card(3.9, 2.45, 2.65, "L", SHORT.L, A);
  const cw = (5.83 - 0.45) / 2;
  done.forEach((t, i) => {
    const col = Math.floor(i / 6), row = i % 6;
    card(7.05 + col * (cw + 0.15), 2.45 + row * 0.7, cw, t.id, SHORT[t.id], P);
  });
  s.addNotes(
    "Le tableau Kanban donne l'état du projet le 16 novembre au matin, pendant le dernier sprint. " +
    "Onze tâches sur treize sont terminées, les tests de bout en bout et l'intégration continue sont en cours, et le déploiement reste à faire. " +
    "L'application mobile native est déjà notée dans le backlog pour une version future.",
  );
}

// =====================================================================
// 26. Tests, intégration continue et déploiement
// =====================================================================
{
  const s = newSlide("Tests, intégration continue et déploiement", "Suivi et qualité");
  box(s, 0.5, 1.25, 9.86, 1.65, { fill: "F8F8FF", line: PB, dash: "dash" });
  txt(s, "Intégration continue · GitHub Actions, à chaque push", 0.65, 1.3, 7, 0.32, { fontSize: 13, bold: true, color: P });
  const steps = [
    ["FaCodeBranch", "git push", "GitHub"],
    ["FaCode", "Vérif. des types", "tsc -b"],
    ["FaCubes", "Build", "Vite"],
    ["FaFlask", "Tests E2E", "Playwright · 55 tests"],
    ["FaRocket", "Déploiement", "Wrangler (manuel)"],
  ];
  const sw = 2.05, sg = (12.13 - 5 * sw) / 4;
  for (let i = 0; i < 5; i++) {
    const [ic, t, d] = steps[i];
    const x = 0.6 + i * (sw + sg), y = 1.7, last = i === 4;
    box(s, x, y, sw, 1.05, { fill: last ? AL : WH, line: last ? A : P, lw: 1.25 });
    await iconCircle(s, ic, x + 0.12, y + 0.25, 0.55, last ? A : P);
    txt(s, t, x + 0.75, y + 0.15, sw - 0.8, 0.4, { fontSize: 14, bold: true, color: last ? A : PD, valign: "middle" });
    txt(s, d, x + 0.75, y + 0.55, sw - 0.8, 0.38, { fontSize: 12, color: MU, valign: "middle" });
    if (i < 4) line(s, x + sw + 0.03, y + 0.52, x + sw + sg - 0.03, y + 0.52, { color: i === 3 ? A : PD, w: 1.5, end: "triangle", dash: i === 3 ? "dash" : "solid" });
  }
  txt(s, "npm run deploy + migrations D1", 0.6 + 4 * (sw + sg) - 0.35, 2.8, sw + 0.5, 0.28, { fontSize: 12, color: MU, align: "center" });
  // Ce que vérifient les tests
  txt(s, "Ce que vérifient les tests de bout en bout", 0.6, 3.3, 7.6, 0.4, { fontSize: 17, bold: true, color: PD });
  const checks = [
    "Messages en direct, réponses, réactions", "Appels réels entre deux navigateurs",
    "Chats secrets : seul le chiffré est stocké", "Mode hors ligne et mise à jour",
    "Pouvoirs du propriétaire, modération", "Jeux, Chill, regarder ensemble",
    "Thèmes de discussion partagés", "Autocollants, stories, IA",
  ];
  for (let i = 0; i < checks.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 0.6 + col * 3.85, y = 3.85 + row * 0.7;
    box(s, x, y, 3.7, 0.56, { fill: row % 2 ? WH : PL, line: row % 2 ? PB : null });
    await iconCircle(s, "FaCheck", x + 0.1, y + 0.1, 0.36, P);
    txt(s, checks[i], x + 0.55, y, 3.1, 0.56, { fontSize: 13, valign: "middle" });
  }
  const stats = [["55", "tests de bout en bout"], ["16", "fichiers de tests"]];
  stats.forEach(([n, l], i) => {
    const y = 3.35 + i * 1.75;
    box(s, 8.6, y, 4.13, 1.55, { fill: WH, line: PB, shadow: true });
    txt(s, n, 8.7, y, 1.6, 1.55, { fontSize: 40, bold: true, color: i === 0 ? A : P, align: "center", valign: "middle" });
    txt(s, l, 10.35, y, 2.3, 1.55, { fontSize: 16, color: TX, valign: "middle" });
  });
  s.addNotes(
    "La qualité est vérifiée automatiquement. À chaque push sur GitHub, GitHub Actions vérifie les types avec TypeScript, construit l'application avec Vite, puis lance les 55 tests de bout en bout avec Playwright. " +
    "Ces tests utilisent de vrais navigateurs et une base locale : ils vérifient par exemple les appels entre deux navigateurs, ou que seul le texte chiffré est stocké pour les chats secrets. " +
    "Le déploiement reste une étape manuelle : on applique les migrations D1 puis on publie avec Wrangler.",
  );
}

// =====================================================================
// 27. Bilan et perspectives
// =====================================================================
{
  pres.addSection({ title: "Conclusion" });
  const s = newSlide("Bilan et perspectives", "Conclusion");
  txt(s, "Réalisé", 0.6, 1.25, 5.6, 0.45, { fontSize: 20, bold: true, color: PD });
  const done = [
    "Application en ligne sur Cloudflare, 0 € d'hébergement",
    "Messagerie temps réel, appels et chats secrets",
    "4 rôles : visiteur, utilisateur, admin, propriétaire",
    "55 tests E2E automatisés en intégration continue",
    `${bd.total} / ${bd.total} story points livrés en 3 sprints`,
  ];
  for (let i = 0; i < done.length; i++) {
    const y = 1.85 + i * 0.95;
    await iconCircle(s, "FaCheck", 0.6, y + 0.1, 0.55, P);
    txt(s, done[i], 1.35, y, 4.9, 0.75, { fontSize: 16, valign: "middle" });
  }
  txt(s, "Perspectives", 6.75, 1.25, 5.98, 0.45, { fontSize: 20, bold: true, color: PD });
  const next = [
    ["FaMobileScreen", "Application mobile native", "Au-delà de la PWA actuelle"],
    ["FaKey", "Double Ratchet", "Nouvelle clé par message (chats secrets)"],
    ["FaPhone", "Appels de groupe", "Aujourd'hui : appels à deux"],
    ["FaGlobe", "Nom de domaine dédié", "À la place de workers.dev"],
  ];
  for (let i = 0; i < 4; i++) {
    const [ic, t, d] = next[i];
    const x = 6.75 + (i % 2) * 3.06, y = 1.85 + Math.floor(i / 2) * 2.45;
    box(s, x, y, 2.92, 2.25, { fill: i % 3 === 0 ? PL : WH, line: i % 3 === 0 ? null : PB });
    await iconCircle(s, ic, x + 0.25, y + 0.25, 0.7, A);
    txt(s, t, x + 0.25, y + 1.05, 2.5, 0.45, { fontSize: 16, bold: true, color: PD });
    txt(s, d, x + 0.25, y + 1.5, 2.5, 0.6, { fontSize: 14, color: MU });
  }
  s.addNotes(
    "En bilan, Relay est en ligne, sans frais d'hébergement, avec la messagerie temps réel, les appels et les chats secrets, quatre rôles et 55 tests automatisés. " +
    `Les ${bd.total} story points du backlog ont été livrés en trois sprints. ` +
    "Comme perspectives, nous envisageons une application mobile native, le protocole Double Ratchet pour renforcer les chats secrets, les appels de groupe et un nom de domaine dédié.",
  );
}

// =====================================================================
// 28. Conclusion
// =====================================================================
{
  const s = pres.addSlide({ masterName: "SOMBRE", sectionTitle: "Conclusion" });
  txt(s, "Conclusion", 0.6, 0.3, 12.13, 0.75, { fontSize: 30, bold: true, color: WH, valign: "middle", align: "center" });
  const pts = [
    ["FaCircleCheck", "Un produit complet et en ligne, utilisé au quotidien"],
    ["FaShieldHalved", "La sécurité intégrée dès la conception"],
    ["FaLightbulb", "Scrum, PERT et Gantt pour livrer en 6 jours à deux"],
  ];
  for (let i = 0; i < 3; i++) {
    const y = 1.45 + i * 0.85;
    await iconCircle(s, pts[i][0], 0.6, y, 0.6, P);
    txt(s, pts[i][1], 1.45, y, 10.5, 0.6, { fontSize: 20, color: WH, valign: "middle" });
  }
  box(s, 0.6, 4.35, 12.13, 2.2, { fill: "312E81", line: null, r: 0.12 });
  txt(s, "Merci pour votre attention", 0.6, 4.55, 12.13, 0.9, { fontSize: 40, bold: true, color: WH, align: "center", valign: "middle" });
  txt(s, "Questions ?", 0.6, 5.45, 12.13, 0.8, { fontSize: 32, bold: true, color: "FDBA74", align: "center", valign: "middle" });
  s.addNotes(
    "Pour conclure, Relay est un produit complet, en ligne et utilisé au quotidien, avec une sécurité pensée dès la conception. " +
    "La méthode Scrum et les outils de planification, PERT et Gantt, nous ont permis de livrer en six jours à deux, en gardant le chemin critique sous contrôle. " +
    "Merci pour votre attention ; nous sommes prêts à répondre à vos questions.",
  );
}

await pres.writeFile({ fileName: OUT });
await applyTheme(OUT, THEME);
console.log("Écrit :", OUT, `(${pres.slides.length} diapositives)`);
