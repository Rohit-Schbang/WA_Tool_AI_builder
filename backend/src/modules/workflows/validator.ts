interface WorkflowNode {
    id: string;
    nodeType: string;
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

export interface ValidationResult {
    valid: boolean;
    errors: string[]
}

export function validateWorkflow(def: WorkflowDefinition): ValidationResult {

    const errors: string[] = []
    const nodes = def.nodes ?? []
    const edges = def.edges ?? []


    // Set of all ids gathered together ----------->>>>>>>
    const nodeIds = new Set(nodes.map((node) => node.id))

    // 1. Exactly from the Start one
    const starts = nodes.filter((node) => node.nodeType === "START") 
    if (starts.length === 0) errors.push("Workflow must have a START node.")
    if (starts.length > 1) errors.push("Workflow must have only one START node.")

    // 2. Atleast the END
    const ends = nodes.filter((node) => node.nodeType === "END")
    if (ends.length === 0) errors.push("Workflow must have at least one END node.")

    // 3. No dangling edges (source/target must exist)
    for (const edge of edges) {
        if (!nodeIds.has(edge.source)) errors.push(`Edge ${edge.id} has a unknown source node.`)
        if (!nodeIds.has(edge.target)) errors.push(`Edge ${edge.id} has a unknown target node.`)
    }

    // 4. No orphan nodes: every node expect START must have an increaseing edge
    const targeted = new Set(edges.map((edge) => edge.target))
    for (const node of nodes) {
        if (node.nodeType !== "START" && !targeted.has(node.id)) {
            errors.push(`Node ${node.id} (${node.nodeType})  is not connected to anything.`)
        }
    }

    // 5. Required config per node type.
    for (const node of nodes) {
        const config = node.config ?? {};

        if (node.nodeType === "SEND_MESSAGE" && !config.text) {
            errors.push(`SEND MESSAGE node ${node.id} is missing message text.`)
        }
        if (node.nodeType === "ASK_INPUT" && !config.variable) {
            errors.push(`ASK INPUT node ${node.id} is missing a variable to store the answer.`)
        }
        if (node.nodeType === "CONDITION" && !config.field) {
            errors.push(`CONDITION node ${node.id} is missing a variable to check.`)
        }
        if (node.nodeType === "SET_VARIABLE" && !config.variable) {
            errors.push(`SET VARIABLE node ${node.id} is missing a variable name.`)
        }
    }

    // 6 . CONDITION nodes need both a "true" and and "else" outgoing edge

    for (const node of nodes) {
        if (node.nodeType === "CONDITION") {
            const outhandles = edges.filter((edge) => edge.source === node.id).map((edge) => edge.sourceHandle)
            if (!outhandles.includes("true")) errors.push(`CONDITION node ${node.id} is missing a true branch`)
            if (!outhandles.includes("else")) errors.push(`CONDITION node ${node.id} is missing a else branch`)
        }
    }

    return { valid: errors.length === 0, errors }


}