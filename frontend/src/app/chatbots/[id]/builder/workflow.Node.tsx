import { Handle, Position, type NodeProps } from "reactflow";

const TITLE: Record<string, string> = {
    START: "Start",
    SEND_MESSAGE: "Message",
    ASK_INPUT: "Question",
    CONDITION: "If / Else",
    SET_VARIABLE: "Set Variable",
    WAIT: "Delay",
    AI_RESPONSE: "AI Reply",
    API_REQUEST: "API Request",
    TRANSFORM: "Custom Code",
    END: "End",
    BUTTONS: "Buttons",
    LIST: "List",
};

// Per-type visual identity: an icon + an accent color (tailwind classes).
const STYLE: Record<string, { icon: string; accent: string; ring: string; chip: string }> = {
    START: { icon: "▶", accent: "bg-emerald-500", ring: "border-emerald-200", chip: "text-emerald-600" },
    SEND_MESSAGE: { icon: "💬", accent: "bg-sky-500", ring: "border-sky-200", chip: "text-sky-600" },
    ASK_INPUT: { icon: "❓", accent: "bg-violet-500", ring: "border-violet-200", chip: "text-violet-600" },
    BUTTONS: { icon: "🔘", accent: "bg-cyan-500", ring: "border-cyan-200", chip: "text-cyan-600" },
    LIST: { icon: "📋", accent: "bg-teal-500", ring: "border-teal-200", chip: "text-teal-600" },
    CONDITION: { icon: "🔀", accent: "bg-amber-500", ring: "border-amber-200", chip: "text-amber-600" },
    AI_RESPONSE: { icon: "✨", accent: "bg-fuchsia-500", ring: "border-fuchsia-200", chip: "text-fuchsia-600" },
    SET_VARIABLE: { icon: "🏷️", accent: "bg-slate-500", ring: "border-slate-200", chip: "text-slate-600" },
    TRANSFORM: { icon: "🔧", accent: "bg-orange-500", ring: "border-orange-200", chip: "text-orange-600" },
    API_REQUEST: { icon: "🌐", accent: "bg-blue-600", ring: "border-blue-200", chip: "text-blue-700" },
    WAIT: { icon: "⏱️", accent: "bg-rose-500", ring: "border-rose-200", chip: "text-rose-600" },
    END: { icon: "⏹", accent: "bg-gray-500", ring: "border-gray-200", chip: "text-gray-600" },
};

const handleClass = "!w-3 !h-3 !bg-white !border-2 !border-gray-400 hover:!border-primary";

