# WA AI Tool — Build Log & Technical Progress

> **Living document.** This file is updated every time a feature is completed.
> For a visual, at-a-glance status board, open `progress/index.html`. This
> file is the detailed technical companion — what each piece actually does,
> how it works, and any decisions/gotchas worth remembering.

**Last updated:** Sep 17, 2026
**Current phase:** V2.1 — Feature Expansion (Contacts)

---

## 1. Project summary

WA AI Tool is a visual, no-code builder for WhatsApp chatbots, backed by a
generic workflow execution engine. Users design a flow on a drag-and-drop
canvas (React Flow), publish it, and it runs live against WhatsApp's Cloud
API — tracking each end-user's position in the conversation and the data
they've provided.

Two independent apps in one repo:
- **`backend/`** — Express + TypeScript API, the runtime engine, Prisma/Postgres, WhatsApp adapter.
- **`frontend/`** — Next.js (App Router) UI.

They communicate only over HTTP. The frontend never sees the database or any
WhatsApp secret.

---

## 2. Original MVP scope (Phases 0–5)

Delivered in ~14 working days (Sep 1 – Sep 16, 2026). This was the baseline
product before the manager-approved "V2" feature expansion.

### Phase 0 — Foundation (Sep 1–2)
- Monorepo layout, Docker Compose for Postgres, root config files.
- Express + TypeScript backend skeleton with a `/health` endpoint.
- Full Prisma schema written and migrated (see §3).
- Next.js frontend app shell.
- Verified the whole stack runs end-to-end locally.

### Phase 1 — Auth, Chatbots, WhatsApp config (Sep 3–8)
- Password hashing (bcrypt) + JWT sign/verify helpers.
- Auth service: register + login (`backend/src/modules/auth/`).
- Auth routes with Zod validation.
- `requireAuth` middleware — protects routes, attaches `req.userId`.
- Chatbot CRUD: create, rename, delete, activate/deactivate — always scoped
  to `ownerId` so users can only touch their own chatbots
  (`backend/src/modules/chatbots/`).
- WhatsApp `Connection` settings: businessName/phoneNumber/etc. are
  safe-to-display; accessToken/appSecret/verifyToken are backend-only and
  stripped from every API response (`backend/src/modules/whatsapp/connection/`).
- Frontend: login page, chatbot list, settings page, base styling (Tailwind + daisyUI).

### Phase 2 — Workflow Builder (Sep 9–11)
- React Flow canvas with a node palette (add nodes by clicking a button in
  the sidebar).
- Custom node component: shows type + sequence number (`#seq`), has
  source/target handles for edges, per-node delete button.
- Backend draft service: `GET/PUT /api/chatbots/:id/workflow/draft` —
  save/load the in-progress graph as JSON.
- Frontend serializes the React Flow graph (nodes + edges + positions) to the
  saved JSON shape and back, with round-trip tested.

### Phase 3 — Validation, Publish, Versioning (Sep 10–11)
- Workflow validator: schema checks (every node has required config) +
  graph checks (exactly one START, no orphan nodes, no dangling edges, no
  cycles reachable from a required-input node, etc.).
- Publish service: runs the validator; if valid, snapshots the draft as an
  immutable `WorkflowVersion` row (`status: PUBLISHED`, incrementing
  `version` number) and sets it as the chatbot's `activeVersionId`.
- `POST /api/chatbots/:id/workflow/publish` route + a Publish button in the
  builder toolbar that shows validation errors inline if publish fails (422).
- Confirmed drafts and published versions are fully independent — editing
  after publishing doesn't touch the live version until you publish again.

### Phase 4 — Runtime Engine (Sep 11–14)
This is the heart of the product. Lives in `backend/src/modules/runtime/`.

- **Types** (`types.ts`): `WorkflowDefinition`, `ExecutionContext` (userId,
  variables, incomingText, messaging adapter), `MessagingAdapter` interface
  (`sendText`, `sendButtons`, `sendList`).
- **Executors** (`executors.ts`): one function per node type —
  `START`, `SEND_MESSAGE`, `ASK_INPUT`, `CONDITION`, `SET_VARIABLE`, `WAIT`,
  `END` — registered in a lookup map keyed by `nodeType`. Each executor
  receives the node config + context and returns which edge/handle to follow
  next (or signals "pause here, waiting for input").
- **Engine loop** (`engine.ts`): given a workflow definition, a starting node
  id, and a context, walks the graph node-by-node, calling the right
  executor, following edges (respecting `sourceHandle` for branches), until
  it either reaches an `END` node (`status: "completed"`) or hits a node that
  needs user input (`status: "waiting"`, records `pausedAtNodeId`).
