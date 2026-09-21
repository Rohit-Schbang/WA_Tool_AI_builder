import { Handle, Position, type NodeProps } from "reactflow";

const TITLE: Record<string, string> = {
    START: "Start",
    SEND_MESSAGE: "Message",
    ASK_INPUT: "Question",
    CONDITION: "If / Else",
    SET_VARIABLE: "Set Variable",
    WAIT: "Delay",
    END: "End",
    BUTTONS: "Buttons",
    LIST: "List"
}

// Custom node : a ronded card 

export function WorkFlowNode({ id, data, selected }: NodeProps) {

    const nodeType: string = data.nodeType;

    const seq: number = data.seq;
    const config = data.config ?? {}

    const title = `${TITLE[nodeType] ?? nodeType} #${seq}`;

    let preview = "";

    if (nodeType === "SEND_MESSAGE") preview = config.text || "No Response"
    else if (nodeType === "ASK_INPUT") preview = config.text || "(No Question)";
    else if (nodeType === "CONDITION") preview = config.field ? `${config.field}= ${config.value ?? ""}` : "(No Condition )"
    else if (nodeType === "WAIT") preview = config.seconds ? `${config.seconds}s` : "(no delay)";
    else if (nodeType === "SET_VARIABLE") preview = config.variable ? `${config.variable} = ${config.value ?? ""}` : "(no variable)";
    else if (nodeType === "BUTTONS") preview = config.text || "(No prompt)";
    else if (nodeType === "LIST") preview = config.text || "(No prompt)";

    const isCondition = nodeType === "CONDITION";
    const isStart = nodeType === "START";
    const isEnd = nodeType === "END";

    // BUTTONS and LIST render one output handle per option.
    const isChoice = nodeType === "BUTTONS" || nodeType === "LIST";
    const options: { id: string; label: string }[] =
        nodeType === "BUTTONS" ? (config.buttons ?? []) :
        nodeType === "LIST" ? (config.rows ?? []) : [];

    return (

        <div
            className={`relative rounded-xl border-2 bg-white shadow-sm px-4 py-3 min-w-[180px] ${selected ? "border-primary" : "border-base-300"
                }`}
        >
            {/* Floating delete button, top-right corner just outside the card.
                Hidden for START (can't be deleted). Calls the onDelete
                callback passed in via node data. */}
            {!isStart && (
                <button
                    onClick={(e) => {
                        e.stopPropagation(); // don't trigger node selection
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
            {preview && <div className="text-xs text-base-content/70 mt-2">{preview}</div>}

            {/* Source handles (outgoing) on the bottom. */}
            {isCondition ? (
                // CONDITION has two outputs: true and else.
                <>
                    <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} />
                    <Handle type="source" position={Position.Bottom} id="else" style={{ left: "70%" }} />
                    <div className="flex justify-between text-[10px] text-base-content/60 mt-2">
                        <span>true</span>
                        <span>else</span>
                    </div>
                </>
            ) : isChoice ? (
                // BUTTONS / LIST: one labeled output per option, each with
                // a source handle whose id === the option id.
                <div className="mt-2 flex flex-col gap-1">
                    {options.length === 0 && (
                        <div className="text-[10px] text-base-content/40">Add options in the panel</div>
                    )}
                    {options.map((opt) => (
                        <div key={opt.id} className="relative border border-base-300 rounded px-2 py-1 text-xs">
                            {opt.label || "(empty)"}
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
                // Everything except END has a single output.
                !isEnd && <Handle type="source" position={Position.Bottom} />
            )}</div>
    )


}