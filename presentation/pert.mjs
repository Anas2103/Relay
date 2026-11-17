// Calcul PERT automatique : passe avant (ES/EF), passe arrière (LS/LF), marge, chemin critique.
// Durées en jours (pas de 0,5 j = une demi-journée). Jour 0 = mercredi 11 novembre 2026 au matin.
// Usage : node pert.mjs      (affiche le tableau et écrit pert-results.json)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const START_DATE = new Date(2026, 10, 11); // 11 novembre 2026

export const TASKS = [
  { id: "A", name: "Analyse des besoins & choix techniques", d: 0.5, pred: [] },
  { id: "B", name: "Conception : architecture & schéma BD", d: 0.5, pred: ["A"] },
  { id: "C", name: "Base de données D1 & authentification", d: 0.5, pred: ["B"] },
  { id: "D", name: "Messagerie temps réel (WebSocket, Durable Objects)", d: 0.5, pred: ["C"] },
  { id: "E", name: "Interface React (chat, médias, personnalisation)", d: 1, pred: ["B"] },
  { id: "F", name: "Appels audio/vidéo WebRTC", d: 0.5, pred: ["D", "E"] },
  { id: "G", name: "Demandes de contact, blocage & groupes", d: 0.5, pred: ["D"] },
  { id: "H", name: "Chats secrets chiffrés (E2EE)", d: 1.5, pred: ["G"] },
  { id: "I", name: "Sécurité (2FA, appareils) & PWA hors ligne", d: 1, pred: ["H"] },
  { id: "J", name: "Administration & espace propriétaire", d: 0.5, pred: ["H"] },
  { id: "K", name: "Chill, jeux & thèmes de discussion", d: 1, pred: ["G"] },
  { id: "L", name: "Tests E2E (Playwright) & intégration continue", d: 0.5, pred: ["F", "I", "J"] },
  { id: "M", name: "Déploiement sur Cloudflare", d: 0.5, pred: ["K", "L"] },
];

// Backlog : user stories, points, sprint, et tâches PERT qui les réalisent.
export const STORIES = [
  { id: "US1", pts: 5, prio: "Must", sprint: 1, tasks: ["C"] },
  { id: "US2", pts: 8, prio: "Must", sprint: 1, tasks: ["D", "E"] },
  { id: "US3", pts: 5, prio: "Should", sprint: 2, tasks: ["F"] },
  { id: "US4", pts: 5, prio: "Must", sprint: 2, tasks: ["G"] },
  { id: "US5", pts: 8, prio: "Should", sprint: 2, tasks: ["H"] },
  { id: "US6", pts: 3, prio: "Could", sprint: 2, tasks: ["K"] },
  { id: "US7", pts: 5, prio: "Should", sprint: 3, tasks: ["I"] },
  { id: "US8", pts: 5, prio: "Must", sprint: 3, tasks: ["J"] },
];

export function computePert(tasks = TASKS) {
  const byId = new Map(tasks.map((t) => [t.id, { ...t }]));
  // Ordre topologique
  const order = [];
  const seen = new Set();
  const visit = (id, stack = new Set()) => {
    if (seen.has(id)) return;
    if (stack.has(id)) throw new Error("Cycle détecté sur " + id);
    stack.add(id);
    for (const p of byId.get(id).pred) {
      if (!byId.has(p)) throw new Error(`Antériorité inconnue ${p} pour ${id}`);
      visit(p, stack);
    }
    seen.add(id);
    order.push(id);
  };
  tasks.forEach((t) => visit(t.id));
  // Passe avant
  for (const id of order) {
    const t = byId.get(id);
    t.ES = Math.max(0, ...t.pred.map((p) => byId.get(p).EF));
    t.EF = t.ES + t.d;
  }
  const total = Math.max(...[...byId.values()].map((t) => t.EF));
  // Passe arrière
  for (const id of [...order].reverse()) {
    const t = byId.get(id);
    const succ = [...byId.values()].filter((s) => s.pred.includes(id));
    t.LF = succ.length ? Math.min(...succ.map((s) => s.LS)) : total;
    t.LS = t.LF - t.d;
    t.slack = +(t.LS - t.ES).toFixed(3);
    t.critical = t.slack === 0;
  }
  const result = tasks.map((t) => byId.get(t.id));
  // Chemin critique : suite continue de tâches à marge nulle, du début à la fin
  const path = [];
  let cur = result.find((t) => t.critical && t.ES === 0);
  while (cur) {
    path.push(cur.id);
    if (cur.EF === total) break;
    cur = result.find((s) => s.critical && s.pred.includes(cur.id) && s.ES === cur.EF);
  }
  const last = byId.get(path.at(-1));
  if (!last || last.EF !== total) throw new Error("Chemin critique discontinu");
  return { tasks: result, total, criticalPath: path };
}

// Burndown : points restants à la fin de chaque jour (une story est finie quand ses tâches le sont).
export function computeBurndown(pert, stories = STORIES) {
  const total = stories.reduce((s, u) => s + u.pts, 0);
  const days = Math.ceil(pert.total);
  const ef = Object.fromEntries(pert.tasks.map((t) => [t.id, t.EF]));
  const actual = [];
  const ideal = [];
  for (let day = 0; day <= days; day++) {
    const done = stories.filter((u) => Math.max(...u.tasks.map((x) => ef[x])) <= day).reduce((s, u) => s + u.pts, 0);
    actual.push(total - done);
    ideal.push(+(total - (total * day) / days).toFixed(1));
  }
  return { total, ideal, actual, days };
}

const fmt = (n) => String(n).replace(".", ",");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pert = computePert();
  const bd = computeBurndown(pert);
  console.log("ID | Durée | Antériorités | ES  | EF  | LS  | LF  | Marge | Critique | Tâche");
  for (const t of pert.tasks) {
    console.log(
      [t.id, fmt(t.d), t.pred.join(",") || "-", fmt(t.ES), fmt(t.EF), fmt(t.LS), fmt(t.LF), fmt(t.slack), t.critical ? "OUI" : "", t.name]
        .map((v, i) => String(v).padEnd([2, 5, 12, 3, 3, 3, 3, 5, 8, 0][i]))
        .join(" | "),
    );
  }
  console.log(`\nDurée totale : ${fmt(pert.total)} jours`);
  console.log("Chemin critique : " + pert.criticalPath.join(" → "));
  console.log(`\nBacklog : ${bd.total} points`);
  console.log("Burndown idéal : " + bd.ideal.join(" / "));
  console.log("Burndown réel  : " + bd.actual.join(" / "));
  writeFileSync(new URL("./pert-results.json", import.meta.url), JSON.stringify({ ...pert, burndown: bd }, null, 2));
}
