# Branch/Handle Layout Ordering — Implementation Document

## 1. Title and Objective

**Problem:** When the AI builder (or auto‑layout) arranges a flow, the target nodes of a branching block can be placed on the **opposite side** from the handle they leave. A CONDITION/IF‑ELSE node draws its `true` handle on the **left** and `else` on the **right**, but auto‑layout can place the `true` target on the right and the `else` target on the left — so the connecting edges **cross** and the little edge labels under the handles read "else" over the left column and "true" over the right column. This is confusing (see the attached screenshot: `is_available_2 = true`, with `true` wired to the right node and `else` to the left).

**Objective:** Make the next‑node layout consistent with the handle side, for **every** branching node type, so the left handle's target sits on the left and the right handle's target sits on the right — no crossed edges, labels matching their columns.

This document is **design only**. No source has been changed yet. (§12.)

> **Legend:** ✅ **Verified** from source · 🔧 **Proposed** change · ❓ **Open question**.

---

## 2. Executive Summary

The confusion is **purely a layout‑ordering issue**, not a wiring bug. ✅

- The data is correct: the `true` edge leaves the `true` handle and the `else` edge leaves the `else` handle. ✅
- The node's handles are at fixed positions: `true`/`success` at `left: 28%`, `else`/`failure` at `left: 72%`. ✅ So **left = true/success, right = else/failure** — always.
- The edge label is derived from `sourceHandle` (`"true"`→"true", `"else"`→"else", `API_REQUEST`→"success"/"failure", options→the option label). ✅
- **Who decides left/right placement of the targets?** Not the handle — the **layout engine**:
  - Builder auto‑layout uses **dagre** (`layoutGraph`), which orders siblings to minimize crossings based on edge insertion order; it has no notion that `true` must go left. ✅
  - Diagram‑mode layout (`layoutFromSpec`) places each node at its **draw.io x/y**, which can also be reversed vs. the handle side. ✅

Because handles are fixed but target placement is free, the two can disagree and the edges cross.

**Recommended fix (smallest, safest):** bias the layout so that, for a node with ordered side‑anchored outputs, the target of the **left** handle is laid out to the **left** of the target of the **right** handle.

