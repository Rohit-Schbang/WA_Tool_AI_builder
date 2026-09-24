interface WorkflowNode {
    id: string;
    nodeType: string;
    seq?: number;
    config: Record<string, any>;
}

interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle: string | null
}

interface WorkflowDefinition {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[]
}

// A single validation problem. `nodeId` (when present) lets the frontend
// focus/highlight the offending node on the canvas.
export interface ValidationError {
    message: string;
    nodeId?: string;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[]
}

// Friendly per-type labels used to build readable default names.
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
    END: "End",
};

// A human-readable name for a node: its custom name, else "<Type> <seq>".
function nodeName(node: WorkflowNode): string {
    const custom = node.config?.name;
    if (custom && String(custom).trim()) return String(custom).trim();
    return `${TYPE_LABEL[node.nodeType] ?? node.nodeType} ${node.seq ?? ""}`.trim();
}

export function validateWorkflow(def: WorkflowDefinition): ValidationResult {

    const errors: ValidationError[] = []
    const nodes = def.nodes ?? []
    const edges = def.edges ?? []

    const push = (message: string, nodeId?: string) => errors.push({ message, nodeId });

    // Set of all ids gathered together ----------->>>>>>>
    const nodeIds = new Set(nodes.map((node) => node.id))

    // 1. Exactly one START
    const starts = nodes.filter((node) => node.nodeType === "START")
    if (starts.length === 0) push("Workflow must have a START node.")
    if (starts.length > 1) push("Workflow must have only one START node.")

    // 2. (#8) END no longer required — a flow terminates naturally at a node
    //    with no outgoing edge. Just need at least one node after START.
    if (nodes.filter((node) => node.nodeType !== "START").length === 0) {
        push("Workflow must have at least one node after START.")
    }

    // 3. No dangling edges (source/target must exist)
    for (const edge of edges) {
        if (!nodeIds.has(edge.source)) push(`A connection has an unknown source node.`, edge.source)
        if (!nodeIds.has(edge.target)) push(`A connection has an unknown target node.`, edge.target)
    }

    // 3b. Nothing may connect INTO a START node — this creates a loop that
    //     re-runs the flow (e.g. Question -> START re-asks the question).
    const startIds = new Set(starts.map((s) => s.id));
    for (const edge of edges) {
        if (startIds.has(edge.target)) {
            const src = nodes.find((n) => n.id === edge.source);
            push(`"${src ? nodeName(src) : edge.source}" connects back into the Start node — remove that connection.`, edge.source)
        }
    }

    // 4. No orphan nodes: every node except START must be reachable — either
    //    via an incoming edge, or as a no-reply fallback target (#fallback).
    const targeted = new Set(edges.map((edge) => edge.target))
    for (const node of nodes) {
        const fbTarget = (node.config as any)?.fallback?.goToNodeId
        if (fbTarget) targeted.add(fbTarget)
    }
    for (const node of nodes) {
        if (node.nodeType !== "START" && !targeted.has(node.id)) {
            push(`"${nodeName(node)}" is not connected to anything.`, node.id)
        }
    }

    // 5. Required config per node type.
    for (const node of nodes) {
        const config = node.config ?? {};
        const name = nodeName(node);

        if (node.nodeType === "SEND_MESSAGE" && !config.text && !(config.buttons ?? []).length) {
            push(`"${name}" is missing message text.`, node.id)
        }
        if (node.nodeType === "ASK_INPUT" && !config.variable) {
            push(`"${name}" is missing a variable to store the answer.`, node.id)
        }
        if (node.nodeType === "CONDITION" && !config.field) {
            push(`"${name}" is missing a variable to check.`, node.id)
        }
        if (node.nodeType === "SET_VARIABLE" && !config.variable) {
            push(`"${name}" is missing a variable name.`, node.id)
        }
        if (node.nodeType === "AI_RESPONSE" && !config.prompt) {
            push(`"${name}" is missing a prompt.`, node.id)
        }
        if (node.nodeType === "INPUT_TYPE" && !config.variable) {
            push(`"${name}" is missing a variable to store the answer.`, node.id)
        }
        if (node.nodeType === "VALIDATE") {
            if ((config.mode ?? "expression") === "regex" && !config.pattern) {
                push(`"${name}" is missing a regex pattern.`, node.id)
            }
            if ((config.mode ?? "expression") === "expression" && !config.expression) {
                push(`"${name}" is missing a JS expression.`, node.id)
            }
        }
        if (node.nodeType === "TRANSFORM" && !config.variable) {
            push(`"${name}" is missing an output variable.`, node.id)
        }
        if (node.nodeType === "API_REQUEST" && !config.url) {
            push(`"${name}" is missing a URL.`, node.id)
        }
    }

    // 6. CONDITION / VALIDATE need both branch edges.
    for (const node of nodes) {
        if (node.nodeType === "CONDITION" || node.nodeType === "VALIDATE") {
            const name = nodeName(node);
            const isVal = node.nodeType === "VALIDATE";
            const outhandles = edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle)
            if (!outhandles.includes("true")) push(`"${name}" is missing a ${isVal ? "pass" : "true"} branch.`, node.id)
            if (!outhandles.includes("else")) push(`"${name}" is missing a ${isVal ? "fail" : "else"} branch.`, node.id)
        }
    }

    return { valid: errors.length === 0, errors }
}