- **Messaging adapters** (`backend/src/modules/messaging/`):
  - `ConsoleAdapter` — logs to console / captures messages in-memory
    (`adapter.sent`). Used for web-based testing.
  - `WhatsAppAdapter` — sends real text + interactive (buttons/list) messages
    via the Meta Graph API using a chatbot's stored `Connection` credentials.
  - `LoggingAdapter` (added in logging work, §Phase 5) — wraps any adapter,
    persists every outbound message to the `Message` table.
- **Conversation persistence** (`backend/src/modules/conversations/service.ts`,
  function `handleInboundMessage`) — the glue between "a message arrived" and
  "the engine ran":
  1. Loads the chatbot + its active published `WorkflowVersion`. If the
     chatbot isn't active or has no published version, returns early
     (`chatbot_inactive` / `no_published_version`).
  2. Finds or creates the `Conversation` row for this `(chatbotId, waUserId)` pair.
  3. If the conversation already completed, don't reprocess.
  4. Rebuilds the `ExecutionContext` from the conversation's saved
     `variables`, wraps the messaging adapter in a `LoggingAdapter`.
  5. Resumes from `conversation.currentNodeId`, or starts fresh from the
     `START` node if this is the first message.
  6. Runs the engine, then saves `currentNodeId`, `variables`, and `status`
     (`ACTIVE` / `WAITING_FOR_INPUT` / `COMPLETED` / `FAILED`) back to the row.
  7. Wraps the whole run in an `Execution` log row (RUNNING → COMPLETED/FAILED,
     with start/end node ids and timing).
- **Webhook receiver** (`backend/src/modules/whatsapp/webhook/`):
  - `GET` handler implements Meta's verification handshake (echoes the
    challenge if the verify token matches).
  - `POST` handler normalizes Meta's inbound payload shape into
    `(chatbotId, waUserId, text)` and calls `handleInboundMessage`.

### Phase 4.5 — Interactive Nodes (bonus, Sep 15)
- `BUTTONS` (up to 3 options) and `LIST` (up to 10 rows) node types — new
  palette entries, custom node handles per option so each button/row can
  branch to a different next node.
- Config panel UI for managing button/list options (add/edit/remove, capped).
- Executors for both, branching by which option the user picked.
- WhatsApp adapter sends these as real Meta interactive message payloads.
- Per-node delete (✕ button on the node + in the config panel) and edge
  deletion.

### Phase 5 — Integration, Test, Polish (Sep 15–16, ongoing)
- **Builder test panel** — a floating chat widget in the builder for trying
  out a flow with tappable buttons, live in the canvas page.
- **UI polish** — landing page, a branded daisyUI theme, dashboard layout.
- **Execution + message logging + conversations view** (Sep 16):
  - `LoggingAdapter` — decorator around any `MessagingAdapter` that persists
    every outbound message to `Message` before/while sending.
  - `handleInboundMessage` logs the inbound message too, and creates/updates
    an `Execution` row per run (see Phase 4 above — this was added here).
  - Read API: `GET /api/chatbots/:id/conversations` (list, newest activity
    first) and `GET /api/chatbots/:id/conversations/:conversationId` (one
    conversation + full ordered message history).
  - Frontend conversations page (`/chatbots/[id]/conversation`) — two-panel
    master-detail: conversation list on the left (status badges), selected
    conversation's chat-bubble message history + collected variables on the
    right.
  - "Chats" link added to each chatbot card.
- **Real WhatsApp end-to-end** — ⏳ blocked on Meta Business/WhatsApp
  credentials arriving. Everything on our side (webhook, adapter, logging) is
  built and ready; this task is to actually connect a live number and verify
  the webhook + send/receive against Meta once credentials exist.

#### Notable bug found & fixed during Phase 5
**Web-based testing was fully rebuilt to use the real production path**, so
the product can be tested and demoed on the web with zero WhatsApp
credentials, per manager request. Originally the builder's test panel ran a
separate, throwaway in-memory `testStep` function that never touched the
database — meaning nothing showed up in the conversations view. Fixed by
routing `POST /api/chatbots/:id/workflow/test` through the *real*
`handleInboundMessage` function (same path the WhatsApp webhook uses) with a
`ConsoleAdapter` capturing the replies, keyed by a per-session `testUserId`.

