import { config } from "../../infra/config.js";

// Emails allowed to open WhatsApp Settings. Configure via SETTINGS_ADMIN_EMAILS.
export const settingsAdminEmails: string[] = config.SETTINGS_ADMIN_EMAILS
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// Exact, case-insensitive match on the whole address.
export function isSettingsAdmin(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return e.length > 0 && settingsAdminEmails.includes(e);
}

export const settingsForbiddenMessage = "You don't have access to Settings. Ask an admin if you need it.";
