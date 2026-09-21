/* =============================================================
   WA AI Tool — Progress data
   -------------------------------------------------------------
   HOW TO UPDATE (the only file you touch day-to-day):
     - Change a task "status" to: "todo" | "active" | "done"
     - WHEN you mark a task "done", set its "date" to the day you
       finished it (real completion date).
     - Future tasks keep their planned date.
     - Update LAST_UPDATED below.
   Working days are weekdays only (Mon–Fri). Sep 4 was leave.
   Project start: Sep 1, 2026 (Mon).  Deadline: Sep 21, 2026 (Mon).
   ============================================================= */

const LAST_UPDATED = "Sep 17, 2026";
const DEADLINE = "Oct 21, 2026"; // extended for approved V2 feature expansion

const PLAN = [
  {
    name: "Phase 0 — Foundation",
    days: "Sep 1–2",
    tasks: [
      { title: "Monorepo + Docker Postgres + root files", day: "Day 1", date: "Sep 1, 2026", status: "done" },
      { title: "Express + TypeScript backend skeleton + health check", day: "Day 1", date: "Sep 1, 2026", status: "done" },
      { title: "Prisma schema (all tables) + first migration", day: "Day 2", date: "Sep 2, 2026", status: "done" },
      { title: "Next.js frontend app shell", day: "Day 2", date: "Sep 2, 2026", status: "done" },
      { title: "Local environment running end-to-end", day: "Day 2", date: "Sep 2, 2026", status: "done" },
    ],
  },
  {
    name: "Phase 1 — Auth + Chatbots + WhatsApp config",
    days: "Sep 3–8",
    tasks: [
      { title: "Password + JWT helpers", day: "Day 3", date: "Sep 3, 2026", status: "done" },
      { title: "Auth service (register + login)", day: "Day 3", date: "Sep 3, 2026", status: "done" },
      { title: "Auth routes + validation", day: "Day 3", date: "Sep 3, 2026", status: "done" },
      { title: "Auth middleware (protect routes)", day: "Day 3", date: "Sep 3, 2026", status: "done" },
      { title: "Chatbot CRUD (create/rename/delete/activate)", day: "Day 4", date: "Sep 7, 2026", status: "done" },
      { title: "WhatsApp connection settings (backend-only secrets)", day: "Day 4", date: "Sep 7, 2026", status: "done" },
      { title: "Frontend: login page + chatbot list + settings + styling", day: "Day 5", date: "Sep 8, 2026", status: "done" },
    ],
  },
  {
    name: "Phase 2 — Workflow Builder",
    days: "Sep 9–11",
    tasks: [
      { title: "React Flow canvas + node palette", day: "Day 6", date: "Sep 9, 2026", status: "done" },
      { title: "Node config panels (custom card nodes + #seq + branch handles)", day: "Day 6", date: "Sep 9, 2026", status: "done" },
      { title: "Backend: workflow draft save/load service + routes", day: "Day 7", date: "Sep 10, 2026", status: "done" },
      { title: "Serialize graph to nodes + edges JSON + wire save/load", day: "Day 7", date: "Sep 10, 2026", status: "done" },
      { title: "Save draft persist + test round trip", day: "Day 7", date: "Sep 10, 2026", status: "done" },
    ],
  },
  {
    name: "Phase 3 — Validation + Publish + Versioning",
    days: "Sep 10–11",
    tasks: [
      { title: "Workflow validator (schema + graph checks)", day: "Day 7", date: "Sep 10, 2026", status: "done" },
      { title: "Publish service logic (validate + immutable version)", day: "Day 7", date: "Sep 10, 2026", status: "done" },
      { title: "Publish route + wiring + frontend Publish button", day: "Day 8", date: "Sep 11, 2026", status: "done" },
      { title: "Draft vs published separation + test", day: "Day 8", date: "Sep 11, 2026", status: "done" },
    ],
  },
  {
    name: "Phase 4 — Runtime Engine",
    days: "Sep 11–14",
    tasks: [
      { title: "Runtime types + execution context + messaging adapter interface", day: "Day 8", date: "Sep 11, 2026", status: "done" },
      { title: "Node executors (Start/SendMessage/AskInput/Condition/SetVariable/Wait/End) + registry", day: "Day 8", date: "Sep 11, 2026", status: "done" },
      { title: "Engine loop (walk graph, branch, pause/resume) + tested", day: "Day 8", date: "Sep 11, 2026", status: "done" },
      { title: "Console + WhatsApp messaging adapters", day: "Day 8", date: "Sep 11, 2026", status: "done" },
      { title: "Conversation state persistence (load/run/save)", day: "Day 12", date: "Sep 14, 2026", status: "done" },
      { title: "Webhook receiver + verification + inbound normalize", day: "Day 12", date: "Sep 14, 2026", status: "done" },
      { title: "Resume-on-message flow wired to WhatsApp adapter", day: "Day 12", date: "Sep 14, 2026", status: "done" },
    ],
  },
  {
    name: "Phase 4.5 — Interactive Nodes (bonus)",
    days: "Sep 15",
    tasks: [
      { title: "BUTTONS + LIST node types (builder palette + custom node handles)", day: "Day 13", date: "Sep 15, 2026", status: "done" },
      { title: "Config panel: manage buttons (max 3) + list rows (max 10)", day: "Day 13", date: "Sep 15, 2026", status: "done" },
      { title: "BUTTONS/LIST executors + branch-by-choice", day: "Day 13", date: "Sep 15, 2026", status: "done" },
      { title: "WhatsApp interactive message payloads (buttons/list)", day: "Day 13", date: "Sep 15, 2026", status: "done" },
      { title: "Delete node (corner ✕ + panel) + edge delete", day: "Day 13", date: "Sep 15, 2026", status: "done" },
    ],
  },
  {
    name: "Phase 5 — Integration, Test, Polish",
    days: "Sep 15–21",
    tasks: [
      { title: "Builder test/simulation mode (live chat + tappable buttons)", day: "Day 13", date: "Sep 15, 2026", status: "done" },
      { title: "UI polish: landing page, branded theme, dashboard", day: "Day 13", date: "Sep 15, 2026", status: "done" },
      { title: "Execution + message logging + conversations view", day: "Day 14", date: "Sep 16, 2026", status: "done" },
      { title: "Real WhatsApp end-to-end (Meta app + public webhook URL)", day: "Day 15", date: "", status: "active" },
      { title: "Bug fixing + buffer (WhatsApp API surprises)", day: "Day 16", date: "", status: "todo" },
    ],
  },

  // ===================== PRODUCT V2 — FEATURE EXPANSION =====================
  // Approved additions built on the existing stack (inspired by Whatomate).
  // Weekdays only. Effort noted per task. Scheduled from Sep 18 onward.

  {
    name: "V2.1 — Quick wins + Contacts",
    days: "Sep 18–23",
    tasks: [
      { title: "In-builder activate toggle (publish → activate → test loop)  · 0.5d", day: "Day 17", date: "Sep 18, 2026", status: "done" },
      { title: "Contacts model + CRUD API (name, phone, tags)  · 1.5d", day: "Day 17", date: "", status: "active" },
      { title: "Contacts frontend page (list/add/edit/delete/import)  · 1.5d", day: "Day 18", date: "", status: "todo" },
    ],
  },
  {
    name: "V2.2 — Templates + AI node",
    days: "Sep 24–30",
    tasks: [
      { title: "Template model + Meta template CRUD + approval status sync  · 2d", day: "Day 19", date: "", status: "todo" },
      { title: "Send template via WhatsApp adapter (outside 24h window)  · 1d", day: "Day 20", date: "", status: "todo" },
      { title: "Template management UI  · 1d", day: "Day 21", date: "", status: "todo" },
      { title: "AI response node: executor + provider integration (OpenAI)  · 2d", day: "Day 22", date: "", status: "todo" },
      { title: "AI node builder UI + config (prompt, provider, variable)  · 1d", day: "Day 23", date: "", status: "todo" },
    ],
  },
  {
    name: "V2.3 — Campaigns + Analytics",
    days: "Oct 1–9",
    tasks: [
      { title: "Job queue setup (BullMQ + Redis) for batched sends  · 1d", day: "Day 24", date: "", status: "todo" },
      { title: "Campaign model + create/schedule + contact targeting  · 2d", day: "Day 25", date: "", status: "todo" },
      { title: "Campaign runner: batching, rate limits, retry, status  · 2d", day: "Day 26", date: "", status: "todo" },
      { title: "Campaign UI (create, pick template + contacts, track)  · 2d", day: "Day 27", date: "", status: "todo" },
      { title: "Analytics dashboard (messages, delivery, campaign perf)  · 2d", day: "Day 28", date: "", status: "todo" },
    ],
  },
  {
    name: "V2.4 — Agent Inbox (live chat)",
    days: "Oct 12–21",
    tasks: [
      { title: "WebSocket infra (Socket.io) for real-time messaging  · 2d", day: "Day 29", date: "", status: "todo" },
      { title: "Human-handoff node + conversation takeover state  · 2d", day: "Day 30", date: "", status: "todo" },
      { title: "Agent inbox UI (live conversation list + chat)  · 3d", day: "Day 31", date: "", status: "todo" },
      { title: "Canned responses / slash commands  · 2d", day: "Day 32", date: "", status: "todo" },
    ],
  },
];
