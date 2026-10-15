import { config } from "../../infra/config.js";

// Organisation-only access: only emails on these domains may register / log in.
// Configure via ALLOWED_EMAIL_DOMAINS.
export const allowedDomains: string[] = config.ALLOWED_EMAIL_DOMAINS
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
  .filter(Boolean);

// Exact domain match on the part after the LAST "@". This rejects lookalikes
// such as "x@schbang.com.evil.com" or "x@notschbang.com".
export function isAllowedEmail(email: string): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return false;
  return allowedDomains.includes(e.slice(at + 1));
}

export const domainErrorMessage = `Only ${allowedDomains.map((d) => "@" + d).join(", ")} email addresses can access this workspace.`;
