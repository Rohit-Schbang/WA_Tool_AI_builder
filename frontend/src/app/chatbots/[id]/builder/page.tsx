"use client";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  ConnectionMode,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { WorkFlowNode } from "./workflow.Node";
import { DeletableEdge } from "./DeletableEdge";
import { TestPanel } from "./testPanel";
import { VariableTextInput, VariableSelect, NoReplyFallback } from "./VariableInputs";
import { layoutGraph } from "./autoLayout";
import { useAutoSave, readLocalDraft, clearLocalDraft } from "./useAutoSave";

// Map React Flow node type name -> our custom component.
const nodeTypes = { workflow: WorkFlowNode };

// Custom edge with an inline ✕ delete button (no browser confirm).
const edgeTypes = { deletable: DeletableEdge };

// END removed (#8): a flow terminates naturally at a node with no outgoing edge.
// BUTTONS removed (#10): reply buttons are now part of the Send Message node.
const NODE_TYPES = [
  "SEND_MESSAGE",
  "ASK_INPUT",
  "LIST",
  "CONDITION",
  "AI_RESPONSE",
  "SET_VARIABLE",
  "TRANSFORM",
  "API_REQUEST",
  "WAIT",
] as const;

type WorkflowNodeType = (typeof NODE_TYPES)[number];

// #2 — a workflow-level declared variable.
interface WorkflowVariable {
  name: string;
  type: "text" | "number" | "boolean";
  default: string;
}

const VARIABLE_TYPES = ["text", "number", "boolean"] as const;

// #1 — a reusable global API configuration.
interface ApiEndpoint {
  id: string;
  name: string;
  method: string;   // GET | POST | PUT | PATCH | DELETE
  path: string;     // relative to baseUrl, supports {{vars}}
  body?: string;    // request body template, supports {{vars}}
}
interface ApiConfig {
  name: string;
  baseUrl: string;
  headers: { key: string; value: string }[];
  endpoints?: ApiEndpoint[];
}

// Human-friendly default names per type (#3).
const TYPE_LABEL: Record<string, string> = {
  START: "Start",
  SEND_MESSAGE: "Send Message",
  ASK_INPUT: "Question",
  BUTTONS: "Buttons",
  LIST: "List",
  CONDITION: "If / Else",
  AI_RESPONSE: "AI Reply",
  SET_VARIABLE: "Set Variable",
  TRANSFORM: "Custom Code",
  API_REQUEST: "API Request",
  WAIT: "Delay",
};

// #13 — maximum delay a WAIT node may specify (in seconds). 24h.
const MAX_DELAY_SECONDS = 86400;

// Palette grouping for the node library sidebar. Every entry still calls
// addNode(type); this only organises the existing NODE_TYPES into sections
// and gives each a Phosphor-ish icon + accent color to match the new design.
const PALETTE_GROUPS: {
  label: string;
  items: { type: WorkflowNodeType; icon: string; accent: string }[];
}[] = [
  {
    label: "Triggers & Input",
    items: [
      { type: "ASK_INPUT", icon: "ph-chat-circle-dots", accent: "bg-emerald-100 text-emerald-700" },
    ],
  },
  {
    label: "Messages & AI",
    items: [
      { type: "SEND_MESSAGE", icon: "ph-paper-plane-right", accent: "bg-blue-100 text-blue-700" },
      { type: "AI_RESPONSE", icon: "ph-sparkle", accent: "bg-indigo-100 text-indigo-700" },
      { type: "LIST", icon: "ph-list-bullets", accent: "bg-sky-100 text-sky-700" },
    ],
  },
  {
    label: "Routing & Logic",
    items: [
      { type: "CONDITION", icon: "ph-git-fork", accent: "bg-amber-100 text-amber-700" },
      { type: "WAIT", icon: "ph-clock-countdown", accent: "bg-amber-100 text-amber-700" },
    ],
  },
  {
    label: "Data & Integrations",
    items: [
      { type: "SET_VARIABLE", icon: "ph-database", accent: "bg-purple-100 text-purple-700" },
      { type: "TRANSFORM", icon: "ph-arrows-left-right", accent: "bg-purple-100 text-purple-700" },
      { type: "API_REQUEST", icon: "ph-cloud-arrow-up", accent: "bg-rose-100 text-rose-700" },
    ],
  },
];

// Nodes that branch via their own labeled handles (per-option or true/else),
// so a plain "Connect to node" would be ambiguous for them. Send Message is
// multi-output only when it has reply buttons configured (#10).
// Check whether an API body would be valid JSON once {{vars}} are filled in.
// We substitute each {{x}} with a quoted sample string, then try JSON.parse.
// This catches the classic mistake of {"name": {{v}}} (unquoted value).
function checkBodyJson(body: string): { ok: boolean; hint?: string } {
  const trimmed = (body ?? "").trim();
  if (!trimmed) return { ok: true };
  // Replace placeholders with a BARE token (no quotes). This way:
  //   "name": "{{v}}"  -> "name": "sample"  (valid — var was quoted)
  //   "name": {{v}}    -> "name": sample    (invalid — var was NOT quoted)
  // which correctly flags only the unquoted-value mistake.
  const filled = trimmed.replace(/\{\{\s*\w+\s*\}\}/g, "sample");
  try {
    JSON.parse(filled);
    return { ok: true };
  } catch {
    // Heuristic: if there's an unquoted {{var}} value, suggest quoting it.
    if (/:\s*\{\{\s*\w+\s*\}\}/.test(trimmed)) {
      return { ok: false, hint: 'Wrap variable values in quotes, e.g. "name": "{{f_name}}"' };
    }
    return { ok: false, hint: "This doesn't look like valid JSON." };
  }
}

// Canonicalize a workflow definition (from the server or a local draft) down
// to just the meaningful, comparable fields in a stable order. Used to decide
// whether a local draft really differs from the server copy — comparing raw
// JSON is unreliable because key ordering / incidental fields differ.
function normalizeDefinition(def: any): string {
  if (!def) return "";
  const norm = {
    variables: def.variables ?? [],
    apiConfigs: def.apiConfigs ?? [],
    nodes: (def.nodes ?? [])
      .map((n: any) => ({
        id: n.id,
        nodeType: n.nodeType ?? n.data?.nodeType,
        position: { x: Math.round(n.position?.x ?? 0), y: Math.round(n.position?.y ?? 0) },
        config: n.config ?? n.data?.config ?? {},
      }))
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))),
    edges: (def.edges ?? [])
      .map((e: any) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      }))
      .sort((a: any, b: any) =>
        `${a.source}-${a.sourceHandle}-${a.target}`.localeCompare(`${b.source}-${b.sourceHandle}-${b.target}`)
      ),
  };
  try {
    return JSON.stringify(norm);
  } catch {
    return "";
  }
}

function isMultiOutput(node: { nodeType: string; config?: any }) {
  if (["CONDITION", "API_REQUEST", "LIST"].includes(node.nodeType)) return true;
  // Send Message is multi-output only when it has CTA (branching) buttons.
  if (node.nodeType === "SEND_MESSAGE") {
    const ctaCount = (node.config?.buttons ?? []).filter((b: any) => (b.kind ?? "cta") === "cta").length;
    return ctaCount > 0;
  }
  return false;
}

const initialNodes: Node[] = [
  {
    id: "start",
    position: { x: 300, y: 40 },
    type: "workflow",
    data: { nodeType: "START", config: {}, seq: 0 },
  },
];

const initialEdges: Edge[] = [];

function makeId() {
  return "n_" + Math.random().toString(36).slice(2, 9);
}

