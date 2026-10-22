// Customer variables — a small, RESERVED namespace that is always available in
// every journey without the user declaring it. They are seeded from the
// WhatsApp identity + the Contact record, and (for the name) synced BACK to the
// Contact when a journey changes them.
//
// Syntax (decision A2): flat reserved names with a "customer_" prefix, so the
// existing {{var}} interpolation (/\{\{\s*(\w+)\s*\}\}/) and the TRANSFORM
// sandbox (vars.customer_name) work unchanged — no engine-wide dotted-name
// change. The builder shows them grouped under "Customer" for a clean UX.
//
//   customer_phone : the WhatsApp number (identity key). READ-ONLY — it's the
//                    conversation/contact key, so a journey must not overwrite it.
//   customer_name  : the contact's name (Meta profile name initially). Writable;
//                    changes flow back to the Contact row.

export const CUSTOMER_VAR_PREFIX = "customer_";

export const CUSTOMER_NAME = "customer_name";
export const CUSTOMER_PHONE = "customer_phone";

// Reserved names a journey must not declare/overwrite freely. `phone` is fully
// read-only; `name` is writable (and synced to the Contact).
export const CUSTOMER_VAR_NAMES = [CUSTOMER_NAME, CUSTOMER_PHONE] as const;
export type CustomerVarName = (typeof CUSTOMER_VAR_NAMES)[number];

// Read-only customer variables — valid to READ ({{customer_phone}}) but never a
// valid "store answer into" target.
export const READONLY_CUSTOMER_VARS = new Set<string>([CUSTOMER_PHONE]);

// UI metadata so the builder can render the "Customer" group without
// hard-coding names in the frontend. `icon` is a Phosphor icon name.
export interface CustomerVarDef {
  name: CustomerVarName;
  label: string;        // short display label ("name", "phone")
  type: "text";
  readOnly: boolean;
  icon: string;         // phosphor icon (e.g. "ph-user", "ph-phone")
  description: string;
}

export const CUSTOMER_VAR_DEFS: CustomerVarDef[] = [
  { name: CUSTOMER_NAME, label: "name", type: "text", readOnly: false, icon: "ph-user", description: "The contact's name (from WhatsApp; updates the contact when changed)." },
  { name: CUSTOMER_PHONE, label: "phone", type: "text", readOnly: true, icon: "ph-phone", description: "The contact's WhatsApp number (read-only)." },
];

export function isCustomerVar(name: string): boolean {
  return (name ?? "").startsWith(CUSTOMER_VAR_PREFIX);
}

export function isReadOnlyCustomerVar(name: string): boolean {
  return READONLY_CUSTOMER_VARS.has(name);
}

// Seed the reserved customer variables into a conversation's variable map.
// Existing values win (a journey may already have set customer_name), so we
// never clobber a user-collected value with the raw seed; phone is always the
// identity. Returns the same object for convenience.
export function seedCustomerVars(
  variables: Record<string, any>,
  seed: { phone: string; name?: string | null }
): Record<string, any> {
  // Phone is the identity key — always authoritative.
  variables[CUSTOMER_PHONE] = seed.phone;
  // Name: only fill when not already present, so an in-journey value sticks.
  if (variables[CUSTOMER_NAME] == null || variables[CUSTOMER_NAME] === "") {
    if (seed.name != null && String(seed.name).trim() !== "") {
      variables[CUSTOMER_NAME] = String(seed.name);
    }
  }
  return variables;
}

// Extract the Contact-syncable fields from a variable map after a run. Only the
// name is syncable today (phone is the key and read-only). Returns undefined
// when there's nothing meaningful to sync.
export function contactPatchFromVars(variables: Record<string, any>): { name?: string } | undefined {
  const raw = variables?.[CUSTOMER_NAME];
  const name = raw == null ? "" : String(raw).trim();
  if (!name) return undefined;
  return { name };
}
