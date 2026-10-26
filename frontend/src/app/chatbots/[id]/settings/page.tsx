import { redirect } from "next/navigation";

// WhatsApp Settings used to be per journey. There is now ONE workspace-level
// connection, so old links/bookmarks go to /settings.
export default function LegacyJourneySettings() {
  redirect("/settings");
}