function BuilderInner() {
  // ---------------------- STATE ----------------------
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState("");
  // Whether the flow has unpublished changes; gates the Publish button. This is
  // derived by comparing the current serialized definition to the baseline
  // captured at load / after a successful save or publish, so React Flow's
  // internal measurement changes on mount don't falsely mark the flow dirty.
  const [dirtySincePublish, setDirtySincePublish] = useState(false);
  const publishedBaselineRef = useRef<string>("");
  const [isActive, setIsActive] = useState(false);
  const [activating, setActivating] = useState(false);
  const [publishErrors, setPublishErrors] = useState<{ message: string; nodeId?: string }[]>([]);
  const [seqCounter, setSeqCounter] = useState(1);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Draft text for the START node's "Trigger keywords" chip input.
  const [keywordDraft, setKeywordDraft] = useState("");

  // Index of the Send Message button currently being dragged (for reordering).
  const [dragBtnIdx, setDragBtnIdx] = useState<number | null>(null);

  // Result of a Custom Code (TRANSFORM) test run in the config panel.
  const [codeTestResult, setCodeTestResult] = useState<{ ok: boolean; value: string } | null>(null);
  // Custom Code expression textarea ref + variable-insert dropdown visibility.
  const codeExprRef = useRef<HTMLTextAreaElement>(null);
  const [showCodeVars, setShowCodeVars] = useState(false);

  // #14 — search box state
  const [search, setSearch] = useState("");
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);

  // #2 — workflow-level variables { name, type, default }
  const [variables, setVariables] = useState<WorkflowVariable[]>([]);
  const [showVarList, setShowVarList] = useState(false);   // "View variables" modal
  const [showVarAdd, setShowVarAdd] = useState(false);     // "Add variable" modal
  const [newVar, setNewVar] = useState<WorkflowVariable>({ name: "", type: "text", default: "" });

  // #1 — workflow-level global API configs
  const [apiConfigs, setApiConfigs] = useState<ApiConfig[]>([]);
  const [showApiCfg, setShowApiCfg] = useState(false);
  const [apiCfgSearch, setApiCfgSearch] = useState("");
  const [revealedHeaders, setRevealedHeaders] = useState<Record<string, boolean>>({});

  // #11 — pending "restore unsaved local changes?" prompt (styled modal).
  // Holds the local + server definitions and a savedAt timestamp until the
  // user chooses. null = no prompt showing.
  const [restorePrompt, setRestorePrompt] = useState<
    { localDef: any; serverDef: any; savedAt: number } | null
  >(null);

  const params = useParams();
  const chatbotId = params.id as string;

  // React Flow instance — lets us pan/zoom to a node (#4, #6, #14).
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      // Nothing may connect INTO the START node — an edge targeting START
      // creates a loop (e.g. Question -> START re-runs the flow). Block it.
      if (connection.target === "start") {
        window.alert("You can't connect a node back into the Start node.");
        return;
      }
      // A node shouldn't connect to itself.
      if (connection.source === connection.target) return;
      // The connect-anywhere overlay reports targetHandle "node-drop"; the
      // small dot reports "in-dot". Normalize both to a single incoming edge
      // (target handle null) so we never create duplicate/confusing handles.
      const normalized: Connection = {
        ...connection,
        targetHandle: null,
      };
      setEdges((eds) => addEdge({ ...normalized, type: "deletable" }, eds));
    },
    [setEdges]
  );

  // Toggle a body class while a connection is being dragged, so each node's
  // full-card invisible drop target becomes active (see globals.css). This is
  // what lets you release a connection anywhere on the target node.
  const onConnectStart = useCallback(() => {
    document.body.classList.add("rf-connecting");
  }, []);
  const onConnectEnd = useCallback(() => {
    document.body.classList.remove("rf-connecting");
  }, []);

  // Current auto-layout direction, so the Vertical/Horizontal toggle can
  // highlight the active option.
  const [layoutDir, setLayoutDir] = useState<"TB" | "LR">("TB");

  // Auto-layout the graph into a clean tree using dagre (#tree layout).
  const autoLayout = useCallback((direction: "TB" | "LR") => {
    setLayoutDir(direction);
    const laid = layoutGraph(nodes, edges, direction);
    setNodes(laid);
    // Re-fit after positions update.
    setTimeout(() => rfRef.current?.fitView({ duration: 600, padding: 0.2 }), 50);
  }, [nodes, edges, setNodes]);

  // ---------------------- FOCUS A NODE (#4/#6/#14) ----------------------
  const focusNode = useCallback((id: string) => {
    setSelectedId(id);
    // pan/zoom the canvas to center the node
    const rf = rfRef.current;
    setNodes((nds) => {
      const target = nds.find((n) => n.id === id);
      if (target && rf) {
        const x = target.position.x + 90; // approx half node width
        const y = target.position.y + 40;
        rf.setCenter(x, y, { zoom: 1.2, duration: 600 });
      }
      return nds;
    });
  }, [setNodes]);

  // ---------------------- ADD NODE (#4 auto-focus) ----------------------
  const deleteNode = useCallback((id: string) => {
    setNodes((nds) => {
      const target = nds.find((n) => n.id === id);
      if (target?.data.nodeType === "START") {
        window.alert("The START node cannot be deleted.");
        return nds;
      }
      return nds.filter((n) => n.id !== id);
    });
    setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [setNodes, setEdges]);

  function addNode(nodeType: WorkflowNodeType) {
    const seq = seqCounter;
    const id = makeId();
    // Place the new node just BELOW the current bottom-most node (aligned to
    // its x), so nodes stack predictably and don't overlap. Not connected.
    const NODE_GAP_Y = 140;
    let position: { x: number; y: number };
    if (nodes.length > 0) {
      const bottom = nodes.reduce((lowest, n) =>
        (n.position?.y ?? 0) > (lowest.position?.y ?? 0) ? n : lowest, nodes[0]);
      position = {
        x: Number.isFinite(bottom.position?.x) ? bottom.position.x : 300,
        y: (Number.isFinite(bottom.position?.y) ? bottom.position.y : 40) + NODE_GAP_Y,
      };
    } else {
      position = { x: 300, y: 40 };
    }
    const newNode: Node = {
      id,
      position,
      type: "workflow",
      data: {
        nodeType,
        config: { name: `${TYPE_LABEL[nodeType] ?? nodeType} ${seq}` },
        seq,
        onDelete: deleteNode,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSeqCounter((count) => count + 1);
    // (Publish visibility is handled centrally by the change-tracking effect.)
    // auto-select + focus after the node is in the tree
    setTimeout(() => focusNode(id), 50);
  }

  // ---------------------- SERIALIZE ----------------------
  // Build the workflow definition from current state. Shared by manual save,
  // publish, and auto-save (#11) so all three persist the exact same shape.
  const buildDefinition = useCallback(() => ({
    version: 1,
    variables, // #2 — workflow-level variables
    apiConfigs, // #1 — global API configs
    nodes: nodes.map((node) => ({
      id: node.id,
      nodeType: node.data.nodeType,
      seq: node.data.seq,
      position: node.position,
      config: node.data.config ?? {},
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
    })),
  }), [nodes, edges, variables, apiConfigs]);

  // Auto-save hook (#11): localStorage immediate + 30s DB sync.
  const [autoReady, setAutoReady] = useState(false);
  const autoSave = useAutoSave(chatbotId, buildDefinition, autoReady);

  // Hydrate builder state from a definition object (server or local draft).
  const hydrateDefinition = useCallback((def: any) => {
    const loadedNodes: Node[] = (def.nodes ?? []).map((node: any, i: number) => ({
      id: node.id,
      type: "workflow",
      position: {
        x: Number.isFinite(node.position?.x) ? node.position.x : 300,
        y: Number.isFinite(node.position?.y) ? node.position.y : 40 + i * 140,
      },
      data: {
        nodeType: node.nodeType,
        config: node.config ?? {},
        seq: node.seq,
        onDelete: deleteNode,
      },
    }));
    const loadedEdges: Edge[] = (def.edges ?? []).map((edge: any) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      type: "deletable",
    }));
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    if (Array.isArray(def.variables)) setVariables(def.variables);
    if (Array.isArray(def.apiConfigs)) setApiConfigs(def.apiConfigs);
    const maxSeq = (def.nodes ?? []).reduce((m: number, n: any) => Math.max(m, n.seq ?? 0), 0);
    setSeqCounter(maxSeq + 1);
  }, [deleteNode, setNodes, setEdges]);

  // ---------------------- SAVE DRAFT ----------------------
  async function handleSave() {
    setSaving(true);
    setSavedMsg("");
    const definition = buildDefinition();
    try {
      await api.put(`/api/chatbots/${chatbotId}/workflow/draft`, { definition });
      // Keep the auto-save baseline in sync so it doesn't re-push immediately.
      autoSave.primeBaseline(definition);
      // This is now the published/saved baseline -> Publish disables until the
      // next edit.
      publishedBaselineRef.current = JSON.stringify(definition);
      setDirtySincePublish(false);
      // Persisted to the server -> local backup is redundant; clearing it
      // prevents a stale "restore unsaved changes" prompt on the next load.
      clearLocalDraft(chatbotId);
      setSavedMsg("Saved");
    } catch (error) {
      setSavedMsg("Save Failed");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------- PUBLISH ----------------------
  async function handlePublish() {
    setPublishing(true);
    setPublishMsg("");
    setPublishErrors([]);
    await handleSave();
    try {
      const response = await api.post(`/api/chatbots/${chatbotId}/workflow/publish`, {});
      setPublishMsg(`Published v${response.data.version}`);
      // Publishing consumes the current changes: disable Publish until the next
      // edit.
      const definition = buildDefinition();
      publishedBaselineRef.current = JSON.stringify(definition);
      setDirtySincePublish(false);
      // The draft is now persisted+published to the server, so the local
      // backup is redundant. Clear it and re-baseline so the "restore unsaved
      // changes" prompt doesn't reappear on the next load.
      autoSave.primeBaseline(definition);
      clearLocalDraft(chatbotId);
      // Publishing makes the bot live -> activate it so the toggle turns on
      // (and it shows as Active on the dashboard).
      if (!isActive) {
        try {
          const res = await api.patch(`/api/chatbots/${chatbotId}/activate`, { isActive: true });
          setIsActive(res.data.isActive);
        } catch {
          setIsActive(true);
        }
      }
    } catch (error: any) {
      if (error.response?.status === 422) {
        setPublishErrors(error.response.data.details ?? []);
        setPublishMsg("Fix the issues to publish");
      } else setPublishMsg("Publish Failed");
    } finally {
      setPublishing(false);
    }
  }

  // ---------------------- ACTIVATE ----------------------
  async function handleToggleActive() {
    setActivating(true);
    try {
      const res = await api.patch(`/api/chatbots/${chatbotId}/activate`, { isActive: !isActive });
      setIsActive(res.data.isActive);
    } catch (error) {
      /* ignore */
    } finally {
      setActivating(false);
    }
  }

  // ---------------------- SELECTION ----------------------
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedId(node.id);
    // Clear any Custom Code test output / open dropdown from the previous node.
    setCodeTestResult(null);
    setShowCodeVars(false);
  }, []);

  // Connect the selected node to another node (#6 — "Connect to node").
  // Creates an edge from selected -> target (single-output nodes only).
  // Max number of plain (null-handle) connections a single-output node may have.
  const MAX_CONNECTIONS = 3;

  function connectToNode(targetId: string) {
    if (!selectedId || targetId === selectedId) return;
    setEdges((eds) => {
      // Avoid duplicate identical edges.
      const exists = eds.some(
        (e) => e.source === selectedId && e.target === targetId && (e.sourceHandle ?? null) === null
      );
      if (exists) return eds;
      // Enforce the max-connections limit for plain (null-handle) edges.
      const current = eds.filter(
        (e) => e.source === selectedId && (e.sourceHandle ?? null) === null
      ).length;
      if (current >= MAX_CONNECTIONS) return eds;
      return addEdge(
        { id: makeId(), source: selectedId, target: targetId, sourceHandle: null },
        eds
      );
    });
  }

  // Remove a plain (null-handle) connection from the selected node to a target.
  function disconnectFromNode(targetId: string) {
    if (!selectedId) return;
    setEdges((eds) =>
      eds.filter(
        (e) => !(e.source === selectedId && e.target === targetId && (e.sourceHandle ?? null) === null)
      )
    );
  }

  // Connect a specific option (button/list row) of the selected node to a
  // target node. The edge's sourceHandle is the option id so it branches from
  // that option's handle on the canvas. Passing an empty targetId clears it.
  function connectOptionToNode(optionId: string, targetId: string) {
    if (!selectedId) return;
    setEdges((eds) => {
      // Remove any existing edge from this option's handle first.
      const withoutOption = eds.filter(
        (e) => !(e.source === selectedId && e.sourceHandle === optionId)
      );
      if (!targetId || targetId === selectedId) return withoutOption;
      return addEdge(
        { id: makeId(), source: selectedId, target: targetId, sourceHandle: optionId },
        withoutOption
      );
    });
  }

  const selectedNode = nodes.find((n) => n.id === selectedId);

  // Update one field inside the selected node's config.
  function updateConfig(key: string, value: any) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
          : n
      )
    );
  }

  // Update a nested object field (e.g. config.header.type, config.cta.url).
  function updateNestedConfig(objKey: string, field: string, value: any) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? {
              ...n,
              data: {
                ...n.data,
                config: {
                  ...n.data.config,
                  [objKey]: { ...(n.data.config[objKey] ?? {}), [field]: value },
                },
              },
            }
          : n
      )
    );
  }

  // ---------------------- #2 WORKFLOW VARIABLES ----------------------
  function openAddVariable() {
    setNewVar({ name: "", type: "text", default: "" });
    setShowVarAdd(true);
  }
  function saveNewVariable() {
    const name = newVar.name.trim().replace(/[{}]/g, "").trim();
    if (!name) return;
    setVariables((vs) =>
      vs.some((v) => v.name === name) ? vs.map((v) => (v.name === name ? newVar : v)) : [...vs, { ...newVar, name }]
    );
    setShowVarAdd(false);
  }
  function removeVariable(name: string) {
    setVariables((vs) => vs.filter((v) => v.name !== name));
  }
  // Create a variable by name if it doesn't already exist (used by the inline
  // "+ Add variable" / "create new" shortcuts in fields).
  function ensureVariable(name: string, type: WorkflowVariable["type"] = "text") {
    // Normalize: variable names are bare (no {{ }} braces).
    const trimmed = name.trim().replace(/[{}]/g, "").trim();
    if (!trimmed) return;
    setVariables((vs) =>
      vs.some((v) => v.name === trimmed) ? vs : [...vs, { name: trimmed, type, default: "" }]
    );
  }

  // Insert `vars.<name>` at the cursor of the Custom Code expression textarea
  // (JS form — no {{ }} braces). Falls back to appending if not focused.
  function insertCodeVariable(name: string) {
    const snippet = `vars.${name}`;
    const el = codeExprRef.current;
    const current = selectedNode?.data.config.expression ?? "";
    if (!el) {
      updateConfig("expression", current + snippet);
    } else {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + snippet + current.slice(end);
      updateConfig("expression", next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
    }
    setShowCodeVars(false);
    setCodeTestResult(null);
  }

  // ---------------------- CUSTOM CODE (TRANSFORM) TEST ----------------------
  // Evaluate a Custom Code expression against sample values (each workflow
  // variable's default), so the user can verify their code before publishing.
  // The expression is run in a restricted Function scope with only `vars`
  // available (no access to window/globals in scope). This is a client-side
  // preview; the real run happens on the backend.
  function testCustomCode(expression: string) {
    const expr = (expression ?? "").trim();
    if (!expr) {
      setCodeTestResult({ ok: false, value: "Write an expression first." });
      return;
    }
    // Build a sample `vars` object from declared variables' defaults, coerced
    // to their declared type.
    const vars: Record<string, any> = {};
    for (const v of variables) {
      const d = v.default ?? "";
      if (v.type === "number") vars[v.name] = d === "" ? 0 : Number(d);
      else if (v.type === "boolean") vars[v.name] = d === "true" || d === "1";
      else vars[v.name] = d;
    }
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function("vars", `"use strict"; return (${expr});`);
      const result = fn(vars);
      const display =
        typeof result === "object" ? JSON.stringify(result) : String(result);
      setCodeTestResult({ ok: true, value: display });
    } catch (err: any) {
      setCodeTestResult({ ok: false, value: err?.message ?? "Evaluation error" });
    }
  }

  // ---------------------- OPTIONS (BUTTONS/LIST) ----------------------
  function optionsKey(nodeType: string) {
    return nodeType === "LIST" ? "rows" : "buttons";
  }

  function addOption(max: number) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const key = optionsKey(n.data.nodeType);
        const list = n.data.config[key] ?? [];
        if (list.length >= max) return n;
        const newOpt = { id: "opt_" + Math.random().toString(36).slice(2, 8), label: "" };
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: [...list, newOpt] } } };
      })
    );
  }

  function updateOption(optId: string, label: string) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const key = optionsKey(n.data.nodeType);
        const list = (n.data.config[key] ?? []).map((o: any) =>
          o.id === optId ? { ...o, label } : o
        );
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
  }

  // Move an option (button/list row) from one index to another so users can
  // drag-and-drop to reorder them.
  function reorderOption(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const key = optionsKey(n.data.nodeType);
        const list = [...(n.data.config[key] ?? [])];
        if (
          fromIdx < 0 || fromIdx >= list.length ||
          toIdx < 0 || toIdx >= list.length
        ) {
          return n;
        }
        const [moved] = list.splice(fromIdx, 1);
        list.splice(toIdx, 0, moved);
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
  }

  // ---------------------- key/value list helpers (API node) ----------------------
  function addKeyValList(key: string) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const list = n.data.config[key] ?? [];
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: [...list, {}] } } };
      })
    );
  }
  function updateKeyValList(key: string, idx: number, field: string, value: string) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const list = (n.data.config[key] ?? []).map((item: any, i: number) =>
          i === idx ? { ...item, [field]: value } : item
        );
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
  }
  function removeKeyValList(key: string, idx: number) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const list = (n.data.config[key] ?? []).filter((_: any, i: number) => i !== idx);
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
  }

  // ---------------------- #1 GLOBAL API CONFIGS ----------------------
  function addApiConfig() {
    setApiConfigs((cs) => [...cs, { name: `api${cs.length + 1}`, baseUrl: "", headers: [] }]);
  }
  function updateApiConfig(idx: number, patch: Partial<ApiConfig>) {
    setApiConfigs((cs) => cs.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }
  function removeApiConfig(idx: number) {
    setApiConfigs((cs) => cs.filter((_, i) => i !== idx));
  }
  function addApiConfigHeader(idx: number) {
    setApiConfigs((cs) => cs.map((c, i) => (i === idx ? { ...c, headers: [...c.headers, { key: "", value: "" }] } : c)));
  }
  function updateApiConfigHeader(idx: number, hIdx: number, field: "key" | "value", value: string) {
    setApiConfigs((cs) =>
      cs.map((c, i) =>
        i === idx ? { ...c, headers: c.headers.map((h, j) => (j === hIdx ? { ...h, [field]: value } : h)) } : c
      )
    );
  }
  function removeApiConfigHeader(idx: number, hIdx: number) {
    setApiConfigs((cs) => cs.map((c, i) => (i === idx ? { ...c, headers: c.headers.filter((_, j) => j !== hIdx) } : c)));
  }

  // --- CRUD endpoints inside a global API config ---
  function addApiEndpoint(idx: number) {
    const ep: ApiEndpoint = { id: "ep_" + Math.random().toString(36).slice(2, 8), name: "", method: "GET", path: "", body: "" };
    setApiConfigs((cs) => cs.map((c, i) => (i === idx ? { ...c, endpoints: [...(c.endpoints ?? []), ep] } : c)));
  }
  function updateApiEndpoint(idx: number, epIdx: number, patch: Partial<ApiEndpoint>) {
    setApiConfigs((cs) =>
      cs.map((c, i) =>
        i === idx ? { ...c, endpoints: (c.endpoints ?? []).map((e, j) => (j === epIdx ? { ...e, ...patch } : e)) } : c
      )
    );
  }
  function removeApiEndpoint(idx: number, epIdx: number) {
    setApiConfigs((cs) => cs.map((c, i) => (i === idx ? { ...c, endpoints: (c.endpoints ?? []).filter((_, j) => j !== epIdx) } : c)));
  }

  // --- Ping a config's base URL (server-side reachability, avoids CORS) ---
  // pingState[configIndex] = "idle" | "pinging" | "up" | "down"
  const [pingState, setPingState] = useState<Record<number, "idle" | "pinging" | "up" | "down">>({});
  async function pingApiConfig(idx: number) {
    const cfg = apiConfigs[idx];
    if (!cfg?.baseUrl) return;
    setPingState((s) => ({ ...s, [idx]: "pinging" }));
    try {
      const res = await api.post(`/api/chatbots/${chatbotId}/workflow/ping`, {
        url: cfg.baseUrl,
        headers: cfg.headers,
      });
      setPingState((s) => ({ ...s, [idx]: res.data?.reachable ? "up" : "down" }));
    } catch {
      setPingState((s) => ({ ...s, [idx]: "down" }));
    }
  }

  // Update an arbitrary field on an option (e.g. kind, url) (#10).
  function updateOptionField(optId: string, field: string, value: any) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const key = optionsKey(n.data.nodeType);
        const list = (n.data.config[key] ?? []).map((o: any) =>
          o.id === optId ? { ...o, [field]: value } : o
        );
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
  }

  function removeOption(optId: string) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const key = optionsKey(n.data.nodeType);
        const list = (n.data.config[key] ?? []).filter((o: any) => o.id !== optId);
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
    setEdges((eds) => eds.filter((e) => e.sourceHandle !== optId));
  }

  function deleteSelectedNode() {
    if (selectedId) deleteNode(selectedId);
  }

  // Edge deletion is handled by the inline ✕ button on each edge
  // (see DeletableEdge). No click-to-confirm needed.

  // ---------------------- DERIVED: node display name helper ----------------------
  const nodeName = useCallback((n: Node) => {
    return n.data.config?.name?.trim() || `${TYPE_LABEL[n.data.nodeType] ?? n.data.nodeType} ${n.data.seq}`;
  }, []);

  // ---------------------- #15: option -> connected node title map ----------------------
  // Compute per-node, then inject into each choice node's data so the card can render it.
  const nodesForFlow = useMemo(() => {
    const nameById: Record<string, string> = {};
    nodes.forEach((n) => { nameById[n.id] = nodeName(n); });

    return nodes.map((n) => {
      const isChoice =
        n.data.nodeType === "BUTTONS" ||
        n.data.nodeType === "LIST" ||
        n.data.nodeType === "SEND_MESSAGE";
      let optionTargets: Record<string, string> = {};
      if (isChoice) {
        const outEdges = edges.filter((e) => e.source === n.id);
        for (const e of outEdges) {
          if (e.sourceHandle) optionTargets[e.sourceHandle] = nameById[e.target] ?? "?";
        }
      }
      // Safety net: React Flow crashes ("Received NaN for cx/cy/...") if any
      // node has a non-finite position, so coerce it to a finite value.
      const safePosition = {
        x: Number.isFinite(n.position?.x) ? n.position.x : 0,
        y: Number.isFinite(n.position?.y) ? n.position.y : 0,
      };
      return {
        ...n,
        position: safePosition,
        data: {
          ...n.data,
          onDelete: deleteNode,
          optionTargets,
          searchHighlight: n.id === searchHighlightId,
        },
      };
    });
  }, [nodes, edges, searchHighlightId, nodeName, deleteNode]);

  // Decorate edges with a label = the source option's text (button/list row),
  // so a viewer can tell which button/branch an edge originates from (#15).
  const edgesForFlow = useMemo(() => {
    // Build sourceHandle -> label lookups per node.
    const labelFor = (nodeId: string, handle: string | null | undefined): string | undefined => {
      if (!handle) return undefined;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return undefined;
      const cfg = node.data.config ?? {};
      // Branch handles have fixed labels.
      if (handle === "true") return node.data.nodeType === "API_REQUEST" ? "success" : "true";
      if (handle === "else") return node.data.nodeType === "API_REQUEST" ? "failure" : "else";
      // Option handles: match against buttons/rows.
      const opts = [...(cfg.buttons ?? []), ...(cfg.rows ?? [])];
      const opt = opts.find((o: any) => o.id === handle);
      return opt?.label || undefined;
    };
    return edges.map((e) => {
      const label = labelFor(e.source, e.sourceHandle);
      return {
        ...e,
        type: "deletable",
        label,
      };
    });
  }, [edges, nodes]);

  // ---------------------- #14: search matches ----------------------
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => {
        const name = nodeName(n).toLowerCase();
        const type = (n.data.nodeType as string).toLowerCase();
        return name.includes(q) || type.includes(q) || n.id.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [search, nodes, nodeName]);

  function goToSearchResult(id: string) {
    focusNode(id);
    setSearchHighlightId(id);
    setTimeout(() => setSearchHighlightId(null), 2000);
  }

  // ---------------------- LOAD DRAFT ----------------------
  // #11 — on any change to the persisted state, write to localStorage
  // (debounced inside the hook). Only active after initial load.
  const baselineCaptured = useRef(false);
  useEffect(() => {
    if (!autoReady) return;
    const current = JSON.stringify(buildDefinition());
    // First run after the flow is ready: capture the loaded state as the
    // baseline so Publish starts disabled (nothing to publish yet). We prime
    // the auto-save baseline from this same canonical serialization so a raw
    // server-def vs buildDefinition() shape mismatch never writes a spurious
    // local draft (which was causing the "restore unsaved changes" prompt to
    // appear even when nothing was edited).
    if (!baselineCaptured.current) {
      baselineCaptured.current = true;
      publishedBaselineRef.current = current;
      autoSave.primeBaseline(buildDefinition());
      setDirtySincePublish(false);
      return;
    }
    autoSave.touch();
    // Enable Publish only when the serialized definition actually differs from
    // the baseline. Comparing the persisted shape (not raw React Flow state)
    // avoids false positives from mount-time node measurements.
    setDirtySincePublish(current !== publishedBaselineRef.current);
  }, [nodes, edges, variables, apiConfigs, autoReady, autoSave, buildDefinition]);

  useEffect(() => {
    async function loadDraft() {
      let serverDef: any = null;
      try {
        const response = await api.get(`/api/chatbots/${chatbotId}/workflow/draft`);
        serverDef = response.data.definition;
      } catch {
        /* no server draft yet */
      }

      api.get(`/api/chatbots/${chatbotId}`)
        .then((res) => setIsActive(res.data.isActive))
        .catch(() => { });

      // #11 — recover a local draft only if it MEANINGFULLY differs from the
      // server copy (protects against an accidental refresh/close before the
      // 30s sync). We normalize both sides so incidental JSON shape/ordering
      // differences don't trigger a false "restore unsaved changes" prompt.
      const local = readLocalDraft(chatbotId);
      const serverNorm = normalizeDefinition(serverDef);
      const localNorm = local ? normalizeDefinition(local.definition) : "";

      if (local && localNorm && localNorm !== serverNorm) {
        // Show a styled modal instead of window.confirm.
        setRestorePrompt({ localDef: local.definition, serverDef, savedAt: local.savedAt });
        // Load the server copy underneath so the canvas isn't blank while asking.
        if (serverDef) hydrateDefinition(serverDef);
        return; // autoReady is set once the user chooses in the modal
      }

      // A local draft exists but doesn't meaningfully differ (e.g. a stale
      // draft written by an earlier version): drop it so it can't re-prompt.
      if (local) clearLocalDraft(chatbotId);

      if (serverDef) {
        hydrateDefinition(serverDef);
        autoSave.primeBaseline(serverDef);
      }
      setAutoReady(true);
    }
    loadDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // #11 — restore-prompt handlers.
  function handleRestoreLocal() {
    if (!restorePrompt) return;
    hydrateDefinition(restorePrompt.localDef);
    // Baseline = server copy, so the restored local changes are detected as a
    // diff and re-synced on the next tick / save.
    autoSave.primeBaseline(restorePrompt.serverDef ?? { nodes: [], edges: [] });
    // Restored local changes are genuinely unpublished: force the baseline to
    // a non-matching value so Publish is enabled.
    baselineCaptured.current = true;
    publishedBaselineRef.current = "__restored__";
    setDirtySincePublish(true);
    setSavedMsg("Restored unsaved changes");
    setRestorePrompt(null);
    setAutoReady(true);
  }
  function handleDiscardLocal() {
    clearLocalDraft(chatbotId);
    if (restorePrompt?.serverDef) autoSave.primeBaseline(restorePrompt.serverDef);
    setRestorePrompt(null);
    setAutoReady(true);
  }

  // Other nodes for the "Go To Node" dropdown (#6).
  const otherNodes = nodes.filter((n) => n.id !== selectedId);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-50 font-sans text-slate-800">
      {/* Full-width top header + toolbar (moved above the workspace) */}
      {/* Main header row */}
      <header className="h-14 bg-white border-b border-slate-200 px-4 flex items-center justify-between shrink-0 z-30">
        <div className="flex items-center space-x-2 shrink-0">
          <Link
            href="/chatbots"
            title="Back to chatbots"
            className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition active:scale-95 mr-0.5"
          >
            <i className="ph-bold ph-arrow-left text-sm" />
          </Link>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-600 to-teal-400 flex items-center justify-center text-white shadow-xs">
            <i className="ph-bold ph-chat-teardrop-dots text-base" />
          </div>
          <span className="font-extrabold text-slate-900 tracking-tight text-sm">PingFlow</span>
          <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">Cloud</span>
          <span className="text-xs font-semibold text-slate-500 ml-2 hidden md:inline">Flow Builder</span>
        </div>

        <div className="flex items-center space-x-2.5 shrink-0">
          {/* #14 — node search */}
          <div className="relative w-48 hidden lg:block">
            <i className="ph ph-magnifying-glass absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search flow..."
              className="w-full text-xs bg-slate-50 pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 text-slate-700 placeholder-slate-400 transition"
              type="text"
            />
            {searchMatches.length > 0 && (
              <ul className="absolute z-40 mt-1 w-72 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {searchMatches.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => { goToSearchResult(n.id); setSearch(""); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-xs"
                    >
                      <span className="font-medium text-slate-800">{nodeName(n)}</span>
                      <span className="text-slate-400 ml-2 text-[10px]">{n.data.nodeType}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={handleToggleActive}
            disabled={activating}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition active:scale-95 shadow-2xs disabled:opacity-60 ${
              isActive
                ? "bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100"
                : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-amber-500" : "bg-emerald-500"} ${!isActive ? "animate-pulse" : ""}`} />
            <span>{activating ? "..." : isActive ? "Deactivate" : "Activate"}</span>
          </button>

          {/* #11 — auto-save status */}
          <span
            className={`flex items-center gap-1 text-[11px] font-medium ${
              autoSave.status === "error" ? "text-rose-500"
              : autoSave.status === "syncing" ? "text-amber-500"
              : autoSave.status === "local" ? "text-slate-400"
              : "text-emerald-500"
            }`}
            title="Auto-save: changes are kept locally and synced to the server every 30s"
          >
            <i className={`ph-fill ${
              autoSave.status === "error" ? "ph-warning-circle"
              : autoSave.status === "syncing" ? "ph-cloud-arrow-up"
              : autoSave.status === "local" ? "ph-cloud"
              : "ph-cloud-check"
            } text-xs`} />
            <span>{
              autoSave.status === "error" ? "Sync failed – retrying"
              : autoSave.status === "syncing" ? "Syncing…"
              : autoSave.status === "local" ? "Unsaved (local)"
              : "All changes saved"
            }</span>
          </span>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition active:scale-95 shadow-2xs disabled:opacity-60"
          >
            <i className="ph ph-floppy-disk text-slate-400 text-sm" />
            <span>{saving ? "Saving..." : "Save Draft"}</span>
          </button>

          <button
            onClick={handlePublish}
            disabled={publishing || !dirtySincePublish}
            title={!dirtySincePublish ? "No changes to publish" : undefined}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-xs font-semibold text-white transition active:scale-95 shadow-sm shadow-brand-600/30 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-brand-600 disabled:active:scale-100"
          >
            <i className="ph-bold ph-paper-plane-tilt text-xs" />
            <span>{publishing ? "Publishing..." : "Publish"}</span>
          </button>
        </div>
      </header>

      {/* Secondary toolbar */}
      <div className="h-11 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 flex items-center justify-between z-20 shrink-0 text-xs">
        <div className="flex items-center space-x-3">
          <div className="flex items-center bg-slate-100/80 p-0.5 rounded-lg border border-slate-200/70">
            <button
              onClick={() => autoLayout("TB")}
              className={`px-2.5 py-1 rounded-md flex items-center space-x-1.5 transition text-xs ${
                layoutDir === "TB"
                  ? "bg-white font-semibold text-slate-900 shadow-2xs"
                  : "font-medium text-slate-500 hover:text-slate-800"
              }`}
              title="Arrange vertically"
            >
              <i className={`ph-bold ph-arrows-down-up text-xs ${layoutDir === "TB" ? "text-brand-600" : "text-slate-400"}`} />
              <span>Vertical</span>
            </button>
            <button
              onClick={() => autoLayout("LR")}
              className={`px-2.5 py-1 rounded-md flex items-center space-x-1.5 transition text-xs ${
                layoutDir === "LR"
                  ? "bg-white font-semibold text-slate-900 shadow-2xs"
                  : "font-medium text-slate-500 hover:text-slate-800"
              }`}
              title="Arrange horizontally"
            >
              <i className={`ph ph-arrows-left-right text-xs ${layoutDir === "LR" ? "text-brand-600" : "text-slate-400"}`} />
              <span>Horizontal</span>
            </button>
          </div>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setShowVarList(true)}
              className="px-2.5 py-1 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition flex items-center space-x-1.5 text-xs"
            >
              <i className="ph ph-brackets-curly text-brand-600 text-sm" />
              <span>Variables ({variables.length})</span>
            </button>
            <button
              onClick={() => setShowApiCfg(true)}
              className="px-2.5 py-1 rounded-lg font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition flex items-center space-x-1.5 text-xs"
            >
              <i className="ph ph-plugs-connected text-brand-600 text-sm" />
              <span>API Configs ({apiConfigs.length})</span>
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          {savedMsg && <span className="text-[11px] text-slate-500 font-medium">{savedMsg}</span>}
          {publishMsg && <span className="text-[11px] font-semibold text-slate-700">{publishMsg}</span>}
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            All changes saved
          </span>
        </div>
      </div>

      {/* Publish errors */}
      {publishErrors.length > 0 && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2">
          <ul className="text-xs text-rose-700 space-y-1">
            {publishErrors.map((e, i) => (
              <li key={i} className="flex items-center gap-2">
                <i className="ph-bold ph-warning-circle text-rose-500" />
                {e.nodeId ? (
                  <button
                    onClick={() => { focusNode(e.nodeId!); setSearchHighlightId(e.nodeId!); setTimeout(() => setSearchHighlightId(null), 2500); }}
                    className="text-left underline decoration-dotted hover:decoration-solid"
                    title="Go to this node"
                  >
                    {e.message} <span className="text-[10px] opacity-70">(click to view)</span>
                  </button>
                ) : (
                  <span>{e.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Workspace row: palette | canvas | config panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Palette — Nodes Library */}
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 flex flex-col z-20 shadow-sm">
        <div className="p-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <i className="ph-bold ph-squares-four text-brand-600" />
            Nodes Library
          </span>
          <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono font-medium">Click to add</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
          {PALETTE_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{group.label}</div>
              <div className="space-y-1.5">
                {group.items.map((item) => (
                  <button
                    key={item.type}
                    onClick={() => addNode(item.type)}
                    className="group w-full flex items-center justify-between p-2 rounded-lg border border-slate-200 bg-white hover:border-brand-500 hover:bg-brand-50/40 hover:shadow-xs transition text-left"
                  >
                    <div className="flex items-center space-x-2">
                      <span className={`w-6 h-6 rounded flex items-center justify-center text-xs ${item.accent}`}>
                        <i className={`ph ${item.icon}`} />
                      </span>
                      <span className="font-medium text-slate-700 group-hover:text-slate-900">{TYPE_LABEL[item.type] ?? item.type}</span>
                    </div>
                    <i className="ph ph-plus text-slate-300 group-hover:text-brand-500" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-slate-100 bg-slate-50/80 text-[11px] text-slate-500 flex items-center justify-between shrink-0">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Meta Graph v20.0
          </span>
          <span className="font-mono text-slate-400">99.99% SLA</span>
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex-1 min-h-0 h-full">
          <ReactFlow
            nodes={nodesForFlow}
            edges={edgesForFlow}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            connectionMode={ConnectionMode.Loose}
            connectionRadius={45}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={{ type: "deletable" }}
            onInit={(inst) => { rfRef.current = inst; }}
            proOptions={{ hideAttribution: true }}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      {/* Config panel */}
      {selectedNode && (
        <aside className="w-[380px] shrink-0 bg-white border-l border-slate-200 shadow-[-6px_0_28px_-4px_rgba(15,23,42,0.08)] flex flex-col z-[60] h-full font-sans relative">
          {/* Drawer header */}
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col space-y-2 bg-white shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs text-emerald-600 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>All changes saved</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {selectedNode.data.nodeType !== "START" && (
                  <button
                    onClick={deleteSelectedNode}
                    className="px-2.5 py-1 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors flex items-center space-x-1"
                    title="Delete node"
                  >
                    <i className="ph-bold ph-trash text-[11px]" />
                    <span>Delete</span>
                  </button>
                )}
                <button
                  onClick={() => setSelectedId(null)}
                  className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
                  title="Close inspector"
                >
                  <i className="ph-bold ph-x text-sm" />
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-3 pt-1">
              <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center shrink-0 text-base shadow-2xs">
                <i className="ph-bold ph-chat-circle-dots" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 leading-tight">{nodeName(selectedNode)}</h2>
                <div className="flex items-center space-x-2 mt-0.5">
                  <span className="text-[11px] font-medium text-slate-500">{TYPE_LABEL[selectedNode.data.nodeType] ?? selectedNode.data.nodeType} Node</span>
                  {selectedNode.data.nodeType === "ASK_INPUT" && (
                    <>
                      <span className="text-slate-300">•</span>
                      <span className="text-[11px] text-teal-600 font-semibold">User Input Prompt</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Drawer scrollable body */}
          <div className="pf-inspector flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4 text-xs">
            {/* #3 — editable node name (all nodes) */}
            <div className="space-y-1.5">
              <span className="block font-semibold text-slate-700">Node name</span>
              <input
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 text-slate-800 font-medium placeholder:text-slate-400 transition-colors"
                value={selectedNode.data.config.name ?? ""}
                placeholder={`${TYPE_LABEL[selectedNode.data.nodeType] ?? selectedNode.data.nodeType} ${selectedNode.data.seq}`}
                onChange={(e) => updateConfig("name", e.target.value)}
              />
              <p className="text-[11px] text-slate-400">Internal identifier used across reporting and logs.</p>
            </div>

            {/* #6 — Connect to node */}
            {!isMultiOutput({ nodeType: selectedNode.data.nodeType, config: selectedNode.data.config }) && otherNodes.length > 0 && (() => {
              // Plain (null-handle) connections from this node -> targets.
              const connectedTargetIds = edges
                .filter((e) => e.source === selectedId && (e.sourceHandle ?? null) === null)
                .map((e) => e.target);
              const atLimit = connectedTargetIds.length >= MAX_CONNECTIONS;
              // Only offer nodes that aren't already connected.
              const selectable = otherNodes.filter((n) => !connectedTargetIds.includes(n.id));
              return (
                <div className="space-y-1.5">
                  <span className="block font-semibold text-slate-700">
                    Connect to node <span className="text-slate-400 font-normal">({connectedTargetIds.length}/{MAX_CONNECTIONS})</span>
                  </span>
                  <div className="relative">
                    <select
                      className="w-full appearance-none px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 font-medium cursor-pointer pr-8 disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed"
                      value=""
                      disabled={atLimit || selectable.length === 0}
                      onChange={(e) => { if (e.target.value) connectToNode(e.target.value); }}
                    >
                      <option value="">{atLimit ? "Max 3 nodes connected" : "Connect this node to…"}</option>
                      {selectable.map((n) => (
                        <option key={n.id} value={n.id}>{nodeName(n)}</option>
                      ))}
                    </select>
                    <i className="ph-bold ph-caret-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none" />
                  </div>
                  {/* Connected nodes shown as removable tags */}
                  {connectedTargetIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {connectedTargetIds.map((tid) => {
                        const n = nodes.find((x) => x.id === tid);
                        if (!n) return null;
                        return (
                          <span
                            key={tid}
                            className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-[11px] font-medium"
                          >
                            <i className="ph-bold ph-arrow-right text-[9px]" />
                            {nodeName(n)}
                            <button
                              type="button"
                              onClick={() => disconnectFromNode(tid)}
                              className="w-4 h-4 rounded-full hover:bg-teal-200/70 flex items-center justify-center text-teal-600 hover:text-teal-800 transition-colors"
                              title="Remove connection"
                            >
                              <i className="ph-bold ph-x text-[9px]" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="h-px bg-slate-200" />

            {selectedNode.data.nodeType === "SEND_MESSAGE" && (
              <>
                {/* #12 — Header */}
                <div className="space-y-1.5">
                  <label className="block font-semibold text-slate-700">
                    Header <span className="text-slate-400 font-normal">(optional)</span>
                  </label>
                  <div className="relative">
                    <select
                      className="w-full appearance-none px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 font-medium cursor-pointer pr-8"
                      value={selectedNode.data.config.header?.type ?? ""}
                      onChange={(e) => updateNestedConfig("header", "type", e.target.value)}
                    >
                      <option value="">None</option>
                      <option value="text">Text Header</option>
                      <option value="image">Image Header</option>
                      <option value="video">Video Header</option>
                      <option value="document">Document Header</option>
                    </select>
                    <i className="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none" />
                  </div>
                </div>

                {selectedNode.data.config.header?.type && (
                  <div className="space-y-1.5">
                    <label className="block font-semibold text-slate-700">
                      {selectedNode.data.config.header.type === "text" ? "Header text" : "Media URL"}
                    </label>
                    <input
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 font-medium focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors placeholder:text-slate-400"
                      placeholder={selectedNode.data.config.header.type === "text" ? "Header" : "https://..."}
                      value={selectedNode.data.config.header?.value ?? ""}
                      onChange={(e) => updateNestedConfig("header", "value", e.target.value)}
                    />
                  </div>
                )}

                {/* #12 — media preview for image/video/document headers */}
                {selectedNode.data.config.header?.type &&
                  selectedNode.data.config.header?.type !== "text" &&
                  selectedNode.data.config.header?.value && (
                    <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
                      <span className="text-[11px] text-slate-400 block mb-1">Preview</span>
                      {selectedNode.data.config.header.type === "image" && (
                        <img
                          src={selectedNode.data.config.header.value}
                          alt="header preview"
                          className="max-h-40 rounded object-contain mx-auto"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          onLoad={(e) => { (e.target as HTMLImageElement).style.display = "block"; }}
                        />
                      )}
                      {selectedNode.data.config.header.type === "video" && (
                        <video
                          src={selectedNode.data.config.header.value}
                          controls
                          className="max-h-40 rounded w-full"
                        />
                      )}
                      {selectedNode.data.config.header.type === "document" && (
                        <a
                          href={selectedNode.data.config.header.value}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2 text-sm text-teal-700 hover:underline break-all"
                        >
                          📄 {selectedNode.data.config.header.value.split("/").pop() || "Open document"}
                        </a>
                      )}
                      <p className="text-[10px] text-slate-400 mt-1">
                        If nothing shows, the URL may be private or not directly embeddable.
                      </p>
                    </div>
                  )}

                {/* #12 — Body */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block font-semibold text-slate-700">Message text (body)</label>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {(selectedNode.data.config.text ?? "").length} / 1024
                    </span>
                  </div>
                  <VariableTextInput
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(v) => updateConfig("text", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="Type your WhatsApp message…"
                    rows={4}
                  />
                </div>

                {/* #12 — Footer */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block font-semibold text-slate-700">
                      Footer <span className="text-slate-400 font-normal">(optional)</span>
                    </label>
                    <span className="text-[11px] text-slate-400">Small subtext below message</span>
                  </div>
                  <VariableTextInput
                    value={selectedNode.data.config.footer ?? ""}
                    onChange={(v) => updateConfig("footer", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                    placeholder="e.g. Reply STOP to opt out"
                  />
                </div>

                {/* #10 — buttons: each is either a CTA (branches to a node)
                    or a Visit URL (opens a link). Max 3. */}
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-2.5 font-bold tracking-wider text-slate-400 text-[10px] uppercase">
                      Buttons (optional, max 3)
                    </span>
                  </div>
                </div>

                {(selectedNode.data.config.buttons ?? []).map((b: any, idx: number) => {
                  const target = (nodesForFlow.find((n) => n.id === selectedId)?.data.optionTargets ?? {})[b.id];
                  const kind = b.kind ?? "cta";
                  // Currently-connected target node id for this CTA button (from edges),
                  // used to reflect/select the value in the "Connect to node" dropdown.
                  const btnTargetId =
                    edges.find((e) => e.source === selectedId && e.sourceHandle === b.id)?.target ?? "";
                  return (
                    <div
                      key={b.id}
                      draggable={dragBtnIdx !== null}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragBtnIdx(idx);
                      }}
                      onDragOver={(e) => {
                        if (dragBtnIdx === null || dragBtnIdx === idx) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragBtnIdx !== null) reorderOption(dragBtnIdx, idx);
                        setDragBtnIdx(null);
                      }}
                      onDragEnd={() => setDragBtnIdx(null)}
                      className={`rounded-xl p-3 bg-slate-50 border transition-all space-y-2 shadow-xs ${
                        dragBtnIdx === idx
                          ? "border-teal-400 ring-2 ring-teal-500/20 opacity-60"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 flex-1 mr-2">
                          <i
                            className="ph-bold ph-dots-six-vertical text-slate-400 hover:text-slate-600 text-sm cursor-grab active:cursor-grabbing"
                            title="Drag to reorder"
                            onMouseDown={() => setDragBtnIdx(idx)}
                            onMouseUp={() => setDragBtnIdx((cur) => (cur === idx ? null : cur))}
                          />
                          <input
                            className="w-full bg-white text-slate-800 font-medium rounded border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:border-teal-500 placeholder:font-normal placeholder:text-slate-400"
                            style={{ fontSize: "12px", lineHeight: "16px" }}
                            placeholder="Button label..."
                            value={b.label}
                            onChange={(e) => updateOption(b.id, e.target.value)}
                          />
                        </div>
                        <button
                          onClick={() => removeOption(b.id)}
                          className="w-6 h-6 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-colors"
                          title={`Delete Button ${idx + 1}`}
                        >
                          <i className="ph-bold ph-x text-xs" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 pt-0.5">
                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Action</label>
                          <div className="relative">
                            <select
                              className="w-full appearance-none px-2.5 py-1.5 text-xs leading-tight rounded border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-teal-500 pr-6"
                              value={kind}
                              onChange={(e) => updateOptionField(b.id, "kind", e.target.value)}
                            >
                              <option value="url">Visit URL (open link)</option>
                              <option value="cta">CTA (branch to a node)</option>
                            </select>
                            <i className="ph-bold ph-caret-down absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] pointer-events-none" />
                          </div>
                        </div>
                        {kind === "url" ? (
                          <div>
                            <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">URL</label>
                            <div className="relative flex items-center">
                              <i className="ph-bold ph-link absolute left-2 text-slate-400 text-[10px]" />
                              <input
                                className="w-full bg-white font-mono text-[11px] leading-tight text-slate-700 rounded border border-slate-200 pl-6 pr-2 py-1.5 focus:outline-none focus:border-teal-500 placeholder:text-[11px] placeholder:text-slate-400"
                                placeholder="https://example.com/{{var}}"
                                value={b.url ?? ""}
                                onChange={(e) => updateOptionField(b.id, "url", e.target.value)}
                              />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Connect to node</label>
                            <div className="relative">
                              <select
                                className="w-full appearance-none px-2.5 py-1.5 text-xs leading-tight rounded border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-teal-500 pr-6"
                                value={btnTargetId}
                                onChange={(e) => connectOptionToNode(b.id, e.target.value)}
                              >
                                <option value="">Connect this button to…</option>
                                {otherNodes.map((n) => (
                                  <option key={n.id} value={n.id}>{nodeName(n)}</option>
                                ))}
                              </select>
                              <i className="ph-bold ph-caret-down absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] pointer-events-none" />
                            </div>
                            <div className="text-[11px] mt-1">
                              {target ? (
                                <span className="text-emerald-600 font-medium flex items-center gap-1">
                                  <i className="ph-bold ph-check text-[10px]" /> Connected → {target}
                                </span>
                              ) : (
                                <span className="text-slate-400">Not connected — pick a node above or drag from this button on the canvas</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {(selectedNode.data.config.buttons ?? []).length < 3 && (
                  <button
                    onClick={() => addOption(3)}
                    className="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/30 text-teal-700 font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors"
                    type="button"
                  >
                    <i className="ph-bold ph-plus text-xs" />
                    <span>
                      Add Button ({(selectedNode.data.config.buttons ?? []).length} of 3 used)
                    </span>
                  </button>
                )}

                <div className="rounded-xl p-3 bg-slate-50 border border-slate-200 text-[11px] text-slate-500 leading-relaxed flex items-start space-x-2">
                  <i className="ph-bold ph-info text-slate-400 text-xs mt-0.5 shrink-0" />
                  <span>
                    CTA buttons branch the flow; Visit URL buttons open a link. Note: WhatsApp
                    doesn't allow mixing reply buttons and URL buttons in one message.
                  </span>
                </div>
              </>
            )}

            {selectedNode.data.nodeType === "ASK_INPUT" && (
              <div className="flex flex-col gap-4 text-xs font-sans">
                <div className="space-y-1.5">
                  <span className="block font-semibold text-slate-700">Question text</span>
                  <VariableTextInput
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(v) => updateConfig("text", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="Ask something…"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="block font-semibold text-slate-700">
                      Footer <span className="text-slate-400 font-normal">(optional)</span>
                    </span>
                    <span className="text-[10px] text-slate-400">Small subtext below message</span>
                  </div>
                  <VariableTextInput
                    value={selectedNode.data.config.footer ?? ""}
                    onChange={(v) => updateConfig("footer", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                    placeholder="Footer text…"
                  />
                </div>

                <div className="h-px bg-slate-200" />

                <div className="space-y-1.5">
                  <span className="block font-semibold text-slate-700">Save answer to variable</span>
                  <VariableSelect
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(v) => updateConfig("variable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                  <p className="text-[11px] text-slate-400">Stores whatever text or selection the user sends in reply.</p>
                </div>

                {/* Validation */}
                <div className="space-y-1.5">
                  <span className="block font-semibold text-slate-700">Validation type</span>
                  <div className="relative">
                    <select
                      className="w-full appearance-none px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 font-medium cursor-pointer pr-8"
                      value={selectedNode.data.config.validationType ?? "none"}
                      onChange={(e) => updateConfig("validationType", e.target.value)}
                    >
                      <option value="none">None</option>
                      <option value="phone">Phone number</option>
                      <option value="email">Email</option>
                      <option value="url">URL</option>
                      <option value="number">Only numbers</option>
                      <option value="alphanumeric">Alphanumeric</option>
                      <option value="custom">Custom (regex)</option>
                    </select>
                    <i className="ph-bold ph-caret-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none" />
                  </div>
                </div>
                {selectedNode.data.config.validationType === "custom" && (
                  <div className="space-y-1.5">
                    <span className="block font-semibold text-slate-700">Regex expression</span>
                    <input
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 text-slate-800 font-mono placeholder:text-slate-400 transition-colors"
                      placeholder="^[A-Za-z0-9]+$"
                      value={selectedNode.data.config.regex ?? ""}
                      onChange={(e) => updateConfig("regex", e.target.value)}
                    />
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Examples — Phone: <code className="font-mono text-slate-600">^\+?[0-9]{"{10,15}"}$</code> · Email: <code className="font-mono text-slate-600">^[^\s@]+@[^\s@]+\.[^\s@]+$</code> · URL: <code className="font-mono text-slate-600">^https?:\/\/.+$</code>
                    </p>
                  </div>
                )}

                {/* Retry + failure (only relevant when validating) */}
                {selectedNode.data.config.validationType &&
                  selectedNode.data.config.validationType !== "none" && (
                    <>
                      <div className="space-y-1.5">
                        <span className="block font-semibold text-slate-700">Retry limit (max 5)</span>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          className="w-24 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 text-slate-800 font-medium transition-colors"
                          value={selectedNode.data.config.retryLimit ?? 3}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(5, Number(e.target.value) || 1));
                            updateConfig("retryLimit", n);
                          }}
                        />
                        <p className="text-[11px] text-slate-400">
                          After this many failed attempts, the failure message is shown and the flow continues.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <span className="block font-semibold text-slate-700">Failure / invalid message</span>
                        <VariableTextInput
                          value={selectedNode.data.config.failureMessage ?? ""}
                          onChange={(v) => updateConfig("failureMessage", v)}
                          variables={variables}
                          onCreateVariable={ensureVariable}
                          placeholder="That doesn't look valid. Please try again."
                        />
                      </div>
                    </>
                  )}

                {/* No-response timeout fallback */}
                <NoReplyFallback
                  node={selectedNode}
                  otherNodes={otherNodes}
                  nodeName={nodeName}
                  updateConfig={updateConfig}
                  variables={variables}
                  onCreateVariable={ensureVariable}
                />
              </div>
            )}

            {selectedNode.data.nodeType === "CONDITION" && (
              <>
                <label className="form-control">
                  <span className="label-text">Variable to check</span>
                  <VariableSelect
                    value={selectedNode.data.config.field ?? ""}
                    onChange={(v) => updateConfig("field", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="Select a variable"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Equals value</span>
                  <VariableTextInput
                    value={selectedNode.data.config.value ?? ""}
                    onChange={(v) => updateConfig("value", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                  />
                </label>
              </>
            )}

            {selectedNode.data.nodeType === "AI_RESPONSE" && (
              <>
                <label className="form-control">
                  <span className="label-text">Prompt (reference variables with the button below)</span>
                  <VariableTextInput
                    value={selectedNode.data.config.prompt ?? ""}
                    onChange={(v) => updateConfig("prompt", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    rows={4}
                    placeholder="Write a friendly greeting for {{name}}…"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Store reply in variable (optional)</span>
                  <VariableSelect
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(v) => updateConfig("variable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Fallback text (if the AI call fails)</span>
                  <input
                    className="input input-bordered"
                    value={selectedNode.data.config.fallbackText ?? ""}
                    onChange={(e) => updateConfig("fallbackText", e.target.value)}
                  />
                </label>
                <label className="label cursor-pointer justify-start gap-2">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selectedNode.data.config.sendReply !== false}
                    onChange={(e) => updateConfig("sendReply", e.target.checked)}
                  />
                  <span className="label-text">Send the AI's reply to the user</span>
                </label>
              </>
            )}

            {selectedNode.data.nodeType === "SET_VARIABLE" && (
              <>
                <label className="form-control">
                  <span className="label-text">Variable name</span>
                  <VariableSelect
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(v) => updateConfig("variable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Value</span>
                  <VariableTextInput
                    value={selectedNode.data.config.value ?? ""}
                    onChange={(v) => updateConfig("value", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                  />
                </label>
              </>
            )}

            {selectedNode.data.nodeType === "WAIT" && (
              <label className="form-control">
                <span className="label-text">Seconds to wait (max {MAX_DELAY_SECONDS})</span>
                <input
                  type="number"
                  min={0}
                  max={MAX_DELAY_SECONDS}
                  className="input input-bordered"
                  value={selectedNode.data.config.seconds ?? ""}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    const clamped = isNaN(raw) ? "" : Math.max(0, Math.min(MAX_DELAY_SECONDS, raw));
                    updateConfig("seconds", clamped);
                  }}
                />
                <span className="text-xs text-base-content/50 mt-1">
                  Maximum allowed delay is {MAX_DELAY_SECONDS} seconds (24 hours).
                </span>
              </label>
            )}

            {selectedNode.data.nodeType === "BUTTONS" && (
              <>
                <label className="form-control">
                  <span className="label-text">Prompt text</span>
                  <textarea
                    className="textarea textarea-bordered"
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(e) => updateConfig("text", e.target.value)}
                  />
                </label>
                <div className="text-sm font-medium mt-2">Buttons (max 3)</div>
                {(selectedNode.data.config.buttons ?? []).map((b: any) => {
                  const target = (nodesForFlow.find((n) => n.id === selectedId)?.data.optionTargets ?? {})[b.id];
                  return (
                    <div key={b.id} className="flex flex-col gap-1 border border-base-200 rounded p-2">
                      <div className="flex gap-1 items-center">
                        <input
                          className="input input-bordered input-sm flex-1"
                          placeholder="Button label"
                          value={b.label}
                          onChange={(e) => updateOption(b.id, e.target.value)}
                        />
                        <button onClick={() => removeOption(b.id)} className="btn btn-xs btn-ghost text-error">✕</button>
                      </div>
                      <div className="text-[11px]">
                        {target ? (
                          <span className="text-success">Connected → {target}</span>
                        ) : (
                          <span className="text-base-content/40">Not Connected</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(selectedNode.data.config.buttons ?? []).length < 3 && (
                  <button onClick={() => addOption(3)} className="btn btn-sm btn-outline">+ Add button</button>
                )}
              </>
            )}

            {selectedNode.data.nodeType === "LIST" && (
              <>
                <label className="form-control">
                  <span className="label-text">Prompt text</span>
                  <VariableTextInput
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(v) => updateConfig("text", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">List button text</span>
                  <input
                    className="input input-bordered input-sm"
                    placeholder="e.g. View options"
                    value={selectedNode.data.config.buttonText ?? ""}
                    onChange={(e) => updateConfig("buttonText", e.target.value)}
                  />
                </label>
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-2.5 font-bold tracking-wider text-slate-400 text-[10px] uppercase">Rows (max 10)</span>
                  </div>
                </div>
                {(selectedNode.data.config.rows ?? []).map((r: any, idx: number) => {
                  const target = (nodesForFlow.find((n) => n.id === selectedId)?.data.optionTargets ?? {})[r.id];
                  // Currently-connected target node id for this row (from edges),
                  // used to reflect/select the value in the "Connect to node" dropdown.
                  const rowTargetId =
                    edges.find((e) => e.source === selectedId && e.sourceHandle === r.id)?.target ?? "";
                  return (
                    <div
                      key={r.id}
                      draggable={dragBtnIdx !== null}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        setDragBtnIdx(idx);
                      }}
                      onDragOver={(e) => {
                        if (dragBtnIdx === null || dragBtnIdx === idx) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragBtnIdx !== null) reorderOption(dragBtnIdx, idx);
                        setDragBtnIdx(null);
                      }}
                      onDragEnd={() => setDragBtnIdx(null)}
                      className={`rounded-xl p-3 bg-slate-50 border transition-all space-y-2 shadow-xs ${
                        dragBtnIdx === idx
                          ? "border-teal-400 ring-2 ring-teal-500/20 opacity-60"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 flex-1 mr-2">
                          <i
                            className="ph-bold ph-dots-six-vertical text-slate-400 hover:text-slate-600 text-sm cursor-grab active:cursor-grabbing"
                            title="Drag to reorder"
                            onMouseDown={() => setDragBtnIdx(idx)}
                            onMouseUp={() => setDragBtnIdx((cur) => (cur === idx ? null : cur))}
                          />
                          <input
                            className="w-full bg-white text-slate-800 font-medium rounded border border-slate-200 px-2.5 py-1.5 focus:outline-none focus:border-teal-500 placeholder:font-normal placeholder:text-slate-400"
                            style={{ fontSize: "12px", lineHeight: "16px" }}
                            placeholder="Button label..."
                            value={r.label}
                            onChange={(e) => updateOption(r.id, e.target.value)}
                          />
                        </div>
                        <button
                          onClick={() => removeOption(r.id)}
                          className="w-6 h-6 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-colors"
                          title={`Delete Row ${idx + 1}`}
                        >
                          <i className="ph-bold ph-x text-xs" />
                        </button>
                      </div>
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block mb-0.5">Connect to node</label>
                        <div className="relative">
                          <select
                            className="w-full appearance-none px-2.5 py-1.5 text-xs leading-tight rounded border border-slate-200 bg-white text-slate-700 focus:outline-none focus:border-teal-500 pr-6"
                            value={rowTargetId}
                            onChange={(e) => connectOptionToNode(r.id, e.target.value)}
                          >
                            <option value="">Connect this node to…</option>
                            {otherNodes.map((n) => (
                              <option key={n.id} value={n.id}>{nodeName(n)}</option>
                            ))}
                          </select>
                          <i className="ph-bold ph-caret-down absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-[9px] pointer-events-none" />
                        </div>
                      </div>
                      <div className="text-[11px]">
                        {target ? (
                          <span className="text-emerald-600 font-medium flex items-center gap-1">
                            <i className="ph-bold ph-check text-[10px]" /> Connected → {target}
                          </span>
                        ) : (
                          <span className="text-slate-400">Not connected — pick a node above or drag from this row on the canvas</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(selectedNode.data.config.rows ?? []).length < 10 && (
                  <button
                    onClick={() => addOption(10)}
                    className="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-300 hover:border-teal-500 hover:bg-teal-50/30 text-teal-700 font-semibold text-xs flex items-center justify-center space-x-1.5 transition-colors"
                    type="button"
                  >
                    <i className="ph-bold ph-plus text-xs" />
                    <span>Add Row ({(selectedNode.data.config.rows ?? []).length} of 10 used)</span>
                  </button>
                )}
              </>
            )}

            {selectedNode.data.nodeType === "TRANSFORM" && (
              <>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="block font-semibold text-slate-700 text-xs">JS expression (use vars.name)</span>
                    {/* Insert a variable as vars.<name> (no braces) */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowCodeVars((s) => !s)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800"
                      >
                        <i className="ph-bold ph-brackets-curly text-[11px]" />
                        Add variable
                      </button>
                      {showCodeVars && (
                        <div className="absolute right-0 top-6 z-30 bg-white border border-slate-200 rounded-lg shadow-lg w-52 max-h-56 overflow-y-auto">
                          {variables.length > 0 ? (
                            variables.map((v) => (
                              <button
                                key={v.name}
                                type="button"
                                onClick={() => insertCodeVariable(v.name)}
                                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-xs flex items-center justify-between"
                              >
                                <span className="font-mono text-slate-800">vars.{v.name}</span>
                                <span className="text-slate-400 text-[10px] ml-2">
                                  {v.type === "text" ? "string" : v.type}
                                </span>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-xs text-slate-400">No variables yet.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <textarea
                    ref={codeExprRef}
                    className="textarea textarea-bordered font-mono text-xs w-full"
                    rows={3}
                    placeholder="vars.name.toUpperCase()"
                    value={selectedNode.data.config.expression ?? ""}
                    onChange={(e) => { updateConfig("expression", e.target.value); setCodeTestResult(null); }}
                  />
                </div>

                {/* Test the expression against sample variable values */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => testCustomCode(selectedNode.data.config.expression ?? "")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold transition active:scale-95"
                  >
                    <i className="ph-bold ph-play text-xs" />
                    Test code
                  </button>
                  {codeTestResult && (
                    <button
                      type="button"
                      onClick={() => setCodeTestResult(null)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {codeTestResult && (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs font-mono break-words ${
                      codeTestResult.ok
                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                        : "bg-rose-50 border-rose-200 text-rose-700"
                    }`}
                  >
                    <span className="font-sans font-semibold mr-1">
                      {codeTestResult.ok ? "Result:" : "Error:"}
                    </span>
                    {codeTestResult.value}
                  </div>
                )}

                <label className="form-control">
                  <span className="label-text">Store result in variable</span>
                  <VariableSelect
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(v) => updateConfig("variable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                </label>
                <p className="text-xs text-base-content/50">
                  Write a single JS expression. Read workflow variables with <code>vars.name</code>;
                  the returned value is stored in the variable above. Test runs use each variable&apos;s
                  default value as a sample.
                </p>
                <p className="text-xs text-base-content/50">
                  Examples: <code>vars.name.toUpperCase()</code>, <code>Number(vars.a) + Number(vars.b)</code>, <code>vars.first + " " + vars.last</code>
                </p>
              </>
            )}

            {selectedNode.data.nodeType === "API_REQUEST" && (
              <>
                <label className="form-control">
                  <span className="label-text">Use global API config (optional)</span>
                  <select
                    className="select select-bordered select-sm"
                    value={selectedNode.data.config.apiConfig ?? ""}
                    onChange={(e) => { updateConfig("apiConfig", e.target.value); updateConfig("endpointId", ""); }}
                  >
                    <option value="">None</option>
                    {apiConfigs.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
                {/* Endpoint picker — appears when the chosen config has endpoints.
                    Selecting one auto-fills method / URL (path) / body. */}
                {(() => {
                  const cfg = apiConfigs.find((c) => c.name === selectedNode.data.config.apiConfig);
                  const eps = cfg?.endpoints ?? [];
                  if (eps.length === 0) return null;
                  return (
                    <label className="form-control">
                      <span className="label-text">Endpoint (from config)</span>
                      <select
                        className="select select-bordered select-sm"
                        value={selectedNode.data.config.endpointId ?? ""}
                        onChange={(e) => {
                          const ep = eps.find((x) => x.id === e.target.value);
                          updateConfig("endpointId", e.target.value);
                          if (ep) {
                            updateConfig("method", ep.method);
                            updateConfig("url", ep.path);
                            if (ep.body) updateConfig("body", ep.body);
                          }
                        }}
                      >
                        <option value="">Custom (set below)</option>
                        {eps.map((ep) => (
                          <option key={ep.id} value={ep.id}>{ep.method} — {ep.name || ep.path}</option>
                        ))}
                      </select>
                    </label>
                  );
                })()}
                <div className="flex gap-2">
                  <label className="form-control w-28">
                    <span className="label-text">Method</span>
                    <select
                      className="select select-bordered select-sm"
                      value={selectedNode.data.config.method ?? "GET"}
                      onChange={(e) => updateConfig("method", e.target.value)}
                    >
                      {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  <label className="form-control flex-1">
                    <span className="label-text">Timeout (ms)</span>
                    <input
                      type="number"
                      className="input input-bordered input-sm"
                      placeholder="10000"
                      value={selectedNode.data.config.timeoutMs ?? ""}
                      onChange={(e) => updateConfig("timeoutMs", e.target.value)}
                    />
                  </label>
                </div>
                <label className="form-control">
                  <span className="label-text">URL (supports {"{{var}}"})</span>
                  <VariableTextInput
                    value={selectedNode.data.config.url ?? ""}
                    onChange={(v) => updateConfig("url", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                    hideFormatting
                    placeholder="https://api.example.com/users/{{id}}"
                  />
                </label>

                {/* Headers — key is plain, value supports variables */}
                <div className="text-sm font-medium mt-1">Headers</div>
                {(selectedNode.data.config.headers ?? []).map((hdr: any, idx: number) => (
                  <div key={idx} className="flex gap-1 items-start">
                    <input className="input input-bordered input-xs flex-1 mt-0.5" placeholder="key" value={hdr.key ?? ""}
                      onChange={(e) => updateKeyValList("headers", idx, "key", e.target.value)} />
                    <div className="flex-1">
                      <VariableTextInput
                        value={hdr.value ?? ""}
                        onChange={(v) => updateKeyValList("headers", idx, "value", v)}
                        variables={variables}
                        onCreateVariable={ensureVariable}
                        singleLine
                        hideFormatting
                        placeholder="value"
                      />
                    </div>
                    <button onClick={() => removeKeyValList("headers", idx)} className="btn btn-xs btn-ghost text-error mt-0.5">✕</button>
                  </div>
                ))}
                <button onClick={() => addKeyValList("headers")} className="btn btn-xs btn-outline">+ Header</button>

                {/* Query params — key is plain, value supports variables */}
                <div className="text-sm font-medium mt-1">Query params</div>
                {(selectedNode.data.config.query ?? []).map((q: any, idx: number) => (
                  <div key={idx} className="flex gap-1 items-start">
                    <input className="input input-bordered input-xs flex-1 mt-0.5" placeholder="key" value={q.key ?? ""}
                      onChange={(e) => updateKeyValList("query", idx, "key", e.target.value)} />
                    <div className="flex-1">
                      <VariableTextInput
                        value={q.value ?? ""}
                        onChange={(v) => updateKeyValList("query", idx, "value", v)}
                        variables={variables}
                        onCreateVariable={ensureVariable}
                        singleLine
                        hideFormatting
                        placeholder="value"
                      />
                    </div>
                    <button onClick={() => removeKeyValList("query", idx)} className="btn btn-xs btn-ghost text-error mt-0.5">✕</button>
                  </div>
                ))}
                <button onClick={() => addKeyValList("query")} className="btn btn-xs btn-outline">+ Query param</button>

                {/* Body */}
                {["POST", "PUT", "PATCH"].includes(selectedNode.data.config.method ?? "GET") && (
                  <label className="form-control">
                    <span className="label-text">Request body (JSON, supports {"{{var}}"})</span>
                    <VariableTextInput
                      value={selectedNode.data.config.body ?? ""}
                      onChange={(v) => updateConfig("body", v)}
                      variables={variables}
                      onCreateVariable={ensureVariable}
                      rows={3}
                      hideFormatting
                      placeholder={'{ "name": "{{name}}" }'}
                    />
                    {(() => {
                      const check = checkBodyJson(selectedNode.data.config.body ?? "");
                      return check.ok ? null : (
                        <span className="text-[11px] text-error mt-1 flex items-center gap-1">
                          ⚠️ {check.hint}
                        </span>
                      );
                    })()}
                  </label>
                )}

                {/* Response mapping — path is plain, destination is a variable */}
                <div className="text-sm font-medium mt-1">Map response → variables</div>
                {(selectedNode.data.config.responseMap ?? []).map((m: any, idx: number) => (
                  <div key={idx} className="flex gap-1 items-center">
                    <input className="input input-bordered input-xs flex-1" placeholder="response path (e.g. data.id)" value={m.path ?? ""}
                      onChange={(e) => updateKeyValList("responseMap", idx, "path", e.target.value)} />
                    <div className="flex-1">
                      <VariableSelect
                        value={m.variable ?? ""}
                        onChange={(v) => updateKeyValList("responseMap", idx, "variable", v)}
                        variables={variables}
                        onCreateVariable={ensureVariable}
                        placeholder="variable"
                      />
                    </div>
                    <button onClick={() => removeKeyValList("responseMap", idx)} className="btn btn-xs btn-ghost text-error">✕</button>
                  </div>
                ))}
                <button onClick={() => addKeyValList("responseMap")} className="btn btn-xs btn-outline">+ Mapping</button>

                <label className="form-control mt-1">
                  <span className="label-text">Store status code in (optional)</span>
                  <VariableSelect
                    value={selectedNode.data.config.statusVariable ?? ""}
                    onChange={(v) => updateConfig("statusVariable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="Select or create a variable"
                  />
                </label>
                <p className="text-xs text-base-content/50">
                  Connect the <span className="text-success">success</span> and <span className="text-error">failure</span> handles. Failure fires on non-2xx or timeout.
                </p>
              </>
            )}

            {selectedNode.data.nodeType === "START" && (() => {
              const keywords: string[] = selectedNode.data.config.keywords ?? [];
              const matchType = selectedNode.data.config.matchType ?? "contains";

              const addKeyword = (raw: string) => {
                const cleaned = raw.trim().replace(/,$/, "").trim();
                if (!cleaned || keywords.includes(cleaned)) {
                  setKeywordDraft("");
                  return;
                }
                updateConfig("keywords", [...keywords, cleaned]);
                setKeywordDraft("");
              };

              const removeKeyword = (kw: string) =>
                updateConfig("keywords", keywords.filter((k) => k !== kw));

              return (
                <>
                  {/* Trigger keywords — chip / tag input */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block font-semibold text-slate-700 text-xs">
                        Trigger keywords
                      </label>
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded font-semibold">
                        {keywords.length} Active
                      </span>
                    </div>

                    <div className="border border-slate-300 rounded-xl p-2 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500 transition-all bg-white shadow-xs flex flex-wrap gap-1.5 items-center min-h-[5rem] content-start">
                      {keywords.map((kw) => (
                        <span
                          key={kw}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-xs font-medium shadow-xs"
                        >
                          <span>{kw}</span>
                          <button
                            type="button"
                            onClick={() => removeKeyword(kw)}
                            className="hover:text-teal-900 text-teal-600 focus:outline-none ml-1"
                          >
                            <i className="fa-solid fa-xmark text-[10px]" />
                          </button>
                        </span>
                      ))}
                      <div className="inline-flex items-center flex-1 min-w-[120px] py-1 px-1">
                        <input
                          type="text"
                          value={keywordDraft}
                          onChange={(e) => setKeywordDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              addKeyword(keywordDraft);
                            } else if (e.key === "Backspace" && !keywordDraft && keywords.length) {
                              removeKeyword(keywords[keywords.length - 1]);
                            }
                          }}
                          onBlur={() => keywordDraft && addKeyword(keywordDraft)}
                          placeholder="+ Add keyword..."
                          className="w-full text-xs text-slate-700 placeholder:text-slate-400 bg-transparent border-0 focus:outline-none focus:ring-0 p-0"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
                      <span>Press Enter or comma to add tag</span>
                      <span className="font-mono">{keywords.length} tags</span>
                    </div>
                  </div>

                  {/* Match type */}
                  <div className="space-y-1.5">
                    <label className="block font-semibold text-slate-700 text-xs" htmlFor="match-type-select">
                      Match type
                    </label>
                    <div className="relative">
                      <select
                        id="match-type-select"
                        value={matchType}
                        onChange={(e) => updateConfig("matchType", e.target.value)}
                        className="w-full appearance-none px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 font-medium cursor-pointer pr-8"
                      >
                        <option value="exact">Exact match</option>
                        <option value="contains">Contains keyword</option>
                        <option value="starts_with">Starts with</option>
                        <option value="regex">Regex expression</option>
                      </select>
                      <i className="fa-solid fa-chevron-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Leave keywords empty to trigger on any message.
                    </p>
                  </div>
                </>
              );
            })()}
          </div>

          {/* Drawer sticky footer */}
          <div className="p-4 bg-white border-t border-slate-200 flex items-center shrink-0 shadow-[0_-4px_16px_-6px_rgba(15,23,42,0.08)]">
            <button
              onClick={async () => {
                await handleSave();
                setSelectedId(null);
              }}
              disabled={saving}
              className="flex-1 py-2 px-4 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center space-x-2 disabled:opacity-60"
            >
              <i className="ph-bold ph-check text-xs" />
              <span>{saving ? "Saving..." : "Save Changes"}</span>
            </button>
          </div>
        </aside>
      )}
      </div>
      {/* end workspace row */}

      <TestPanel chatbotId={chatbotId} />

      {/* #2 — View Variables modal (overlay, does not shift the canvas) */}
      {showVarList && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 transition-all" onClick={() => setShowVarList(false)}>
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-[600px] max-w-full max-h-[68vh] overflow-hidden flex flex-col font-sans" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-200/70 flex items-center justify-center text-brand-600 shadow-2xs">
                  <i className="ph-bold ph-brackets-curly text-lg" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">Workflow Variables</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Manage global variables and inputs for this automation flow</p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={openAddVariable}
                  className="flex items-center space-x-1.5 bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs px-3.5 py-2 rounded-lg shadow-sm transition active:scale-95"
                >
                  <i className="ph-bold ph-plus text-xs" />
                  <span>Add Variable</span>
                </button>
                <button
                  onClick={() => setShowVarList(false)}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition"
                  title="Close modal"
                >
                  <i className="ph-bold ph-x text-base" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 pt-5 overflow-y-auto">
              {variables.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">
                  No variables yet. Add one to reference it across nodes with{" "}
                  <code className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-[11px]">{"{{name}}"}</code>.
                </p>
              ) : (
                <table className="w-full text-left">
                  <thead className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    <tr>
                      <th className="pb-3 pl-1 font-semibold">Name</th>
                      <th className="pb-3 font-semibold">Type</th>
                      <th className="pb-3 font-semibold">Stores (Default)</th>
                      <th className="pb-3 pr-1 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {variables.map((v) => (
                      <tr key={v.name} className="group hover:bg-slate-50/70 transition-colors">
                        <td className="py-3.5 pl-1 font-mono font-semibold text-slate-800">
                          <span className="text-slate-400 font-sans mr-1">#</span>{v.name}
                        </td>
                        <td className="py-3.5">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-medium text-xs font-mono ${
                              v.type === "number"
                                ? "bg-indigo-50 text-indigo-600"
                                : v.type === "boolean"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {v.type === "text" ? "string" : v.type}
                          </span>
                        </td>
                        <td className="py-3.5">
                          {v.default ? (
                            <span className="font-mono text-xs text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 font-semibold">{v.default}</span>
                          ) : (
                            <span className="text-slate-400 font-mono">—</span>
                          )}
                        </td>
                        <td className="py-3.5 pr-1 text-right">
                          <button
                            onClick={() => removeVariable(v.name)}
                            className="w-7 h-7 inline-flex items-center justify-center rounded text-rose-500 hover:bg-rose-50 hover:text-rose-700 transition"
                            title="Delete variable"
                          >
                            <i className="ph-bold ph-x text-xs" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer tip */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 rounded-b-2xl">
              <div className="flex items-center space-x-2">
                <i className="ph-fill ph-sparkle text-brand-600" />
                <span>
                  Tip: Reference any variable in message nodes using{" "}
                  <code className="font-mono text-slate-800 font-semibold bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[11px]">{"{{variable_name}}"}</code>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* #11 — Restore unsaved changes modal (styled, replaces window.confirm) */}
      {restorePrompt && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-amber-400 to-orange-300" />
            <div className="p-6">
              <div className="flex items-start space-x-3.5">
                <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shadow-sm shrink-0">
                  <i className="ph-bold ph-clock-counter-clockwise text-2xl" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Restore unsaved changes?</h2>
                  <p className="text-sm text-slate-500 mt-1">
                    We found changes from your last session that weren&apos;t synced to the server
                    {restorePrompt.savedAt ? ` (${new Date(restorePrompt.savedAt).toLocaleString()})` : ""}.
                    Restore them, or discard and use the saved version?
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end space-x-2.5 mt-6">
                <button
                  onClick={handleDiscardLocal}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  Discard local
                </button>
                <button
                  onClick={handleRestoreLocal}
                  className="flex items-center space-x-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-5 py-2 rounded-lg shadow-sm transition active:scale-95"
                >
                  <i className="ph-bold ph-arrow-counter-clockwise text-sm" />
                  <span>Restore changes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* #2 — Add Variable modal */}
      {showVarAdd && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowVarAdd(false)}>
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xl w-[440px] max-w-full overflow-hidden font-sans" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shadow-xs">
                  <i className="ph-bold ph-brackets-curly text-lg" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 tracking-tight">Add Variable</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Declare a new variable for this automation flow</p>
                </div>
              </div>
              <button
                onClick={() => setShowVarAdd(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition"
                title="Close modal"
              >
                <i className="ph-bold ph-x text-sm" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col gap-4 text-xs">
              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700">Variable name</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-xs">#</span>
                  <input
                    autoFocus
                    className="w-full pl-7 pr-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-mono font-medium focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors placeholder:font-sans placeholder:text-slate-400"
                    placeholder="e.g. order_id"
                    value={newVar.name}
                    onChange={(e) => setNewVar((v) => ({ ...v, name: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") saveNewVariable(); }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700">Data type</label>
                <div className="relative">
                  <select
                    className="w-full appearance-none px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 cursor-pointer pr-8 transition-colors"
                    value={newVar.type}
                    onChange={(e) => setNewVar((v) => ({ ...v, type: e.target.value as WorkflowVariable["type"] }))}
                  >
                    {VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t === "text" ? "string" : t}</option>)}
                  </select>
                  <i className="ph-bold ph-caret-down absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block font-semibold text-slate-700">
                  Default value <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500 transition-colors placeholder:text-slate-400"
                  placeholder="default value"
                  value={newVar.default}
                  onChange={(e) => setNewVar((v) => ({ ...v, default: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") saveNewVariable(); }}
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 bg-slate-50 border-t border-slate-100">
              <button
                onClick={() => setShowVarAdd(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                onClick={saveNewVariable}
                disabled={!newVar.name.trim()}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-teal-600 inline-flex items-center gap-1.5"
              >
                <i className="ph-bold ph-check text-xs" />
                Save Variable
              </button>
            </div>
          </div>
        </div>
      )}

      {/* #1 — Global API Configs modal */}
      {showApiCfg && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
          onClick={() => setShowApiCfg(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top gradient accent */}
            <div className="h-1.5 w-full bg-gradient-to-r from-brand-600 via-brand-500 to-teal-300" />

            {/* Header */}
            <div className="p-6 pb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-start space-x-3.5">
                <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center shadow-sm shrink-0">
                  <i className="ph-bold ph-plugs-connected text-2xl" />
                </div>
                <div>
                  <div className="flex items-center space-x-2.5">
                    <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">Global API Configs</h2>
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                      {apiConfigs.length} Active
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                    Reusable base URLs and authentication headers shared across all journey nodes.
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2 shrink-0 self-end md:self-auto">
                <button
                  onClick={addApiConfig}
                  className="flex items-center space-x-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-4 py-2 rounded-lg shadow-sm transition active:scale-95"
                >
                  <i className="ph-bold ph-plus text-sm" />
                  <span>Add Config</span>
                </button>
                <button
                  onClick={() => setShowApiCfg(false)}
                  className="w-9 h-9 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition"
                  title="Close modal"
                >
                  <i className="ph-bold ph-x text-lg" />
                </button>
              </div>
            </div>

            {/* Filter / search row */}
            <div className="px-6 py-2.5 bg-slate-50 flex items-center justify-between gap-3 border-y border-slate-100">
              <div className="relative flex-1 max-w-sm">
                <i className="ph ph-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                <input
                  className="w-full bg-white border border-slate-200 pl-9 pr-3 py-1.5 text-xs text-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 placeholder:text-slate-400 transition"
                  placeholder="Search by name, header, or domain..."
                  value={apiCfgSearch}
                  onChange={(e) => setApiCfgSearch(e.target.value)}
                  type="text"
                />
              </div>
              <div className="flex items-center space-x-1.5 text-[11px] font-medium text-slate-500">
                <i className="ph-fill ph-lock text-brand-600 text-sm" />
                <span>AES-256 GCM Header Encryption</span>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {apiConfigs.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                    <i className="ph ph-plugs text-2xl" />
                  </div>
                  <p className="text-sm text-slate-500">
                    No API configs yet. Add one to share a base URL and auth headers across API nodes.
                  </p>
                </div>
              ) : (
                apiConfigs
                  .map((c, i) => ({ c, i }))
                  .filter(({ c }) => {
                    const q = apiCfgSearch.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      c.name.toLowerCase().includes(q) ||
                      c.baseUrl.toLowerCase().includes(q) ||
                      c.headers.some(
                        (h) => h.key.toLowerCase().includes(q) || h.value.toLowerCase().includes(q)
                      )
                    );
                  })
                  .map(({ c, i }) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
                      {/* Card header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="flex items-center space-x-3">
                          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0">
                            {i + 1}
                          </span>
                          <input
                            className="text-sm font-semibold text-slate-900 bg-slate-50 hover:bg-slate-100 px-2.5 py-1 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-500/30 transition w-56"
                            placeholder="Config name"
                            value={c.name}
                            onChange={(e) => updateApiConfig(i, { name: e.target.value })}
                            type="text"
                          />
                          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 text-[11px] font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                            <span>{c.headers.length} header{c.headers.length === 1 ? "" : "s"}</span>
                          </span>
                        </div>
                        <div className="flex items-center space-x-1 self-end sm:self-auto">
                          <button
                            onClick={() => removeApiConfig(i)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition"
                            title="Delete config"
                          >
                            <i className="ph ph-trash text-base" />
                          </button>
                        </div>
                      </div>

                      {/* Base URL + Ping */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-slate-600 flex items-center gap-1.5">
                          <span>Base URL</span>
                          <span className="text-slate-400 font-normal">(Inherited by all sub-endpoints)</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            className="flex-1 bg-slate-50 px-3.5 py-2 text-xs text-slate-800 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 border border-slate-200 font-mono transition"
                            placeholder="https://api.example.com"
                            value={c.baseUrl}
                            onChange={(e) => updateApiConfig(i, { baseUrl: e.target.value })}
                            type="text"
                          />
                          {/* status dot */}
                          <span
                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                              pingState[i] === "up" ? "bg-emerald-500"
                              : pingState[i] === "down" ? "bg-rose-500"
                              : pingState[i] === "pinging" ? "bg-amber-400 animate-pulse"
                              : "bg-slate-300"
                            }`}
                            title={
                              pingState[i] === "up" ? "Reachable"
                              : pingState[i] === "down" ? "Unreachable"
                              : pingState[i] === "pinging" ? "Checking…"
                              : "Not checked"
                            }
                          />
                          <button
                            onClick={() => pingApiConfig(i)}
                            disabled={!c.baseUrl || pingState[i] === "pinging"}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
                            title="Test if this URL / server is reachable"
                          >
                            <i className="ph-bold ph-broadcast text-sm" />
                            <span>{pingState[i] === "pinging" ? "Pinging…" : "Ping"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Shared headers */}
                      <div className="pt-1 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-semibold text-slate-800">Shared Headers</span>
                            <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 font-mono">
                              {c.headers.length} header{c.headers.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <button
                            onClick={() => addApiConfigHeader(i)}
                            className="flex items-center space-x-1 text-brand-600 hover:text-brand-700 text-[11px] font-semibold transition"
                          >
                            <i className="ph-bold ph-plus-circle text-sm" />
                            <span>Add Header</span>
                          </button>
                        </div>

                        {c.headers.length > 0 && (
                          <div className="space-y-2 bg-slate-50/70 rounded-xl p-3">
                            {c.headers.map((h, j) => {
                              const secret = /authorization|token|secret|key|bearer/i.test(h.key);
                              const revealed = revealedHeaders[`${i}-${j}`];
                              return (
                                <div key={j} className="flex items-center space-x-2">
                                  <input
                                    className="w-5/12 bg-white border border-slate-200 px-3 py-1.5 text-xs font-mono text-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                    placeholder="key (e.g. Authorization)"
                                    value={h.key}
                                    onChange={(e) => updateApiConfigHeader(i, j, "key", e.target.value)}
                                    type="text"
                                  />
                                  <div className="flex-1 relative">
                                    <input
                                      className="w-full bg-white border border-slate-200 pl-3 pr-9 py-1.5 text-xs font-mono text-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                      placeholder="value (e.g. Bearer xxx)"
                                      value={h.value}
                                      onChange={(e) => updateApiConfigHeader(i, j, "value", e.target.value)}
                                      type={secret && !revealed ? "password" : "text"}
                                    />
                                    {secret && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRevealedHeaders((r) => ({ ...r, [`${i}-${j}`]: !r[`${i}-${j}`] }))
                                        }
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 transition"
                                        title={revealed ? "Hide value" : "Show value"}
                                      >
                                        <i className={`ph ${revealed ? "ph-eye-slash" : "ph-eye"} text-sm`} />
                                      </button>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => removeApiConfigHeader(i, j)}
                                    className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                    title="Remove header"
                                  >
                                    <i className="ph ph-x text-base" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <p className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
                          <i className="ph-fill ph-shield-check text-sm text-brand-600" />
                          <span>Encrypted at rest &amp; automatically merged with payload headers on outgoing calls.</span>
                        </p>
                      </div>

                      {/* CRUD endpoints */}
                      <div className="pt-1 space-y-2.5 border-t border-slate-100">
                        <div className="flex items-center justify-between pt-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-semibold text-slate-800">Endpoints (CRUD)</span>
                            <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-500 font-mono">
                              {(c.endpoints ?? []).length}
                            </span>
                          </div>
                          <button
                            onClick={() => addApiEndpoint(i)}
                            className="flex items-center space-x-1 text-brand-600 hover:text-brand-700 text-[11px] font-semibold transition"
                          >
                            <i className="ph-bold ph-plus-circle text-sm" />
                            <span>Add Endpoint</span>
                          </button>
                        </div>

                        {(c.endpoints ?? []).map((ep, k) => {
                          const showBody = ["POST", "PUT", "PATCH"].includes(ep.method);
                          const methodColor =
                            ep.method === "GET" ? "text-emerald-700 bg-emerald-50"
                            : ep.method === "DELETE" ? "text-rose-700 bg-rose-50"
                            : "text-amber-700 bg-amber-50";
                          return (
                            <div key={ep.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                              <div className="flex items-center gap-2">
                                <select
                                  className={`text-[11px] font-bold rounded-md px-2 py-1.5 border border-slate-200 focus:outline-none ${methodColor}`}
                                  value={ep.method}
                                  onChange={(e) => updateApiEndpoint(i, k, { method: e.target.value })}
                                >
                                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                                </select>
                                <input
                                  className="flex-1 bg-white border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                  placeholder="Endpoint name (e.g. Get user)"
                                  value={ep.name}
                                  onChange={(e) => updateApiEndpoint(i, k, { name: e.target.value })}
                                />
                                <button
                                  onClick={() => removeApiEndpoint(i, k)}
                                  className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                  title="Remove endpoint"
                                >
                                  <i className="ph ph-x text-base" />
                                </button>
                              </div>
                              {/* Path — supports variables (no formatting/emoji) */}
                              <VariableTextInput
                                value={ep.path}
                                onChange={(v) => updateApiEndpoint(i, k, { path: v })}
                                variables={variables}
                                onCreateVariable={ensureVariable}
                                singleLine
                                hideFormatting
                                placeholder="/users/{{id}}  (relative to base URL)"
                              />
                              {/* Body — for write methods, supports variables */}
                              {showBody && (
                                <VariableTextInput
                                  value={ep.body ?? ""}
                                  onChange={(v) => updateApiEndpoint(i, k, { body: v })}
                                  variables={variables}
                                  onCreateVariable={ensureVariable}
                                  rows={2}
                                  hideFormatting
                                  placeholder={'{ "name": "{{f_name}}" }'}
                                />
                              )}
                            </div>
                          );
                        })}
                        {(c.endpoints ?? []).length === 0 && (
                          <p className="text-[11px] text-slate-400">
                            Define reusable operations (e.g. GET /users/{"{{id}}"}, POST /users). API nodes can pick one instead of retyping the URL.
                          </p>
                        )}
                      </div>
                    </div>
                  ))
              )}
            </div>

            {/* Footer */}
            <div className="p-5 px-6 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <span className="text-xs text-slate-500 flex items-center gap-1.5">
                <i className="ph ph-question text-base text-brand-600" />
                <span>API nodes reference these configs by name.</span>
              </span>
              <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
                <button
                  onClick={() => setShowApiCfg(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setShowApiCfg(false)}
                  className="flex items-center space-x-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold px-5 py-2 rounded-lg shadow-sm transition active:scale-95"
                >
                  <i className="ph-bold ph-check text-sm" />
                  <span>Save Configurations</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BuilderPage() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  );
}
