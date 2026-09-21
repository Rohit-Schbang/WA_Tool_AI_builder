// Core Runtime types shared by the engine and all executors

// A Node as stored in the published workflow definition
export interface WorkflowNode {
    id: string;
    nodeType: string;
    config: Record<string, any>;
}

// An edge connecting two node. source Hnadle distinguishes Condition branches
export interface WorkFlowEdge {
    id: string;
    source: string;
    target: string;
    sourceHandle: string | null
}

export interface WorkflowDefinition {
    nodes: WorkflowNode[];
    edges: WorkFlowEdge[]
}

// The runtine calls this ; the Whatsapp adapter implements this; The runtime does NOT know Whatsapp exists.
export interface MessagingAdapter {
    sendText(to: string, from: string): Promise<void>
}

// The execution context passed to every executor
// It carries everything a node needs to do its job.

export interface ExecutionContext {
    // --------------->>>>>>          The Whatsapp user's id (their phone number)
    userId: string
    // --------------->>>>>>          The collected conversation variables  (name.city etc)
    variables: Record<string, any>;
    // --------------->>>>>>          The latest inbound message text (for ASK_INPUT to capture)
    incomingText: string | null
    // --------------->>>>>>            How  the runtime sends message out
    messaging: MessagingAdapter
}

// An option for interactive messages (button or list row).
export interface MessageOption {
  id: string;
  label: string;
}

// The channel-agnostic messaging contract (ADR-007).
export interface MessagingAdapter {
  sendText(to: string, text: string): Promise<void>;
  // Optional rich message types. Adapters that support them implement these;
  // executors fall back to sendText when they're absent.
  sendButtons?(to: string, text: string, buttons: MessageOption[]): Promise<void>;
  sendList?(to: string, text: string, buttonText: string, rows: MessageOption[]): Promise<void>;
}


// What an executor returns: what the engine should do next.
export type ExecutorResult =
    // Move to the next node (engine follows the outgoing edge).
    | { action: "next"; handle?: string }
    // Pause and wait for the user's next message (ASK_INPUT, WAIT).
    | { action: "wait" }
    // The workflow has ended.
    | { action: "end" };


// An executor : does a node's work, returns what happens next.
// It can read / mutate eontext.variables and call constext .messaging
export type NodeExecutor = (

    node: WorkflowNode,
    context: ExecutionContext
) => Promise<ExecutorResult>
