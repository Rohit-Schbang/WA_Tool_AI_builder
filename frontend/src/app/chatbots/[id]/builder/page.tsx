"use client";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import { WorkFlowNode } from "./workflow.Node";
import { TestPanel } from "./testPanel";
import { VariableTextInput, VariableSelect, NoReplyFallback } from "./VariableInputs";
import { layoutGraph } from "./autoLayout";

// Map React Flow node type name -> our custom component.
const nodeTypes = { workflow: WorkFlowNode };

// END removed (#8): a flow terminates naturally at a node with no outgoing edge.
// BUTTONS removed (#10): reply buttons are now part of the Send Message node.
const NODE_TYPES = [
  "SEND_MESSAGE",
  "ASK_INPUT",
  "INPUT_TYPE",
  "LIST",
  "CONDITION",
  "AI_RESPONSE",
  "SET_VARIABLE",
  "VALIDATE",
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
interface ApiConfig {
  name: string;
  baseUrl: string;
  headers: { key: string; value: string }[];
}

// Human-friendly default names per type (#3).
const TYPE_LABEL: Record<string, string> = {
  START: "Start",
  SEND_MESSAGE: "Send Message",
  ASK_INPUT: "Question",
  INPUT_TYPE: "Input",
  BUTTONS: "Buttons",
  LIST: "List",
  CONDITION: "If / Else",
  AI_RESPONSE: "AI Reply",
  SET_VARIABLE: "Set Variable",
  VALIDATE: "Validate",
  TRANSFORM: "Transform",
  API_REQUEST: "API Request",
  WAIT: "Delay",
};

// #13 — maximum delay a WAIT node may specify (in seconds). 24h.
const MAX_DELAY_SECONDS = 86400;

// Nodes that branch via their own labeled handles (per-option or true/else),
// so a plain "Connect to node" would be ambiguous for them. Send Message is
// multi-output only when it has reply buttons configured (#10).
function isMultiOutput(node: { nodeType: string; config?: any }) {
  if (["CONDITION", "VALIDATE", "API_REQUEST", "LIST"].includes(node.nodeType)) return true;
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
  const [isActive, setIsActive] = useState(false);
  const [activating, setActivating] = useState(false);
  const [publishErrors, setPublishErrors] = useState<{ message: string; nodeId?: string }[]>([]);
  const [seqCounter, setSeqCounter] = useState(1);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const params = useParams();
  const chatbotId = params.id as string;

  // React Flow instance — lets us pan/zoom to a node (#4, #6, #14).
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds)),
    [setEdges]
  );

  // Auto-layout the graph into a clean tree using dagre (#tree layout).
  const autoLayout = useCallback((direction: "TB" | "LR") => {
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
    // Place near the current viewport center so it's visible.
    const rf = rfRef.current;
    let position = { x: 200 + Math.random() * 150, y: 200 + Math.random() * 150 };
    if (rf) {
      const center = rf.screenToFlowPosition
        ? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
        : null;
      if (center) position = { x: center.x, y: center.y };
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
    // auto-select + focus after the node is in the tree
    setTimeout(() => focusNode(id), 50);
  }

  // ---------------------- SAVE DRAFT ----------------------
  async function handleSave() {
    setSaving(true);
    setSavedMsg("");
    const definition = {
      version: 1,
      variables, // #2 — persist workflow-level variables
      apiConfigs, // #1 — persist global API configs
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
    };
    try {
      await api.put(`/api/chatbots/${chatbotId}/workflow/draft`, { definition });
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
  }, []);

  // Connect the selected node to another node (#6 — "Connect to node").
  // Creates an edge from selected -> target (single-output nodes only).
  function connectToNode(targetId: string) {
    if (!selectedId || targetId === selectedId) return;
    setEdges((eds) => {
      // Avoid duplicate identical edges.
      const exists = eds.some(
        (e) => e.source === selectedId && e.target === targetId && (e.sourceHandle ?? null) === null
      );
      if (exists) return eds;
      return addEdge(
        { id: makeId(), source: selectedId, target: targetId, sourceHandle: null },
        eds
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
    const name = newVar.name.trim();
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
  function ensureVariable(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setVariables((vs) =>
      vs.some((v) => v.name === trimmed) ? vs : [...vs, { name: trimmed, type: "text", default: "" }]
    );
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

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    if (window.confirm("Delete this connection?")) {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    }
  }, [setEdges]);

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
      return {
        ...n,
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
      if (handle === "true") return node.data.nodeType === "VALIDATE" ? "pass" : node.data.nodeType === "API_REQUEST" ? "success" : "true";
      if (handle === "else") return node.data.nodeType === "VALIDATE" ? "fail" : node.data.nodeType === "API_REQUEST" ? "failure" : "else";
      // Option handles: match against buttons/rows.
      const opts = [...(cfg.buttons ?? []), ...(cfg.rows ?? [])];
      const opt = opts.find((o: any) => o.id === handle);
      return opt?.label || undefined;
    };
    return edges.map((e) => {
      const label = labelFor(e.source, e.sourceHandle);
      return {
        ...e,
        type: e.type ?? "smoothstep",
        label,
        labelStyle: { fontSize: 10, fontWeight: 600, fill: "#475569" },
        labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
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
  useEffect(() => {
    async function loadDraft() {
      try {
        const response = await api.get(`/api/chatbots/${chatbotId}/workflow/draft`);
        const def = response.data.definition;

        const loadedNodes: Node[] = def.nodes.map((node: any) => ({
          id: node.id,
          type: "workflow",
          position: node.position,
          data: {
            nodeType: node.nodeType,
            config: node.config ?? {},
            seq: node.seq,
            onDelete: deleteNode,
          },
        }));

        const loadedEdges: Edge[] = def.edges.map((edge: any) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? undefined,
          type: "smoothstep",
        }));

        api.get(`/api/chatbots/${chatbotId}`)
          .then((res) => setIsActive(res.data.isActive))
          .catch(() => { });

        setNodes(loadedNodes);
        setEdges(loadedEdges);
        if (Array.isArray(def.variables)) setVariables(def.variables);
        if (Array.isArray(def.apiConfigs)) setApiConfigs(def.apiConfigs);

        const maxSeq = def.nodes.reduce((m: number, n: any) => Math.max(m, n.seq ?? 0), 0);
        setSeqCounter(maxSeq + 1);
      } catch (error) {
        /* no draft yet — keep default START */
      }
    }
    loadDraft();
  }, []);

  // Other nodes for the "Go To Node" dropdown (#6).
  const otherNodes = nodes.filter((n) => n.id !== selectedId);

  return (
    <div className="flex h-screen w-screen">
      {/* Palette */}
      <aside className="w-52 shrink-0 bg-base-100 border-r border-base-300 p-4 overflow-y-auto">
        <h2 className="font-bold mb-3">Nodes</h2>
        <div className="flex flex-col gap-2">
          {NODE_TYPES.map((t) => (
            <button key={t} onClick={() => addNode(t)} className="btn btn-sm btn-outline justify-start">
              + {TYPE_LABEL[t] ?? t}
            </button>
          ))}
        </div>
      </aside>

      {/* Canvas */}
      <div className="flex-1 flex flex-col">
        <div className="p-2 border-b border-base-300 bg-base-100">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleToggleActive}
              disabled={activating}
              className={`btn btn-sm ${isActive ? "btn-warning" : "btn-success"}`}
            >
              {activating ? "..." : isActive ? "Deactivate" : "Activate"}
            </button>
            <button onClick={handleSave} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? "Saving..." : "Save draft"}
            </button>
            <button onClick={handlePublish} disabled={publishing} className="btn btn-success btn-sm">
              {publishing ? "Publishing..." : "Publish"}
            </button>

            {/* #2 — workflow variables (modal-based, no canvas shift) */}
            <button onClick={() => setShowVarList(true)} className="btn btn-sm btn-outline">
              Variables ({variables.length})
            </button>
            {/* #1 — global API configs */}
            <button onClick={() => setShowApiCfg(true)} className="btn btn-sm btn-outline">
              API Configs ({apiConfigs.length})
            </button>

            {/* Auto-layout: arrange nodes into a clean tree */}
            <div className="join">
              <button onClick={() => autoLayout("TB")} className="btn btn-sm btn-outline join-item" title="Arrange vertically">
                ⬇ Vertical
              </button>
              <button onClick={() => autoLayout("LR")} className="btn btn-sm btn-outline join-item" title="Arrange horizontally">
                ➡ Horizontal
              </button>
            </div>

            {/* #14 — node search */}
            <div className="relative ml-auto">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search nodes..."
                className="input input-bordered input-sm w-56"
              />
              {searchMatches.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full bg-base-100 border border-base-300 rounded shadow max-h-64 overflow-y-auto">
                  {searchMatches.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => { goToSearchResult(n.id); setSearch(""); }}
                        className="w-full text-left px-3 py-2 hover:bg-base-200 text-sm"
                      >
                        <span className="font-medium">{nodeName(n)}</span>
                        <span className="text-base-content/50 ml-2 text-xs">{n.data.nodeType}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {savedMsg && <span className="text-sm text-base-content/70">{savedMsg}</span>}
            {publishMsg && <span className="text-sm font-medium">{publishMsg}</span>}
          </div>
          {publishErrors.length > 0 && (
            <ul className="mt-2 text-sm text-error space-y-1">
              {publishErrors.map((e, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span>•</span>
                  {e.nodeId ? (
                    <button
                      onClick={() => { focusNode(e.nodeId!); setSearchHighlightId(e.nodeId!); setTimeout(() => setSearchHighlightId(null), 2500); }}
                      className="text-left underline decoration-dotted hover:decoration-solid"
                      title="Go to this node"
                    >
                      {e.message} <span className="text-xs opacity-70">(click to view)</span>
                    </button>
                  ) : (
                    <span>{e.message}</span>
                  )}
                </li>
              ))}
            </ul>
          )}

        </div>

        <div className="flex-1">
          <ReactFlow
            nodes={nodesForFlow}
            edges={edgesForFlow}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={{ type: "smoothstep" }}
            onInit={(inst) => { rfRef.current = inst; }}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      {/* Config panel */}
      {selectedNode && (
        <aside className="w-80 shrink-0 bg-base-100 border-l border-base-300 p-4 overflow-y-auto">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{nodeName(selectedNode)}</h2>
              <div className="flex gap-1">
                {selectedNode.data.nodeType !== "START" && (
                  <button onClick={deleteSelectedNode} className="btn btn-xs btn-error btn-outline">
                    Delete
                  </button>
                )}
                <button onClick={() => setSelectedId(null)} className="btn btn-xs btn-ghost" title="Close">✕</button>
              </div>
            </div>

            {/* #3 — editable node name (all nodes) */}
            <label className="form-control">
              <span className="label-text">Node name</span>
              <input
                className="input input-bordered input-sm"
                value={selectedNode.data.config.name ?? ""}
                placeholder={`${TYPE_LABEL[selectedNode.data.nodeType] ?? selectedNode.data.nodeType} ${selectedNode.data.seq}`}
                onChange={(e) => updateConfig("name", e.target.value)}
              />
            </label>

            {/* #6 — Connect to node: wires an edge from this node to another.
                Only for single-output nodes (Condition/Validate/Buttons/List
                use their own labeled handles instead). */}
            {!isMultiOutput({ nodeType: selectedNode.data.nodeType, config: selectedNode.data.config }) && otherNodes.length > 0 && (
              <label className="form-control">
                <span className="label-text">Connect to node</span>
                <select
                  className="select select-bordered select-sm"
                  value=""
                  onChange={(e) => { if (e.target.value) connectToNode(e.target.value); }}
                >
                  <option value="">Connect this node to…</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>{nodeName(n)}</option>
                  ))}
                </select>
              </label>
            )}

            <div className="divider my-0" />

            {selectedNode.data.nodeType === "SEND_MESSAGE" && (
              <>
                {/* #12 — Header */}
                <label className="form-control">
                  <span className="label-text">Header (optional)</span>
                  <select
                    className="select select-bordered select-sm"
                    value={selectedNode.data.config.header?.type ?? ""}
                    onChange={(e) => updateNestedConfig("header", "type", e.target.value)}
                  >
                    <option value="">None</option>
                    <option value="text">Text</option>
                    <option value="image">Image</option>
                    <option value="document">Document</option>
                    <option value="video">Video</option>
                  </select>
                </label>
                {selectedNode.data.config.header?.type && (
                  <label className="form-control">
                    <span className="label-text">
                      {selectedNode.data.config.header.type === "text" ? "Header text" : "Media URL"}
                    </span>
                    <input
                      className="input input-bordered input-sm"
                      placeholder={selectedNode.data.config.header.type === "text" ? "Header" : "https://..."}
                      value={selectedNode.data.config.header?.value ?? ""}
                      onChange={(e) => updateNestedConfig("header", "value", e.target.value)}
                    />
                  </label>
                )}

                {/* #12 — media preview for image/video/document headers */}
                {selectedNode.data.config.header?.type &&
                  selectedNode.data.config.header?.type !== "text" &&
                  selectedNode.data.config.header?.value && (
                    <div className="border border-base-200 rounded p-2 bg-base-200/30">
                      <span className="text-[11px] text-base-content/50 block mb-1">Preview</span>
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
                          className="flex items-center gap-2 text-sm text-primary hover:underline break-all"
                        >
                          📄 {selectedNode.data.config.header.value.split("/").pop() || "Open document"}
                        </a>
                      )}
                      <p className="text-[10px] text-base-content/40 mt-1">
                        If nothing shows, the URL may be private or not directly embeddable.
                      </p>
                    </div>
                  )}

                {/* #12 — Body */}
                <label className="form-control">
                  <span className="label-text">Message text (body)</span>
                  <VariableTextInput
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(v) => updateConfig("text", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="Type your message…"
                  />
                </label>

                {/* #12 — Footer */}
                <label className="form-control">
                  <span className="label-text">Footer (optional)</span>
                  <VariableTextInput
                    value={selectedNode.data.config.footer ?? ""}
                    onChange={(v) => updateConfig("footer", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                  />
                </label>

                {/* #10 — buttons: each is either a CTA (branches to a node)
                    or a Visit URL (opens a link). Max 3. */}
                <div className="divider my-1 text-xs">Buttons (optional, max 3)</div>
                {(selectedNode.data.config.buttons ?? []).map((b: any) => {
                  const target = (nodesForFlow.find((n) => n.id === selectedId)?.data.optionTargets ?? {})[b.id];
                  const kind = b.kind ?? "cta";
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
                      <select
                        className="select select-bordered select-xs"
                        value={kind}
                        onChange={(e) => updateOptionField(b.id, "kind", e.target.value)}
                      >
                        <option value="cta">CTA (branch to a node)</option>
                        <option value="url">Visit URL (open link)</option>
                      </select>
                      {kind === "url" ? (
                        <input
                          className="input input-bordered input-xs"
                          placeholder="https://example.com/{{var}}"
                          value={b.url ?? ""}
                          onChange={(e) => updateOptionField(b.id, "url", e.target.value)}
                        />
                      ) : (
                        <div className="text-[11px]">
                          {target ? (
                            <span className="text-success">Connected → {target}</span>
                          ) : (
                            <span className="text-base-content/40">Not Connected</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {(selectedNode.data.config.buttons ?? []).length < 3 && (
                  <button onClick={() => addOption(3)} className="btn btn-sm btn-outline">+ Add button</button>
                )}
                <p className="text-xs text-base-content/50">
                  CTA buttons branch the flow; Visit URL buttons open a link. Note: WhatsApp
                  doesn't allow mixing reply buttons and URL buttons in one message.
                </p>
              </>
            )}

            {selectedNode.data.nodeType === "ASK_INPUT" && (
              <>
                <label className="form-control">
                  <span className="label-text">Question text</span>
                  <VariableTextInput
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(v) => updateConfig("text", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="Ask something…"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Footer (optional)</span>
                  <VariableTextInput
                    value={selectedNode.data.config.footer ?? ""}
                    onChange={(v) => updateConfig("footer", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                    placeholder="Footer text…"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Save answer to variable</span>
                  <VariableSelect
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(v) => updateConfig("variable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                </label>

                {/* Validation */}
                <label className="form-control">
                  <span className="label-text">Validation type</span>
                  <select
                    className="select select-bordered select-sm"
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
                </label>
                {selectedNode.data.config.validationType === "custom" && (
                  <label className="form-control">
                    <span className="label-text">Regex expression</span>
                    <input
                      className="input input-bordered input-sm font-mono"
                      placeholder="^[A-Za-z0-9]+$"
                      value={selectedNode.data.config.regex ?? ""}
                      onChange={(e) => updateConfig("regex", e.target.value)}
                    />
                    <span className="text-[11px] text-base-content/50 mt-1">
                      Examples — Phone: <code>^\+?[0-9]{"{10,15}"}$</code> · Email: <code>^[^\s@]+@[^\s@]+\.[^\s@]+$</code> · URL: <code>^https?:\/\/.+$</code>
                    </span>
                  </label>
                )}

                {/* Retry + failure (only relevant when validating) */}
                {selectedNode.data.config.validationType &&
                  selectedNode.data.config.validationType !== "none" && (
                    <>
                      <label className="form-control">
                        <span className="label-text">Retry limit (max 5)</span>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          className="input input-bordered input-sm w-24"
                          value={selectedNode.data.config.retryLimit ?? 3}
                          onChange={(e) => {
                            const n = Math.max(1, Math.min(5, Number(e.target.value) || 1));
                            updateConfig("retryLimit", n);
                          }}
                        />
                        <span className="text-[11px] text-base-content/50 mt-1">
                          After this many failed attempts, the failure message is shown and the flow continues.
                        </span>
                      </label>
                      <label className="form-control">
                        <span className="label-text">Failure / invalid message</span>
                        <VariableTextInput
                          value={selectedNode.data.config.failureMessage ?? ""}
                          onChange={(v) => updateConfig("failureMessage", v)}
                          variables={variables}
                          onCreateVariable={ensureVariable}
                          placeholder="That doesn't look valid. Please try again."
                        />
                      </label>
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
              </>
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
                <div className="text-sm font-medium mt-2">Rows (max 10)</div>
                {(selectedNode.data.config.rows ?? []).map((r: any) => {
                  const target = (nodesForFlow.find((n) => n.id === selectedId)?.data.optionTargets ?? {})[r.id];
                  return (
                    <div key={r.id} className="flex flex-col gap-1 border border-base-200 rounded p-2">
                      <div className="flex gap-1 items-center">
                        <input
                          className="input input-bordered input-sm flex-1"
                          placeholder="Row label"
                          value={r.label}
                          onChange={(e) => updateOption(r.id, e.target.value)}
                        />
                        <button onClick={() => removeOption(r.id)} className="btn btn-xs btn-ghost text-error">✕</button>
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
                {(selectedNode.data.config.rows ?? []).length < 10 && (
                  <button onClick={() => addOption(10)} className="btn btn-sm btn-outline">+ Add row</button>
                )}
              </>
            )}

            {selectedNode.data.nodeType === "INPUT_TYPE" && (
              <>
                <label className="form-control">
                  <span className="label-text">Prompt text</span>
                  <VariableTextInput
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(v) => updateConfig("text", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    placeholder="e.g. What's your email?"
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Expected input type</span>
                  <select
                    className="select select-bordered select-sm"
                    value={selectedNode.data.config.inputType ?? "text"}
                    onChange={(e) => updateConfig("inputType", e.target.value)}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="email">Email</option>
                    <option value="phone">Phone number</option>
                    <option value="image">Image (URL)</option>
                    <option value="video">Video (URL)</option>
                    <option value="document">Document (URL)</option>
                    <option value="location">Location (lat,lng)</option>
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">Store answer in variable</span>
                  <VariableSelect
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(v) => updateConfig("variable", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Invalid input message (optional)</span>
                  <VariableTextInput
                    value={selectedNode.data.config.invalidMessage ?? ""}
                    onChange={(v) => updateConfig("invalidMessage", v)}
                    variables={variables}
                    onCreateVariable={ensureVariable}
                    singleLine
                    placeholder="That doesn't look right. Try again."
                  />
                </label>

                {/* No-response timeout fallback */}
                <NoReplyFallback
                  node={selectedNode}
                  otherNodes={otherNodes}
                  nodeName={nodeName}
                  updateConfig={updateConfig}
                  variables={variables}
                  onCreateVariable={ensureVariable}
                />
              </>
            )}

            {selectedNode.data.nodeType === "VALIDATE" && (
              <>
                <label className="form-control">
                  <span className="label-text">Validation mode</span>
                  <select
                    className="select select-bordered select-sm"
                    value={selectedNode.data.config.mode ?? "expression"}
                    onChange={(e) => updateConfig("mode", e.target.value)}
                  >
                    <option value="expression">JavaScript expression</option>
                    <option value="regex">Regex</option>
                  </select>
                </label>
                {(selectedNode.data.config.mode ?? "expression") === "regex" ? (
                  <>
                    <label className="form-control">
                      <span className="label-text">Value to test (supports {"{{var}}"})</span>
                      <input
                        className="input input-bordered input-sm"
                        placeholder="{{email}}"
                        value={selectedNode.data.config.value ?? ""}
                        onChange={(e) => updateConfig("value", e.target.value)}
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Regex pattern</span>
                      <input
                        className="input input-bordered input-sm font-mono"
                        placeholder="^[^@]+@[^@]+\\.[^@]+$"
                        value={selectedNode.data.config.pattern ?? ""}
                        onChange={(e) => updateConfig("pattern", e.target.value)}
                      />
                    </label>
                    <label className="form-control">
                      <span className="label-text">Regex flags (optional)</span>
                      <input
                        className="input input-bordered input-sm font-mono"
                        placeholder="i"
                        value={selectedNode.data.config.flags ?? ""}
                        onChange={(e) => updateConfig("flags", e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <label className="form-control">
                    <span className="label-text">JS expression (use vars.name)</span>
                    <textarea
                      className="textarea textarea-bordered font-mono text-xs"
                      rows={3}
                      placeholder="vars.age >= 18"
                      value={selectedNode.data.config.expression ?? ""}
                      onChange={(e) => updateConfig("expression", e.target.value)}
                    />
                  </label>
                )}
                <p className="text-xs text-base-content/50">
                  Connect the <span className="text-success">pass</span> and <span className="text-error">fail</span> handles to the next nodes.
                </p>
              </>
            )}

            {selectedNode.data.nodeType === "TRANSFORM" && (
              <>
                <label className="form-control">
                  <span className="label-text">JS expression (use vars.name)</span>
                  <textarea
                    className="textarea textarea-bordered font-mono text-xs"
                    rows={3}
                    placeholder="vars.name.toUpperCase()"
                    value={selectedNode.data.config.expression ?? ""}
                    onChange={(e) => updateConfig("expression", e.target.value)}
                  />
                </label>
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
                    onChange={(e) => updateConfig("apiConfig", e.target.value)}
                  >
                    <option value="">None</option>
                    {apiConfigs.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </label>
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
                  <input
                    className="input input-bordered input-sm"
                    placeholder="https://api.example.com/users/{{id}}"
                    value={selectedNode.data.config.url ?? ""}
                    onChange={(e) => updateConfig("url", e.target.value)}
                  />
                </label>

                {/* Headers */}
                <div className="text-sm font-medium mt-1">Headers</div>
                {(selectedNode.data.config.headers ?? []).map((hdr: any, idx: number) => (
                  <div key={idx} className="flex gap-1">
                    <input className="input input-bordered input-xs flex-1" placeholder="key" value={hdr.key ?? ""}
                      onChange={(e) => updateKeyValList("headers", idx, "key", e.target.value)} />
                    <input className="input input-bordered input-xs flex-1" placeholder="value" value={hdr.value ?? ""}
                      onChange={(e) => updateKeyValList("headers", idx, "value", e.target.value)} />
                    <button onClick={() => removeKeyValList("headers", idx)} className="btn btn-xs btn-ghost text-error">✕</button>
                  </div>
                ))}
                <button onClick={() => addKeyValList("headers")} className="btn btn-xs btn-outline">+ Header</button>

                {/* Query params */}
                <div className="text-sm font-medium mt-1">Query params</div>
                {(selectedNode.data.config.query ?? []).map((q: any, idx: number) => (
                  <div key={idx} className="flex gap-1">
                    <input className="input input-bordered input-xs flex-1" placeholder="key" value={q.key ?? ""}
                      onChange={(e) => updateKeyValList("query", idx, "key", e.target.value)} />
                    <input className="input input-bordered input-xs flex-1" placeholder="value" value={q.value ?? ""}
                      onChange={(e) => updateKeyValList("query", idx, "value", e.target.value)} />
                    <button onClick={() => removeKeyValList("query", idx)} className="btn btn-xs btn-ghost text-error">✕</button>
                  </div>
                ))}
                <button onClick={() => addKeyValList("query")} className="btn btn-xs btn-outline">+ Query param</button>

                {/* Body */}
                {["POST", "PUT", "PATCH"].includes(selectedNode.data.config.method ?? "GET") && (
                  <label className="form-control">
                    <span className="label-text">Request body (JSON, supports {"{{var}}"})</span>
                    <textarea
                      className="textarea textarea-bordered font-mono text-xs"
                      rows={3}
                      placeholder={'{ "name": "{{name}}" }'}
                      value={selectedNode.data.config.body ?? ""}
                      onChange={(e) => updateConfig("body", e.target.value)}
                    />
                  </label>
                )}

                {/* Response mapping */}
                <div className="text-sm font-medium mt-1">Map response → variables</div>
                {(selectedNode.data.config.responseMap ?? []).map((m: any, idx: number) => (
                  <div key={idx} className="flex gap-1">
                    <input className="input input-bordered input-xs flex-1" placeholder="response path (e.g. data.id)" value={m.path ?? ""}
                      onChange={(e) => updateKeyValList("responseMap", idx, "path", e.target.value)} />
                    <input className="input input-bordered input-xs flex-1" placeholder="variable" value={m.variable ?? ""}
                      onChange={(e) => updateKeyValList("responseMap", idx, "variable", e.target.value)} />
                    <button onClick={() => removeKeyValList("responseMap", idx)} className="btn btn-xs btn-ghost text-error">✕</button>
                  </div>
                ))}
                <button onClick={() => addKeyValList("responseMap")} className="btn btn-xs btn-outline">+ Mapping</button>

                <label className="form-control mt-1">
                  <span className="label-text">Store status code in (optional)</span>
                  <input className="input input-bordered input-sm" placeholder="apiStatus" value={selectedNode.data.config.statusVariable ?? ""}
                    onChange={(e) => updateConfig("statusVariable", e.target.value)} />
                </label>
                <p className="text-xs text-base-content/50">
                  Connect the <span className="text-success">success</span> and <span className="text-error">failure</span> handles. Failure fires on non-2xx or timeout.
                </p>
              </>
            )}

            {selectedNode.data.nodeType === "START" && (
              <>
                <label className="form-control">
                  <span className="label-text">Trigger keywords (one per line)</span>
                  <textarea
                    className="textarea textarea-bordered"
                    rows={4}
                    placeholder={"hi\nhello\nstart"}
                    value={(selectedNode.data.config.keywords ?? []).join("\n")}
                    onChange={(e) =>
                      updateConfig(
                        "keywords",
                        e.target.value.split("\n").map((k) => k.trim()).filter(Boolean)
                      )
                    }
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Match type</span>
                  <select
                    className="select select-bordered select-sm"
                    value={selectedNode.data.config.matchType ?? "contains"}
                    onChange={(e) => updateConfig("matchType", e.target.value)}
                  >
                    <option value="contains">Contains keyword</option>
                    <option value="exact">Exact match</option>
                    <option value="starts_with">Starts with keyword</option>
                  </select>
                </label>
                <p className="text-xs text-base-content/50">
                  Leave keywords empty to trigger on any message.
                </p>
              </>
            )}
          </div>
        </aside>
      )}

      <TestPanel chatbotId={chatbotId} />

      {/* #2 — View Variables modal (overlay, does not shift the canvas) */}
      {showVarList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowVarList(false)}>
          <div className="bg-base-100 rounded-lg shadow-xl w-[520px] max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Workflow Variables</h3>
              <div className="flex gap-2">
                <button onClick={openAddVariable} className="btn btn-sm btn-primary">+ Add Variable</button>
                <button onClick={() => setShowVarList(false)} className="btn btn-sm btn-ghost">✕</button>
              </div>
            </div>
            {variables.length === 0 ? (
              <p className="text-sm text-base-content/50 py-6 text-center">
                No variables yet. Add one to reference it across nodes with {"{{name}}"}.
              </p>
            ) : (
              <table className="table table-sm">
                <thead>
                  <tr><th>Name</th><th>Type</th><th>Stores (default)</th><th></th></tr>
                </thead>
                <tbody>
                  {variables.map((v) => (
                    <tr key={v.name}>
                      <td className="font-mono">{v.name}</td>
                      <td><span className="badge badge-ghost badge-sm">{v.type}</span></td>
                      <td className="text-base-content/70">{v.default || <span className="text-base-content/30">—</span>}</td>
                      <td>
                        <button onClick={() => removeVariable(v.name)} className="btn btn-xs btn-ghost text-error">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* #2 — Add Variable modal */}
      {showVarAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowVarAdd(false)}>
          <div className="bg-base-100 rounded-lg shadow-xl w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-lg mb-4">Add Variable</h3>
            <div className="flex flex-col gap-3">
              <label className="form-control">
                <span className="label-text">Variable name</span>
                <input
                  autoFocus
                  className="input input-bordered"
                  placeholder="e.g. order_id"
                  value={newVar.name}
                  onChange={(e) => setNewVar((v) => ({ ...v, name: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") saveNewVariable(); }}
                />
              </label>
              <label className="form-control">
                <span className="label-text">Data type</span>
                <select
                  className="select select-bordered"
                  value={newVar.type}
                  onChange={(e) => setNewVar((v) => ({ ...v, type: e.target.value as WorkflowVariable["type"] }))}
                >
                  {VARIABLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="form-control">
                <span className="label-text">Default value (optional)</span>
                <input
                  className="input input-bordered"
                  placeholder="default value"
                  value={newVar.default}
                  onChange={(e) => setNewVar((v) => ({ ...v, default: e.target.value }))}
                />
              </label>
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setShowVarAdd(false)} className="btn btn-sm btn-ghost">Cancel</button>
                <button onClick={saveNewVariable} disabled={!newVar.name.trim()} className="btn btn-sm btn-primary">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* #1 — Global API Configs modal */}
      {showApiCfg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowApiCfg(false)}>
          <div className="bg-base-100 rounded-lg shadow-xl w-[600px] max-h-[80vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg">Global API Configs</h3>
                <p className="text-xs text-base-content/50">Reusable base URL + shared headers. API nodes reference these by name.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={addApiConfig} className="btn btn-sm btn-primary">+ Add Config</button>
                <button onClick={() => setShowApiCfg(false)} className="btn btn-sm btn-ghost">✕</button>
              </div>
            </div>
            {apiConfigs.length === 0 ? (
              <p className="text-sm text-base-content/50 py-6 text-center">
                No API configs yet. Add one to share a base URL and auth headers across API nodes.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {apiConfigs.map((c, i) => (
                  <div key={i} className="border border-base-300 rounded p-3">
                    <div className="flex gap-2 items-center mb-2">
                      <input
                        className="input input-bordered input-sm w-40"
                        placeholder="config name"
                        value={c.name}
                        onChange={(e) => updateApiConfig(i, { name: e.target.value })}
                      />
                      <input
                        className="input input-bordered input-sm flex-1"
                        placeholder="Base URL (e.g. https://api.example.com)"
                        value={c.baseUrl}
                        onChange={(e) => updateApiConfig(i, { baseUrl: e.target.value })}
                      />
                      <button onClick={() => removeApiConfig(i)} className="btn btn-xs btn-ghost text-error">✕</button>
                    </div>
                    <div className="text-xs font-medium mb-1">Shared headers</div>
                    {c.headers.map((h, j) => (
                      <div key={j} className="flex gap-1 mb-1">
                        <input className="input input-bordered input-xs flex-1" placeholder="key (e.g. Authorization)" value={h.key}
                          onChange={(e) => updateApiConfigHeader(i, j, "key", e.target.value)} />
                        <input className="input input-bordered input-xs flex-1" placeholder="value (e.g. Bearer xxx)" value={h.value}
                          onChange={(e) => updateApiConfigHeader(i, j, "value", e.target.value)} />
                        <button onClick={() => removeApiConfigHeader(i, j)} className="btn btn-xs btn-ghost text-error">✕</button>
                      </div>
                    ))}
                    <button onClick={() => addApiConfigHeader(i)} className="btn btn-xs btn-outline mt-1">+ Header</button>
                  </div>
                ))}
              </div>
            )}
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
