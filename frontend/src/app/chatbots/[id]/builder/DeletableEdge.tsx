import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from "reactflow";

// A smoothstep edge that shows a small ✕ delete button at its midpoint.
// The button appears on hover (and always when the edge is selected), and
// removes the connection on click — no browser confirm dialog.
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  labelStyle,
  selected,
}: EdgeProps) {
  const { setEdges } = useReactFlow();

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan group/edge absolute flex flex-col items-center gap-1"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          {/* Optional edge label (e.g. button/branch name) */}
          {label && (
            <span
              className="px-1.5 py-0.5 rounded bg-white/90 text-[10px] font-semibold text-slate-600 shadow-sm border border-slate-200"
              style={labelStyle}
            >
              {label}
            </span>
          )}
          {/* Delete button — visible on hover or when the edge is selected */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEdges((eds) => eds.filter((ed) => ed.id !== id));
            }}
            title="Delete connection"
            className={`w-5 h-5 rounded-full bg-white border border-slate-300 text-rose-500 text-xs leading-none flex items-center justify-center shadow-sm hover:bg-rose-500 hover:text-white hover:border-rose-500 transition ${
              selected ? "opacity-100" : "opacity-0 group-hover/edge:opacity-100"
            }`}
          >
            ✕
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
