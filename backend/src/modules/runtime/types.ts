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

// A declared workflow-level variable (#2).
export interface WorkflowVariable {
    name: string;
    type: "text" | "number" | "boolean";
    default: string;
}

// A named CRUD endpoint defined inside a global API config.
export interface ApiEndpoint {
    id: string;
    name: string;              // e.g. "Get user"
    method: string;            // GET | POST | PUT | PATCH | DELETE
    path: string;              // relative path (joined with baseUrl), supports {{vars}}
    body?: string;             // request body template, supports {{vars}}
}

// A reusable global API configuration (#1) that API_REQUEST nodes reference
// by name, so base URL + shared headers aren't repeated per node.
export interface ApiConfig {
    name: string;
    baseUrl?: string;
    headers?: { key: string; value: string }[];
    endpoints?: ApiEndpoint[];
}

export interface WorkflowDefinition {
    variables?: WorkflowVariable[];
    apiConfigs?: ApiConfig[];
    nodes: WorkflowNode[];
    edges: WorkFlowEdge[]
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
    // #1 — global API configs keyed by name (for API_REQUEST nodes).
    apiConfigs?: Record<string, ApiConfig>
}

// An option for interactive messages (button or list row).
export interface MessageOption {
  id: string;
  label: string;
}

// A rich message header (#12). WhatsApp supports a text header or a single
// media header (image/document/video). `value` is the text or the media URL.
export interface MessageHeader {
  type: "text" | "image" | "document" | "video";
  value: string;
}

// A structured message body for the SEND_MESSAGE node (#12).
export interface RichMessage {
  header?: MessageHeader;
  body: string;
  footer?: string;
}

// The channel-agnostic messaging contract (ADR-007).
export interface MessagingAdapter {
  sendText(to: string, text: string): Promise<void>;
  // Optional rich message types. Adapters that support them implement these;
  // executors fall back to sendText when they're absent.
  sendButtons?(to: string, text: string, buttons: MessageOption[]): Promise<void>;
  sendList?(to: string, text: string, buttonText: string, rows: MessageOption[]): Promise<void>;
  // #12 — a message with optional header (text/media) and footer.
  sendRichMessage?(to: string, msg: RichMessage): Promise<void>;
  // #10 — a call-to-action URL button (opens a link in WhatsApp).
  sendCtaUrl?(to: string, text: string, buttonText: string, url: string, footer?: string): Promise<void>;
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
