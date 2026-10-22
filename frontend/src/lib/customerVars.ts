// Customer variables — frontend mirror of backend/src/modules/runtime/customerVars.ts.
// A reserved namespace that's always available in every journey (seeded from the
// WhatsApp identity + Contact). Shown grouped under "Customer" in the variable
// pickers. Keep in sync with the backend.

export const CUSTOMER_VAR_PREFIX = "customer_";
export const CUSTOMER_NAME = "customer_name";
export const CUSTOMER_PHONE = "customer_phone";

export interface CustomerVarDef {
  name: string;         // full reserved name, e.g. "customer_name"
  label: string;        // short display label, e.g. "name"
  type: "text";
  readOnly: boolean;    // read-only vars can be READ but not stored into
  icon: string;         // phosphor icon class suffix (e.g. "ph-user")
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
  return name === CUSTOMER_PHONE;
}
