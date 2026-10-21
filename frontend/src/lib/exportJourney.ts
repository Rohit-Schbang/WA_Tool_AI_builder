// Helpers for exporting a workflow "journey" definition as a downloadable
// JSON file. Shared by the builder (current canvas) and the dashboard card
// (saved draft fetched from the API).

// Turn a bot name into a safe file-name stem (letters/digits/dash/underscore).
function slugify(name: string): string {
  const s = (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "journey";
}

// Trigger a browser download of `data` serialized as pretty JSON.
export function downloadJson(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".json") ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Build a conventional file name: "<slug>-journey-YYYY-MM-DD.json".
export function journeyFileName(botName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${slugify(botName)}-journey-${date}.json`;
}
