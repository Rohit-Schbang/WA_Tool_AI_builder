"use client";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import { WorkFlowNode } from "./workflow.Node";
import { TestPanel } from "./testPanel";

// Map React Flow node type name -> our custom component.
const nodeTypes = { workflow: WorkFlowNode };

const NODE_TYPES = [
  "START",
  "SEND_MESSAGE",
  "ASK_INPUT",
  "BUTTONS",
  "LIST",
  "CONDITION",
  "SET_VARIABLE",
  "WAIT",
  "END",
] as const;

type WorkflowNodeType = (typeof NODE_TYPES)[number];

const initialNodes: Node[] = [
  {
    id: "start",
    position: { x: 300, y: 40 },
    data: { nodeType: "START", label: "START", config: {}, seq: 0 },
  },
];

const initialEdges: Edge[] = [];

function makeId() {
  return "n_" + Math.random().toString(36).slice(2, 9);
}

// >>>>>>>>>>>>>>>>>>>>>> Builder function for the Component >>>>>>>>>>>>>>>>>


export default function BuilderPage() {

  // >>>>>>>>>>>>>>>>>>>>>>>>            STATES             <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [publishing, setPublishing] = useState(false)
  const [publishMsg, setPublishMsg] = useState("")
  const [isActive, setIsActive] = useState(false);
  const [activating, setActivating] = useState(false);

  const [publishErrors, setPublishErrors] = useState<string[]>([])

  const [seqCounter, setSeqCounter] = useState(1);                                                      // Ever-increasing counter so each node gets a stable unique number.

  const params = useParams();
  const chatbotId = params.id as string
  const [saving, setSaving] = useState(false)                                                               // ----------------------------->>>>>>>> Saving State of the Draft
  const [savedMsg, setSavedMsg] = useState("")

  // The id of the node currently selected for editing (null = none).
  const [selectedId, setSelectedId] = useState<string | null>(null);


  // >>>>>>>>>>>>>>>>>>>         Publish Journey handler function       <<<<<<<<<<<<<<<<<<<<<<

  async function handlePublish() {

    setPublishing(true)
    setPublishMsg("")
    setPublishErrors([])


    await handleSave()

    try {
      const response = await api.post(`/api/chatbots/${chatbotId}/workflow/publish`, {})
      setPublishMsg(`Published v${response.data.version}`)
    } catch (error: any) {
      console.log(error)
      if (error.response.status === 422) {
        // Validation falied  - show the list of the problems
        setPublishErrors(error.response.data.details ?? [])
        setPublishMsg("Fix the issues to publish")
      }
      else setPublishMsg("Publish Failed")
    }
    finally {
      setPublishing(false)
    }

  }

  // >>>>>>>>>>>>>>>>>>>         Activate / Deactivate  handler function       <<<<<<<<<<<<<<<<<<<<<<


  async function handleToggleActive() {
    setActivating(true)
    try {
      const res = await api.patch(`/api/chatbots/${chatbotId}/activate`, { isActive: !isActive })
      setIsActive(res.data.isActive)                                      // ------------->>>>>>>>>>      Dynamically toggling of status
    } catch (error) {
      // ignore; button stays as it is 
    }
    finally {
      setActivating(false)
    }
  }

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges]
  );

  function addNode(nodeType: WorkflowNodeType) {

    const seq = seqCounter
    const newNode: Node = {
      id: makeId(),
      position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
      type: "workflow",
      data: {
        nodeType,
        label: `${nodeType.replace("_", " ")} #${seq}`,
        config: {},
        seq,
        onDelete: deleteNode,
      },
    };
    setNodes((nds) => [...nds, newNode]);
    setSeqCounter((count) => count + 1)
  }


  // ---------------------------->>>>>>>> Saving the Draft >>> JSON

  async function handleSave() {

    setSaving(true)
    setSavedMsg("")

    // Convrsion of actula nodes to JSON ------------->>>>>>>>>>>>

    const definition = {
      version: 1,
      nodes: nodes.map((node) => (
        {
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
        sourceHandle: edge.sourceHandle ?? null
      }))
    }

    // API Call for the Conversion to be saved ---------------->>>>>>>>>>>>>

    try {
      await api.put(`/api/chatbots/${chatbotId}/workflow/draft`, { definition })
      setSavedMsg("Saved")
    } catch (error) {
      setSavedMsg("Save Failed")
    }
    finally {
      setSaving(false)
    }

  }

  // React Flow calls this when a node is clicked.
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedId(node.id);
  }, []);

  // The currently selected node object (or undefined).
  const selectedNode = nodes.find((n) => n.id === selectedId);

  // Update one field inside the selected node's config.
  function updateConfig(key: string, value: string) {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
          : n
      )
    );
  }

  // --- Options (buttons/rows) management for BUTTONS and LIST nodes ---
  // The config key is "buttons" for BUTTONS, "rows" for LIST.

  function optionsKey(nodeType: string) {
    return nodeType === "BUTTONS" ? "buttons" : "rows";
  }

  // Add a new empty option (respecting the max) to the selected node.
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

  // Update one option's label.
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

  // Remove an option and any edge that used its handle.
  function removeOption(optId: string) {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const key = optionsKey(n.data.nodeType);
        const list = (n.data.config[key] ?? []).filter((o: any) => o.id !== optId);
        return { ...n, data: { ...n.data, config: { ...n.data.config, [key]: list } } };
      })
    );
    // Remove the edge whose sourceHandle was this option.
    setEdges((eds) => eds.filter((e) => e.sourceHandle !== optId));
  }

  // Delete a node by id (used by the ✕ button on each node) and any
  // edges connected to it. Refuses to delete the START node.
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

  // Delete the currently selected node (used by the config panel button).
  function deleteSelectedNode() {
    if (selectedId) deleteNode(selectedId);
  }

  // Delete an edge when it's clicked (asks for confirmation first).
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    if (window.confirm("Delete this connection?")) {
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    }
  }, [setEdges]);


  //  <<<<<<<<-----------------------     RENDER   ( Loading the draft if present )    ------------------------>>>>>>>>

  useEffect(() => {

    async function loadDraft() {

      try {
        const response = await api.get(`/api/chatbots/${chatbotId}/workflow/draft`)
        const def = response.data.definition              // ---------------- extracted the JSON definition as draft using ID

        // Rebuiling the definition received as the a flow in the saved shape

        const loadedNodes: Node[] = def.nodes.map((node: any) => ({
          id: node.id,
          type: "workflow",
          position: node.position,
          data: {
            nodeType: node.nodeType,
            label: `${node.nodeType} #${node.seq}`,
            config: node.config ?? {},
            seq: node.seq,
            onDelete: deleteNode,
          }
        }))

        const loadedEdges: Edge[] = def.edges.map((edge: any) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? undefined
        }))

        // Fetch the chatbot to know its current active state.
        api.get(`/api/chatbots/${chatbotId}`)
          .then((res) => setIsActive(res.data.isActive))
          .catch(() => { });

        setNodes(loadedNodes)
        setEdges(loadedEdges)

        // Continue numbering above the highest saved seq.
        const maxSeq = def.nodes.reduce((m: number, n: any) => Math.max(m, n.seq ?? 0), 0);
        setSeqCounter(maxSeq + 1)
      } catch (error) {
        // 404 --->> no draft yet; keeping the default START node, That's fine.
      }
    }

    loadDraft()

  }, [])


  return (
    <div className="flex h-screen w-screen">
      {/* Palette */}
      <aside className="w-52 shrink-0 bg-base-100 border-r border-base-300 p-4 overflow-y-auto">
        <h2 className="font-bold mb-3">Nodes</h2>
        <div className="flex flex-col gap-2">
          {NODE_TYPES.map((t) => (
            <button key={t} onClick={() => addNode(t)} className="btn btn-sm btn-outline justify-start">
              + {t.replace("_", " ")}
            </button>
          ))}
        </div>
      </aside>
      {/* Canvas */}
      <div className="flex-1 flex flex-col">
        <div className="p-2 border-b border-base-300 bg-base-100">
          <div className="flex items-center gap-3">
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
            {savedMsg && <span className="text-sm text-base-content/70">{savedMsg}</span>}
            {publishMsg && <span className="text-sm font-medium">{publishMsg}</span>}
          </div>
          {publishErrors.length > 0 && (
            <ul className="mt-2 text-sm text-error list-disc pl-6">
              {publishErrors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>
      {/* Config panel — only shown when a node is selected. */}
      {selectedNode && (
        <aside className="w-72 shrink-0 bg-base-100 border-l border-base-300 p-4 overflow-y-auto">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">{selectedNode.data.nodeType} #{selectedNode.data.seq}</h2>
              <div className="flex gap-1">
                {selectedNode.data.nodeType !== "START" && (
                  <button onClick={deleteSelectedNode} className="btn btn-xs btn-error btn-outline">
                    Delete
                  </button>
                )}
                <button onClick={() => setSelectedId(null)} className="btn btn-xs btn-ghost" title="Close">✕</button>
              </div>
            </div>

            {selectedNode.data.nodeType === "SEND_MESSAGE" && (
              <label className="form-control">
                <span className="label-text">Message text</span>
                <textarea
                  className="textarea textarea-bordered"
                  value={selectedNode.data.config.text ?? ""}
                  onChange={(e) => updateConfig("text", e.target.value)}
                />
              </label>
            )}

            {selectedNode.data.nodeType === "ASK_INPUT" && (
              <>
                <label className="form-control">
                  <span className="label-text">Question text</span>
                  <textarea
                    className="textarea textarea-bordered"
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(e) => updateConfig("text", e.target.value)}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Save answer to variable</span>
                  <input
                    className="input input-bordered"
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(e) => updateConfig("variable", e.target.value)}
                  />
                </label>
              </>
            )}

            {selectedNode.data.nodeType === "CONDITION" && (
              <>
                <label className="form-control">
                  <span className="label-text">Variable</span>
                  <input
                    className="input input-bordered"
                    value={selectedNode.data.config.field ?? ""}
                    onChange={(e) => updateConfig("field", e.target.value)}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Equals value</span>
                  <input
                    className="input input-bordered"
                    value={selectedNode.data.config.value ?? ""}
                    onChange={(e) => updateConfig("value", e.target.value)}
                  />
                </label>
              </>
            )}

            {selectedNode.data.nodeType === "SET_VARIABLE" && (
              <>
                <label className="form-control">
                  <span className="label-text">Variable name</span>
                  <input
                    className="input input-bordered"
                    value={selectedNode.data.config.variable ?? ""}
                    onChange={(e) => updateConfig("variable", e.target.value)}
                  />
                </label>
                <label className="form-control">
                  <span className="label-text">Value</span>
                  <input
                    className="input input-bordered"
                    value={selectedNode.data.config.value ?? ""}
                    onChange={(e) => updateConfig("value", e.target.value)}
                  />
                </label>
              </>
            )}

            {selectedNode.data.nodeType === "WAIT" && (
              <label className="form-control">
                <span className="label-text">Seconds to wait</span>
                <input
                  type="number"
                  className="input input-bordered"
                  value={selectedNode.data.config.seconds ?? ""}
                  onChange={(e) => updateConfig("seconds", e.target.value)}
                />
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
                {(selectedNode.data.config.buttons ?? []).map((b: any) => (
                  <div key={b.id} className="flex gap-1 items-center">
                    <input
                      className="input input-bordered input-sm flex-1"
                      placeholder="Button label"
                      value={b.label}
                      onChange={(e) => updateOption(b.id, e.target.value)}
                    />
                    <button onClick={() => removeOption(b.id)} className="btn btn-xs btn-ghost text-error">✕</button>
                  </div>
                ))}
                {(selectedNode.data.config.buttons ?? []).length < 3 && (
                  <button onClick={() => addOption(3)} className="btn btn-sm btn-outline">+ Add button</button>
                )}
              </>
            )}

            {selectedNode.data.nodeType === "LIST" && (
              <>
                <label className="form-control">
                  <span className="label-text">Prompt text</span>
                  <textarea
                    className="textarea textarea-bordered"
                    value={selectedNode.data.config.text ?? ""}
                    onChange={(e) => updateConfig("text", e.target.value)}
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
                {(selectedNode.data.config.rows ?? []).map((r: any) => (
                  <div key={r.id} className="flex gap-1 items-center">
                    <input
                      className="input input-bordered input-sm flex-1"
                      placeholder="Row label"
                      value={r.label}
                      onChange={(e) => updateOption(r.id, e.target.value)}
                    />
                    <button onClick={() => removeOption(r.id)} className="btn btn-xs btn-ghost text-error">✕</button>
                  </div>
                ))}
                {(selectedNode.data.config.rows ?? []).length < 10 && (
                  <button onClick={() => addOption(10)} className="btn btn-sm btn-outline">+ Add row</button>
                )}
              </>
            )}

            {(selectedNode.data.nodeType === "START" || selectedNode.data.nodeType === "END") && (
              <p className="text-base-content/60 text-sm">No settings for this node.</p>
            )}
          </div>
        </aside>
      )}

      {/* Floating test-flow chat widget */}
      <TestPanel chatbotId={chatbotId} />
    </div>
  );
}
