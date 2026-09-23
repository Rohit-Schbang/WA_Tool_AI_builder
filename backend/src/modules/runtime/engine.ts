import { executors } from "./executors";
import { ExecutionContext, WorkflowDefinition, WorkflowNode } from "./types";



// The out come for the running engine from the starting point.
export interface RunResult {
    // Where execution paused: the node id to resume the next time 
    // null means the workflow finished (Reached END)
    pausedAtNodeId: string | null;
    status: "waiting" | "completed"
}

//<<<<<<<<<<<<<<<<-----------  Finding node by its ID ------- >>>>>>>>>>>>>>

function findNode(def: WorkflowDefinition, id: string): WorkflowNode | undefined {
    return def.nodes.find((n) => n.id === id)
}

// Find the next node id to go to from a node, following the right edge.
// If a handle is given (CONDITION true/false), match that edges; else take the first outgoing edge
function findNodeId(def: WorkflowDefinition, fromNodeId: string, handle: string): string | null {
    const outgoing = def.edges.filter((edge) => {
        edge.source === fromNodeId
    })

    if (outgoing.length === 0) return null
    if (handle) {
        const match = outgoing.find((edge) => edge.sourceHandle === handle)
        return match ? match.target : null
    }
    return outgoing[0].target
}

//<<<<<<<<<<<<<<<<-----------       Finding the Next node Id      -------------->>>>>>>>>>>>>>

// Find the next node id to go to from a node, following the right edge.
// If a handle is given (CONDITION true/else), match that edge; else take
// the first outgoing edge.
function findNextNodeId(
    def: WorkflowDefinition,
    fromNodeId: string,
    handle?: string
): string | null {
    const outgoing = def.edges.filter((e) => e.source === fromNodeId);
    if (outgoing.length === 0) return null;

    if (handle) {
        const match = outgoing.find((e) => e.sourceHandle === handle);
        return match ? match.target : null;
    }
    return outgoing[0].target;
}

// Run the engine starting at StartNodeId. Executes nodes untill a node
// says "wait" or "end" (or we run out of edges)
export async function runEngine(def: WorkflowDefinition, StartNodeId: string, context: ExecutionContext): Promise<RunResult> {

    let currentId: string | null = StartNodeId;
    let steps = 0;
    const MAX_STEPS = 100;

    while (currentId) {
        if (steps++ > MAX_STEPS) {
            throw new Error("Workflow exceeded max steps (possible loop)")
        }

        const node = findNode(def, currentId)
        if (!node) {
            return { pausedAtNodeId: null, status: "completed" }
        }

        const executor = executors[node.nodeType]
        if (!executor) throw new Error(`No executors for node type: ${node.nodeType}`)

        const result = await executor(node, context)

        if (result.action === "wait") {
            // Pause here. Next message resume at this node.
            return { pausedAtNodeId: currentId, status: 'waiting' }
        }
        if (result.action === "end") {
            return { pausedAtNodeId: null, status: "completed" }
        }

        // action === "next": follow the edge to the next node.
        // After the first executor runs, clear incomingText so downstream
        // ASK_INPUT nodes see "arriving" (null), not the old message.
        context.incomingText = null

        const nextId = findNextNodeId(def, currentId, result.handle)
        if (!nextId) {
            // No outgoing edge - nothing more to do
            return { pausedAtNodeId: null, status: "completed" }
        }
        currentId = nextId

    }
    return { pausedAtNodeId: null, status: "completed" }
}