export function WorkFlowNode({ id, data, selected }: NodeProps) {
    const nodeType: string = data.nodeType;
    const seq: number = data.seq;
    const config = data.config ?? {};

    const style = STYLE[nodeType] ?? { icon: "●", accent: "bg-gray-400", ring: "border-gray-200", chip: "text-gray-600" };
    const defaultName = `${TITLE[nodeType] ?? nodeType} ${seq}`;
    const title = config.name?.trim() || defaultName;

    let preview = "";
    if (nodeType === "SEND_MESSAGE") preview = config.text || "No message";
    else if (nodeType === "ASK_INPUT") preview = config.text || "(no question)";
    else if (nodeType === "CONDITION") preview = config.field ? `${config.field} = ${config.value ?? ""}` : "(no condition)";
    else if (nodeType === "WAIT") preview = config.seconds ? `${config.seconds}s delay` : "(no delay)";
    else if (nodeType === "SET_VARIABLE") preview = config.variable ? `${config.variable} = ${config.value ?? ""}` : "(no variable)";
    else if (nodeType === "BUTTONS") preview = config.text || "(no prompt)";
    else if (nodeType === "LIST") preview = config.text || "(no prompt)";
    else if (nodeType === "AI_RESPONSE") preview = config.prompt || "(no prompt)";
    else if (nodeType === "API_REQUEST") preview = config.url ? `${config.method ?? "GET"} ${config.url}` : "(no URL)";
    else if (nodeType === "TRANSFORM") preview = config.variable ? `→ ${config.variable}` : "(no output var)";

    const isCondition = nodeType === "CONDITION";
    const isApi = nodeType === "API_REQUEST";
    const isStart = nodeType === "START";
    const hasFallback = !!config.fallback?.enabled;

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

    const optionTargets: Record<string, string> = data.optionTargets ?? {};

    return (
        <div
            className={`group relative rounded-2xl bg-white min-w-[210px] max-w-[260px] border transition-all
                ${data.searchHighlight
                    ? "border-amber-400 ring-4 ring-amber-300/50 shadow-lg"
                    : selected
                        ? "border-primary ring-2 ring-primary/30 shadow-lg"
                        : `${style.ring} shadow-md hover:shadow-lg`}`}
        >
            {/* Delete button — hidden for START, appears on hover */}
            {!isStart && (
                <button
                    onClick={(e) => { e.stopPropagation(); data.onDelete?.(id); }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-error text-white text-xs leading-none flex items-center justify-center shadow opacity-0 group-hover:opacity-100 hover:scale-110 transition-all z-10"
                    title="Delete node"
                >
                    ✕
                </button>
            )}

            {/* Incoming connection target.
                - A large, invisible handle covering the WHOLE card so a
                  connection can be dropped anywhere on the node. It's
                  pointer-events:none normally (so it doesn't block dragging/
                  selecting the node) and only becomes an active drop zone
                  while a connection is being dragged — see globals.css rule
                  keyed on `.react-flow__pane.connecting` / body.rf-connecting. */}
            {!isStart && (
                <>
                    <Handle
                        type="target"
                        position={Position.Top}
                        id="node-drop"
                        className="node-drop-target"
                    />
                    {/* Small visible dot as a visual cue */}
                    <Handle
                        type="target"
                        position={Position.Top}
                        id="in-dot"
                        className={handleClass}
                        isConnectableStart={false}
                    />
                </>
            )}

            {/* Colored header strip with icon + name */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-t-2xl ${style.accent} text-white`}>
                <span className="text-sm leading-none">{style.icon}</span>
                <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight truncate">{title}</div>
                    <div className="text-[9px] uppercase tracking-wider opacity-80">{TITLE[nodeType] ?? nodeType}</div>
                </div>
                {hasFallback && <span title="No-reply fallback set" className="text-[10px]">⏳</span>}
            </div>

            {/* Body */}
            <div className="px-3 py-2">
                {preview && <div className="text-xs text-gray-600 line-clamp-2">{preview}</div>}

                {/* Choice options */}
                {isChoice && (
                    <div className="mt-2 flex flex-col gap-1.5">
                        {options.length === 0 && (
                            <div className="text-[10px] text-gray-400 italic">Add options in the panel</div>
                        )}
                        {options.map((opt) => (
                            <div key={opt.id} className="relative rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs">
                                <div className="font-medium text-gray-700 truncate pr-2">{opt.label || "(empty)"}</div>
                                <div className={`text-[9px] flex items-center gap-1 ${optionTargets[opt.id] ? "text-emerald-600" : "text-gray-400"}`}>
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${optionTargets[opt.id] ? "bg-emerald-500" : "bg-gray-300"}`} />
                                    {optionTargets[opt.id] ? `→ ${optionTargets[opt.id]}` : "Not connected"}
                                </div>
                                <Handle type="source" position={Position.Right} id={opt.id} className={handleClass} style={{ top: "50%" }} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Branch outputs (condition / api) */}
            {(isCondition || isApi) && (
                <div className="relative px-3 pb-3 pt-1">
                    <div className="flex justify-between text-[10px] font-medium">
                        <span className="flex items-center gap-1 text-emerald-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {isApi ? "success" : "true"}
                        </span>
                        <span className="flex items-center gap-1 text-rose-500">
                            {isApi ? "failure" : "else"}
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        </span>
                    </div>
                    <Handle type="source" position={Position.Bottom} id="true" className={handleClass} style={{ left: "28%" }} />
                    <Handle type="source" position={Position.Bottom} id="else" className={handleClass} style={{ left: "72%" }} />
                </div>
            )}

            {/* Single output for plain nodes */}
            {!isChoice && !isCondition && !isApi && (
                <Handle type="source" position={Position.Bottom} className={handleClass} />
            )}
        </div>
    );
}