While implementing this, two duplicate/broken `/test` route definitions were
found (a copy-paste artifact) that were both silently still calling the old
`testStep`, causing the panel to go blank when the chatbot wasn't yet
published + active — instead of showing a helpful message. Fixed by:
- Consolidating to a single `/test` route using `handleInboundMessage`.
- Standardizing the backend's returned status strings to snake_case
  (`chatbot_inactive`, `no_published_version`, `conversation_completed`) and
  matching them exactly in the frontend.
- Making the panel never go silently blank — it now always shows a message
  (either the bot's reply, "publish and activate first", or "no reply
  produced") so failures are visible instead of confusing.

Verified end-to-end via a scripted API test: publish → activate → chat two
turns → confirmed a real `Conversation` row was created, `variables.name`
was captured, the `CONDITION` branch was followed correctly, and all 4
messages (2 inbound, 2 outbound) were logged in order.

**In-builder Activate toggle** (Sep 18) — added an Activate/Deactivate button
directly in the builder toolbar next to Publish, so the full
publish → activate → test loop happens without leaving the builder page.
Previously you had to go to the chatbots list to activate, which was the
direct cause of the "blank test panel" confusion above (bot was published
but not active).

---

## 3. Database schema (Prisma)

`backend/prisma/schema.prisma`. All models, in dependency order:

| Model | Purpose |
|---|---|
| `User` | Basic auth. `email`, `passwordHash`, `name`. Owns chatbots and contacts. |
| `Chatbot` | Top-level container. `isActive` + `activeVersionId` control whether the runtime will process messages for it. Owned by a `User`. |
| `WorkflowVersion` | A workflow definition (`definition: Json` = the node/edge graph). `status: DRAFT \| PUBLISHED`. Published versions are immutable and numbered per chatbot. |
| `Connection` | WhatsApp config for one chatbot. Safe fields (businessName, phoneNumber, phoneNumberId, wabaId, status) vs. secret fields (accessToken, appId, appSecret, verifyToken) — secrets never leave the backend. |
| `Conversation` | Runtime state for one WhatsApp user talking to one chatbot. `currentNodeId`, `variables` (JSON), `status`. Unique per `(chatbotId, waUserId)`. Pinned to the `WorkflowVersion` it started on. |
| `Message` | Log of every inbound/outbound message. `direction`, `messageType`, `content` (JSON payload), plus fields reserved for Meta status webhooks (`waMessageId`, `status`). |
| `Execution` | Log of one engine run (one webhook-arrived-and-processed cycle). `status: RUNNING \| COMPLETED \| FAILED`, start/end node ids, timing. |
| `Contact` | Lightweight CRM contact: `name`, `phone`, `tags: String[]`, `notes`. Unique `(ownerId, phone)`. Owned by a `User`. Added in V2.1 as the foundation for future bulk campaigns. |

Enums: `WorkflowStatus`, `ConnectionStatus`, `ConversationStatus`,
`MessageDirection`, `ExecutionStatus`.

Design rule kept throughout: **relational tables manage ownership, lifecycle,
and runtime state; the workflow graph itself is JSON**, not spread across
many node/edge tables. This keeps the builder <-> engine <-> DB round trip
simple.

---

## 4. Backend module map

`backend/src/modules/`

| Module | Responsibility |
|---|---|
| `auth/` | Register/login, password hashing, JWT, `requireAuth` middleware. |
| `chatbots/` | Chatbot CRUD, ownership checks, activate/deactivate. |
| `workflows/` | Draft save/load, validator, publish/versioning, web-test endpoint. |
| `runtime/` | The engine core: `types.ts`, `executors.ts`, `engine.ts`. Framework-agnostic — no Express/Prisma imports. |
| `messaging/` | `MessagingAdapter` interface + implementations: `ConsoleAdapter`, `WhatsAppAdapter`, `LoggingAdapter`. |
| `conversations/` | `handleInboundMessage` (the runtime <-> DB glue) + read endpoints for the conversations UI. |
| `whatsapp/connection/` | WhatsApp `Connection` settings CRUD (secrets backend-only). |
| `whatsapp/webhook/` | Meta webhook verification (`GET`) + inbound message receiver (`POST`). |
| `contacts/` | Contact CRUD, scoped per user. New in V2.1. |

All routers are mounted in `backend/src/app.ts`.

---

## 5. Frontend page map

`frontend/src/app/`

| Route | Purpose |
|---|---|
| `/login` | Auth page (register/login). |
| `/chatbots` | Chatbot list/dashboard — create, Build/Chats/Settings links per card. |
| `/chatbots/[id]/builder` | The React Flow canvas: node palette, config panel, Save draft / Publish / Activate toolbar, floating test-chat widget. |
| `/chatbots/[id]/settings` | WhatsApp connection settings form. |
| `/chatbots/[id]/conversation` | Conversation history viewer — list + message thread + collected variables. |

---

## 6. What's NOT built yet (by design, deferred from MVP)

These were explicitly out of scope for the MVP and are candidates for later
V2 phases (see §7): multi-tenant/org isolation, roles & permissions,
real-time human agent inbox, template management, bulk campaigns, canned
responses, voice/IVR, AI-generated responses, analytics dashboard,
keyword-only auto-replies (non-flow).

---

## 7. V2 — Feature Expansion (approved, in progress)

Manager-approved addition, inspired by reviewing the open-source
[Whatomate](https://github.com/shridarpatil/whatomate) project as a reference
for platform features. Whatomate is a separate Go/Vue product and cannot be
"integrated" directly — instead, the valuable features are being rebuilt
natively on this stack, in priority order (highest value / lowest effort
first). Full comparison table and reasoning discussed Sep 17.

### V2.1 — Quick wins + Contacts (Sep 18–23)
- [x] In-builder Activate toggle (Sep 18)
- [ ] Contacts model + CRUD API — **in progress**. Model + migration done
      (`Contact` table live). Service (`backend/src/modules/contacts/service.ts`)
      done: `createContact`, `listContacts`, `updateContact`, `deleteContact`,
      all scoped by `ownerId`. Routes (`backend/src/modules/contacts/routes.ts`)
      done and mounted at `/api/contacts` (top-level, not nested under a
      chatbot, since contacts belong to the user). Verified compiling; next
      step is a live end-to-end test against the database.
- [ ] Contacts frontend page (list/add/edit/delete/import)

### V2.2 — Templates + AI node (Sep 24–30, planned)
- [ ] Meta-approved WhatsApp template management (CRUD + approval sync + send)
- [ ] Template management UI
- [ ] AI response node (OpenAI first) — new executor + node type, fits the
      existing node-based builder as a single new node kind
- [ ] AI node builder UI (prompt/provider/variable config)

### V2.3 — Campaigns + Analytics (Oct 1–9, planned)
- [ ] Job queue (BullMQ + Redis) for batched, rate-limited sends
- [ ] Campaign model + scheduling + contact targeting (depends on Contacts + Templates)
- [ ] Campaign runner (batching, retry, delivery status)
- [ ] Campaign UI
- [ ] Analytics dashboard (reads existing Message/Execution logs)

### V2.4 — Agent Inbox / live chat (Oct 12–21, planned)
- [ ] WebSocket infra (Socket.io)
- [ ] Human-handoff node + conversation takeover state
- [ ] Agent inbox UI (live conversation list + chat)
- [ ] Canned responses / slash commands

**Explicitly deferred / not planned** (invasive or out of scope):
multi-tenant organizations, granular RBAC (would require reworking the
single-owner model everywhere), voice calling & IVR (separate domain
entirely).

---

## 8. Known gotchas / lessons learned (worth remembering)

- **Route ordering in Express matters.** Two `router.post("/test", ...)`
  definitions in the same file silently means only the *first* one ever runs
  — the second is dead code. Caught this via testing, not code review; always
  verify with an actual request when rewiring a route.
- **Status strings must match exactly between backend and frontend.** A
  backend returning `"chatbot inactive"` (space) and a frontend checking for
  `"chatbot_inactive"` (underscore) fails silently — no error, just a blank
  UI. Standardized on snake_case for all status strings returned by
  `handleInboundMessage`.
- **Published ≠ Active.** Publishing creates an immutable version; activating
  flips `chatbot.isActive` so the runtime will actually process messages for
  it. Both are required before the real (or web-test) message path will
  respond. This tripped up testing once before the in-builder Activate
  toggle existed.
- **`updateMany`/`deleteMany` for ownership-scoped mutations.** Since Prisma's
  plain `update`/`delete` require a unique field, and we filter by both `id`
  AND `ownerId` together, the pattern across the codebase is
  `updateMany`/`deleteMany` with a `{ count }` check, then a follow-up
  `findFirst` if you need the updated row back.
- **Prisma unique constraint errors surface as `err.code === "P2002"`.** Used
  in the contacts routes to turn a duplicate-phone insert into a friendly 409
  instead of a generic 500.

---

## 9. How to keep this file updated

When a task moves from `todo`/`active` to `done` in
`progress/progress-data.js`, add a short entry here under the relevant phase
describing **what was built, where it lives, and anything non-obvious about
how it works or why it was done that way.** Bug fixes and gotchas worth
remembering for later go in §8. Keep the "Last updated" date at the top current.
