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
      { title: "Contacts model + CRUD API (name, phone, tags)  · 1.5d", day: "Day 17", date: "Sep 18, 2026", status: "done" },
      { title: "Contacts frontend page (list/add/edit/delete/import)  · 1.5d", day: "Day 18", date: "Sep 18, 2026", status: "done" },
    ],
  },
  {
    name: "V2.2 — Templates + AI node",
    days: "Sep 24–30",
    tasks: [
      { title: "AI response node: executor + provider integration (Gemini)  · 2d", day: "Day 22", date: "Sep 22, 2026", status: "done" },
      { title: "AI node builder UI + config (prompt, variable, fallback, send toggle)  · 1d", day: "Day 23", date: "Sep 22, 2026", status: "done" },
      { title: "Template model + Meta template CRUD + approval status sync  · 2d", day: "Day 19", date: "", status: "todo" },
      { title: "Send template via WhatsApp adapter (outside 24h window)  · 1d", day: "Day 20", date: "", status: "todo" },
      { title: "Template management UI  · 1d", day: "Day 21", date: "", status: "todo" },
    ],
  },

  // ===================== MANAGER CHANGE REQUEST (Builder overhaul) =====================
  // Add-on requested mid-roadmap: 16 builder/engine enhancements. Grouped into
  // batches by risk/scope. Building today with end-to-end testing per feature.
  {
    name: "V2.CR Batch A — Builder UX",
    days: "Sep 22",
    tasks: [
      { title: "#8 Remove End node (palette + validator no longer requires it)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#3 Editable node names (side-panel name field, shown on card)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#4 Auto-focus + select node when added (pan/zoom to new node)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#6 Connect-to-node dropdown (wires edge to chosen node)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#13 Delay node max timeout (clamp to 86400s, shown in UI)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#14 Node search + auto-focus (search by name/type/id, jump+highlight)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#15 Show connected node for buttons/list options (card + panel)", day: "CR", date: "Sep 22, 2026", status: "done" },
    ],
  },
  {
    name: "V2.CR Batch B — Builder + schema",
    days: "Sep 22",
    tasks: [
      { title: "#2 Workflow Variables (modal add/view: name, type, default; seeded at runtime)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#16 Start node keywords & trigger conditions (contains/exact/starts_with)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#12 Send Message header/body/footer + media preview (builder + test chat)", day: "CR", date: "Sep 22, 2026", status: "done" },
      { title: "#10 Buttons in Send Message: CTA (branch) or Visit URL (link); Buttons node removed", day: "CR", date: "Sep 22, 2026", status: "done" },
    ],
  },
  {
    name: "V2.CR Batch C — New nodes + engine",
    days: "Sep 23",
    tasks: [
      { title: "#5 Input Type node (text/number/email/phone/media/location + validation + retry)", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "#7.1 Validation code node (JS expression / regex, pass/fail paths, vm sandbox)", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "#7.2 Transform code node (JS variable manipulation → output var)", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "#9 API node (methods, headers, query, body, response mapping) + timeout", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "#1 Global API integration/config (workflow-level, reusable in API nodes)", day: "CR", date: "Sep 23, 2026", status: "done" },
    ],
  },
  {
    name: "V2.CR Enhancements — Builder polish & UX",
    days: "Sep 22–23",
    tasks: [
      { title: "Question node: validation type (phone/email/url/number/alphanumeric/custom) + retry limit + failure msg", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "No-reply fallback on waiting nodes (timeout ≤10min → message/goto) + setInterval sweeper", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "Reusable variable UX: VariableTextInput (toolbar + {{var}} insert) & VariableSelect across all fields", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "Tree-style smoothstep edges + edge labels (button/branch names) + dagre auto-layout (vertical/horizontal)", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "Node card redesign (colored type headers + icons), clickable publish errors (name + focus)", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "API body JSON validity hint, brace-stripping on var names, hide React Flow attribution", day: "CR", date: "Sep 23, 2026", status: "done" },
      { title: "Migrated DB to Supabase (baselined existing schema, EPERM/lock fix)", day: "CR", date: "Sep 23, 2026", status: "done" },
    ],
  },
  {
    name: "V2.CR Batch D — Infrastructure (next)",
    days: "Sep 24",
    tasks: [
      { title: "#11 Auto-save (localStorage immediate + DB sync every 30s, change-detect + retry)", day: "CR", date: "", status: "todo" },
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
