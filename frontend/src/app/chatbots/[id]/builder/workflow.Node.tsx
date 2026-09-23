import { Handle, Position, type NodeProps } from "reactflow";

const TITLE: Record<string, string> = {
    START: "Start",
    SEND_MESSAGE: "Message",
    ASK_INPUT: "Question",
    INPUT_TYPE: "Input",
    CONDITION: "If / Else",
    SET_VARIABLE: "Set Variable",
    WAIT: "Delay",
    AI_RESPONSE: "AI Reply",
    API_REQUEST: "API Request",
    VALIDATE: "Validate",
    TRANSFORM: "Transform",
    END: "End",
    BUTTONS: "Buttons",
    LIST: "List"
}

// Custom node : a rounded card
export function WorkFlowNode({ id, data, selected }: NodeProps) {

    const nodeType: string = data.nodeType;

    const seq: number = data.seq;
    const config = data.config ?? {}

    // Custom name (#3, edited in the side panel). Falls back to type + seq.
    const defaultName = `${TITLE[nodeType] ?? nodeType} ${seq}`;
    const title = config.name?.trim() || defaultName;

    let preview = "";

    if (nodeType === "SEND_MESSAGE") preview = config.text || "No Response"
    else if (nodeType === "ASK_INPUT") preview = config.text || "(No Question)";
    else if (nodeType === "INPUT_TYPE") preview = `${config.inputType ?? "text"} → ${config.variable || "(no var)"}`;
    else if (nodeType === "CONDITION") preview = config.field ? `${config.field}= ${config.value ?? ""}` : "(No Condition )"
    else if (nodeType === "WAIT") preview = config.seconds ? `${config.seconds}s` : "(no delay)";
    else if (nodeType === "SET_VARIABLE") preview = config.variable ? `${config.variable} = ${config.value ?? ""}` : "(no variable)";
    else if (nodeType === "BUTTONS") preview = config.text || "(No prompt)";
    else if (nodeType === "LIST") preview = config.text || "(No prompt)";
    else if (nodeType === "AI_RESPONSE") preview = config.prompt || "(No prompt)";
    else if (nodeType === "API_REQUEST") preview = config.url ? `${config.method ?? "GET"} ${config.url}` : "(no URL)";
    else if (nodeType === "VALIDATE") preview = config.expression || config.regex || "(no rule)";
    else if (nodeType === "TRANSFORM") preview = config.variable ? `→ ${config.variable}` : "(no output var)";

    const isCondition = nodeType === "CONDITION";
    const isValidate = nodeType === "VALIDATE";
    const isApi = nodeType === "API_REQUEST";
    const isStart = nodeType === "START";

    // BUTTONS, LIST, and SEND_MESSAGE-with-CTA-buttons render one output handle
    // per option. (#10 — Send Message supports buttons directly; only CTA-kind
    // buttons branch, "url" buttons just open a link and don't get a handle.)
    const sendMsgCtaButtons: { id: string; label: string; kind?: string }[] =
        nodeType === "SEND_MESSAGE" ? (config.buttons ?? []).filter((b: any) => (b.kind ?? "cta") === "cta") : [];
    const isChoice =
        nodeType === "BUTTONS" ||
        nodeType === "LIST" ||
        (nodeType === "SEND_MESSAGE" && sendMsgCtaButtons.length > 0);
    const options: { id: string; label: string }[] =
        nodeType === "BUTTONS" ? (config.buttons ?? []) :
            nodeType === "LIST" ? (config.rows ?? []) :
                nodeType === "SEND_MESSAGE" ? sendMsgCtaButtons : [];

    // Map of optionId -> connected node title (#15), passed in from parent.
    const optionTargets: Record<string, string> = data.optionTargets ?? {};

    return (
        <div
            className={`relative rounded-xl border-2 bg-white shadow-sm px-4 py-3 min-w-[180px] transition-shadow ${data.searchHighlight ? "border-warning ring-4 ring-warning/40" :
                    selected ? "border-primary" : "border-base-300"
                }`}
        >
            {/* Floating delete button — hidden for START. */}
            {!isStart && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        data.onDelete?.(id);
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-error text-white text-xs leading-none flex items-center justify-center shadow hover:scale-110 transition-transform z-10"
                    title="Delete node"
                >
                    ✕
                </button>
            )}

            {/* Target handle (incoming) on top — every node except START. */}
            {!isStart && <Handle type="target" position={Position.Top} />}

            <div className="font-bold text-sm">{title}</div>
            <div className="text-[10px] text-base-content/40 uppercase tracking-wide">{TITLE[nodeType] ?? nodeType}</div>
            {preview && <div className="text-xs text-base-content/70 mt-2 line-clamp-2">{preview}</div>}

            {/* Source handles (outgoing) on the bottom. */}
            {isCondition || isValidate || isApi ? (
                // Two outputs: true/else. Labels differ per node type.
                <>
                    <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} />
                    <Handle type="source" position={Position.Bottom} id="else" style={{ left: "70%" }} />
                    <div className="flex justify-between text-[10px] text-base-content/60 mt-2">
                        <span>{isValidate ? "pass" : isApi ? "success" : "true"}</span>
                        <span>{isValidate ? "fail" : isApi ? "failure" : "else"}</span>
                    </div>
                </>
            ) : isChoice ? (
                // BUTTONS / LIST: one labeled output per option (#15 shows target).
                <div className="mt-2 flex flex-col gap-1">
                    {options.length === 0 && (
                        <div className="text-[10px] text-base-content/40">Add options in the panel</div>
                    )}
                    {options.map((opt) => (
                        <div key={opt.id} className="relative border border-base-300 rounded px-2 py-1 text-xs">
                            <div>{opt.label || "(empty)"}</div>
                            <div className={`text-[9px] ${optionTargets[opt.id] ? "text-success" : "text-base-content/40"}`}>
                                {optionTargets[opt.id] ? `→ ${optionTargets[opt.id]}` : "Not Connected"}
                            </div>
                            <Handle
                                type="source"
                                position={Position.Right}
                                id={opt.id}
                                style={{ top: "50%" }}
                            />
                        </div>
                    ))}
                </div>
            ) : (
                // Every other node has a single output. (END removed — a node
                // with no outgoing edge simply terminates the flow.)
                <Handle type="source" position={Position.Bottom} />
            )}
        </div>
    )
}