- 🔧 **Builder (dagre):** after `dagre.layout()`, apply a deterministic **sibling‑ordering correction**: for each branching source, if its ordered branch targets are horizontally out of order relative to the handle order (`true` before `else`; options in config order left→right), **swap their x‑coordinates** (and their subtree x‑offsets) so they match. This is a post‑pass on top of dagre and does not fight dagre's rank/leveling.
- 🔧 **Diagram mode (`layoutFromSpec`):** add the same post‑pass so a user whose draw.io diagram happens to draw True on the right still gets handle‑consistent placement on the canvas. (Lower priority — the diagram's own layout is intentionally preserved; see §8 and the open question in §11.)
- 🔧 **AI generator:** no prompt/graph change is required for correctness — this is a **layout** concern, and the layout runs on the client after generation. Optionally, emit branch edges in handle order (`true` before `else`) so dagre's *initial* guess is already correct more often (reduces the number of swaps the post‑pass has to make). (§7.)

No backend validation, runtime, or edge data changes. The fix is in **`autoLayout.ts`** (primary) with an optional mirror in **`drawio.ts` `layoutFromSpec`**.

---

## 3. Verified Current Behaviour

### 3.1 Handle geometry (fixed) — `workflow.Node.tsx` ✅

```tsx
// Branch outputs (condition / api)
<Handle type="source" position={Position.Bottom} id="true" style={{ left: "28%" }} />  // LEFT
<Handle type="source" position={Position.Bottom} id="else" style={{ left: "72%" }} />  // RIGHT
// Header labels: "true"/"success" rendered left, "else"/"failure" rendered right.
```

- CONDITION and API_REQUEST both use this block (`isCondition || isApi`). `true`/`success` is visually left; `else`/`failure` is visually right. ✅
- **Choice nodes** (BUTTONS, LIST, SEND_MESSAGE with CTA buttons) render one source handle per option, all at `Position.Right` (stacked vertically), so their ordering issue is vertical, not horizontal — see §6.4. ✅

### 3.2 Edge labels come from `sourceHandle` — `page.tsx` `edgesForFlow` ✅

```ts
if (handle === "true") return nodeType === "API_REQUEST" ? "success" : "true";
if (handle === "else") return nodeType === "API_REQUEST" ? "failure" : "else";
// options → the button/row label
```

So a label can never "lie" about its handle — the crossing is what makes the label *appear* to be on the wrong side. ✅

### 3.3 Builder auto‑layout — `autoLayout.ts` `layoutGraph` ✅

- Uses dagre: `setNode` per node, `setEdge(source, target)` per edge (dangling edges skipped), `rankdir` TB/LR, then `dagre.layout()`. ✅
- dagre decides sibling horizontal order to reduce edge crossings; **it is not told that `true` must be left of `else`.** Edge insertion order influences the result, but there is no guarantee. ✅ → This is the root cause for the builder canvas.

### 3.4 Diagram‑mode layout — `drawio.ts` `layoutFromSpec` ✅

- Places each node at its source draw.io position (scaled). `true`/`else` left/right follows the **diagram**, which can be reversed relative to the handles. ✅

### 3.5 Where layout runs ✅

- `layoutGraph` is invoked by the builder's `autoLayout("TB"|"LR")` and after AI generation (the generated flow is hydrated then auto‑laid out). ✅
- `layoutFromSpec` runs server‑side in `generateFromDiagram` and stamps `meta.layout = "drawio"`; the builder then keeps those positions. ✅

---

## 4. Root‑Cause Statement

> Handles are fixed (left = true/success, right = else/failure), but the **target nodes' left/right placement** is chosen independently by dagre (builder) or by the draw.io coordinates (diagram mode). When the chosen placement disagrees with the handle side, the edges cross and the under‑handle labels appear on the wrong columns. ✅

The fix must make **target placement follow handle order**, deterministically.

---

## 5. Design Goals / Non‑Goals

**Goals**
- For any branching node, the target reached from the **left** handle is positioned left of the target reached from the **right** handle (and, generally, targets follow handle order left→right).
- Deterministic and stable (same flow → same layout).
- Works in both TB and LR directions for the builder.
- No change to edge data, validation, runtime, or the meaning of `true`/`else`.

**Non‑Goals**
- Not moving/renaming handles.
- Not introducing automatic complexity logic or new AI calls.
- Not guaranteeing zero crossings in arbitrary graphs (a shared downstream node, or a target that is also another branch's child, can still force a crossing — §10).

---

## 6. Proposed Implementation

### 6.1 Define the canonical handle order per node 🔧

A small helper (frontend) that, given a node, returns its source handles in **left→right visual order**:

```ts
// 🔧 Proposed — handle order used to sort branch targets.
// CONDITION/API_REQUEST: ["true","else"] (true is left@28%, else is right@72%).
// Choice nodes: option ids in config order (buttons/rows), top→bottom (vertical).
function handleOrder(node: Node): string[] {
  const t = node.data.nodeType;
  if (t === "CONDITION" || t === "API_REQUEST") return ["true", "else"];
  if (t === "BUTTONS") return (node.data.config?.buttons ?? []).map((b: any) => b.id);
  if (t === "LIST") return (node.data.config?.rows ?? []).map((r: any) => r.id);
  if (t === "SEND_MESSAGE") return (node.data.config?.buttons ?? [])
    .filter((b: any) => (b.kind ?? "cta") === "cta").map((b: any) => b.id);
  return [];
}
```

This reuses the exact ordering already used to render handles/labels, so layout and rendering agree by construction. ✅ (Verified handle/label sources: §3.1, §3.2.)

### 6.2 Builder: post‑dagre sibling ordering correction 🔧 (primary fix)

After `dagre.layout()` in `layoutGraph`, add a correction pass that enforces handle order on branch targets:

```
for each source node S that has >= 2 outgoing edges with sourceHandles:
  order = handleOrder(S)                        // left→right (TB) / top→bottom (LR)
  targets = [ edge.target for handle in order if edge(S, *, handle) exists ]
  // Only targets that are "owned" by S (its direct children in the tree) are reordered,
  // to avoid yanking a shared/downstream node.
  ownedTargets = targets.filter(t => isSoleParent(S, t))
  // The cross-axis coordinate to sort on: x for TB, y for LR.
  sortedPositions = ownedTargets.map(pos).sorted(ascending cross-axis)
  reassign: ownedTargets[i] (in handle order) gets sortedPositions[i]
  // Move each target's whole SUBTREE by the same delta so children follow.
```

Key points:

- **Direction aware:** in TB, "left→right" sorts on **x**; in LR, "top→bottom" sorts on **y**. ✅ (`layoutGraph` already receives `direction`.)
- **Subtree shift:** when two targets swap, shift each target's descendants by the same delta so the branch's whole subtree moves with it (prevents a child being left behind under the old column). Compute descendants via a BFS over `edges` from each target, excluding nodes reachable from the *other* branch (shared nodes aren't moved — §6.3).
- **Sole‑parent guard (`isSoleParent`):** only reorder a target that has exactly one incoming edge (from S). A target with multiple parents (a merge point) is left where dagre put it — moving it could break another branch's alignment. 🔧 This keeps the pass safe and local.
- **Deterministic:** sorting by current coordinate then reassigning in handle order is stable and idempotent (running it twice is a no‑op).

> This is a **post‑pass**, so dagre still does all the hard work (ranks, spacing, overall tree shape). We only correct the horizontal order of a branch's own children. 🔧

### 6.3 Subtree isolation (shared nodes) 🔧

- Compute, for each branch target, the set of nodes reachable only through that target (not reachable from the sibling branch without going back up through S). Only those move with the swap.
- Nodes reachable from both branches (true merge points) stay put. This bounds the blast radius and avoids oscillation.

### 6.4 Choice nodes (buttons / list) ✅/🔧

- Their handles are vertical (`Position.Right`, stacked). The equivalent "consistency" is **top→bottom option order matching the card's option order**. In **TB** layout the targets fan out horizontally, so options should map left→right in config order; in **LR** they map top→bottom.
- The same post‑pass covers them by using `handleOrder()` (option ids in config order) and sorting on the cross axis. 🔧
- Lower severity than CONDITION (no "true/else" inversion), but included for the brief's "should not happen in the other nodes as well."

### 6.5 Diagram mode `layoutFromSpec` 🔧 (secondary, optional)

- `layoutFromSpec` mirrors the draw.io coordinates on purpose. If a user draws True on the right, strictly "fixing" it would move nodes away from their diagram positions — which conflicts with the intentional "retain original layout" behaviour. ✅
- 🔧 **Recommended, conservative:** apply the **same handle‑order correction only when it does not change the diagram's vertical structure** — i.e. swap two branch targets' x only if they are at (roughly) the same rank/y and currently reversed. This fixes the crossed‑label case while preserving the overall diagram shape.
- ❓ **Open question:** do we want diagram‑imported flows to be "corrected" at all, or to faithfully mirror the diagram even if True is on the right? Recommended default: correct only the clear same‑rank reversal; leave everything else as drawn. (Product decision.)

---

## 7. AI Generator (optional nudge, not required) 🔧/✅

- **No correctness dependency:** the crossing is fixed entirely in layout, which runs after generation. ✅
- 🔧 Optional: when building edges, emit the `true`/`success` edge **before** the `else`/`failure` edge for a given source (and option edges in config order). dagre's initial sibling order is influenced by edge insertion order, so emitting in handle order makes dagre's *first guess* correct more often and reduces the number of post‑pass swaps. This is a tiny ordering tweak in `repair()`/`mergeDefs()` edge assembly, not a structural change. ❓ Worth doing only if we want fewer post‑pass moves; the post‑pass makes it unnecessary for correctness.

---

## 8. Files and Changes

| File | Change | Type |
|---|---|---|
| `frontend/.../builder/autoLayout.ts` | Add `handleOrder()`, subtree/sole‑parent helpers, and a post‑dagre sibling‑ordering correction (direction aware). `layoutGraph` signature unchanged (it already gets `nodes, edges, direction`). | 🔧 primary |
| `frontend/.../builder/workflow.Node.tsx` | No change (handles already left=true / right=else). | ✅ |
| `frontend/.../builder/page.tsx` | No change (edge labels already derive from `sourceHandle`; `autoLayout()` call unchanged). | ✅ |
| `backend/.../workflows/drawio.ts` (`layoutFromSpec`) | Optional conservative same‑rank reversal correction. | 🔧 secondary / ❓ |
| `backend/.../workflows/generator.ts` | Optional: emit branch edges in handle order. | 🔧 optional |

---

## 9. Illustrative Post‑Pass (pseudocode, matches `autoLayout.ts` shape)

```ts
// 🔧 Proposed — appended inside layoutGraph, AFTER building `positioned` nodes.
function enforceHandleOrder(nodes, edges, direction) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outOf = (id) => edges.filter(e => e.source === id && e.sourceHandle);
  const parentsOf = (id) => edges.filter(e => e.target === id);
  const axis = direction === "LR" ? "y" : "x";   // cross-axis to order on

  for (const s of nodes) {
    const order = handleOrder(s);                 // left→right / top→bottom
    if (order.length < 2) continue;
    const targets = order
      .map(h => outOf(s.id).find(e => e.sourceHandle === h)?.target)
      .filter(Boolean)
      .filter(t => parentsOf(t).length === 1);    // sole-parent guard
    if (targets.length < 2) continue;

    const slots = targets.map(t => byId.get(t).position[axis]).sort((a,b) => a-b);
    targets.forEach((t, i) => {
      const node = byId.get(t);
      const delta = slots[i] - node.position[axis];
      if (delta) shiftSubtree(t, axis, delta, byId, edges, /*excludeOtherBranches*/ targets);
    });
  }
}
```

`shiftSubtree` BFS‑walks `edges` from the target, shifting each exclusively‑owned descendant by `delta` on `axis`, stopping at nodes reachable from a sibling branch or above `s`.

---

## 10. Risks, Edge Cases, Backward Compatibility

- **Shared downstream node** (both branches converge, or `else` points to a node that is also another block's child): not reordered (sole‑parent guard) — a crossing may remain by necessity; acceptable and expected. ✅
- **Three+ options (LIST):** sorting by cross‑axis in config order generalizes; no special‑case. ✅
- **LR vs TB:** handled by choosing the sort axis. ✅
- **Idempotent:** re‑running layout doesn't drift (sort→reassign is stable). 🔧 (add a test).
- **No data change:** edges, `sourceHandle`, validation, runtime untouched → fully backward compatible; existing saved flows just lay out more cleanly on the next auto‑layout. ✅
- **Manual positions:** the correction only runs inside `layoutGraph` (invoked by the Vertical/Horizontal buttons and post‑generation), so a user who hand‑places nodes is not overridden until they click auto‑layout. ✅
- **Diagram fidelity:** the optional `layoutFromSpec` change is deliberately minimal to preserve the drawn layout. ❓ (§6.5).

---

## 11. Test Strategy and Cases

> `autoLayout.ts` is pure (nodes/edges in → nodes out), so it is unit‑testable without React.

| # | Case | Expected |
|---|---|---|
| 1 | CONDITION, dagre places true‑target right / else‑target left | After pass: true‑target x < else‑target x (TB); no crossing. |
| 2 | CONDITION already correct | Pass is a no‑op (idempotent). |
| 3 | API_REQUEST success/failure reversed | success‑target left of failure‑target. |
| 4 | LR direction | Ordering enforced on **y** (true above else). |
| 5 | Branch target is a shared merge node | Not moved; no exception. |
| 6 | Branch target has a subtree | Whole subtree shifts with it; children stay under their parent. |
| 7 | LIST with 3 rows fanned out | Row targets ordered by config order along the cross axis. |
| 8 | SEND_MESSAGE with 2 CTA buttons | Button targets ordered by button order. |
| 9 | Run layout twice | Identical output (stable). |
| 10 | Dangling branch edge (target deleted) | Skipped safely (as today). |
| 11 | (Diagram) same‑rank reversed true/else | Corrected; other diagram positions unchanged. |
| 12 | Edge labels after fix | "true"/"success" column on the left, "else"/"failure" on the right, matching handles. |

**Acceptance criteria**
- For every CONDITION/API_REQUEST with two sole‑parent targets, `x(trueTarget) < x(elseTarget)` in TB (`y(...)` in LR) after auto‑layout.
- No change to any edge's `source`/`target`/`sourceHandle`.
- Auto‑layout is idempotent.
- Existing backend tests and typechecks still pass.

---

## 12. Open Questions

- ❓ Should diagram‑imported flows be corrected at all, or faithfully mirror the diagram (even if True is drawn on the right)? Recommended: correct only clear same‑rank reversals.
- ❓ Do we also want the optional generator edge‑ordering nudge (§7), or rely solely on the client post‑pass? Recommended: client post‑pass is sufficient; generator nudge optional.
- ❓ For choice nodes, is left→right (TB) the desired mapping of option order, or is top→bottom preferred even in TB? Recommended: follow the layout direction (cross‑axis).

---

## 13. Scope Confirmation

- This document only. **No application source files were changed.**
- The fix is layout‑only: handles, edge data, validation, runtime, and the meaning of true/else are all unchanged.
