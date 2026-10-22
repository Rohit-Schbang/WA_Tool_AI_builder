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

// Metadata we record about an exported journey, alongside the flow itself, so
// the file is self-describing (which bot, when, from where, how big) instead of
// a bare nodes/edges blob.
export interface JourneyExportMeta {
  chatbotId?: string;
  name?: string;
  isActive?: boolean;
  createdAt?: string | null;
  // "builder" = current canvas (may include unsaved edits); "draft" = the saved
  // draft fetched from the server (dashboard export).
  source: "builder" | "draft";
  // The live published version number, when known.
  liveVersion?: number | null;
}

// The envelope written to disk: metadata + the raw flow definition. `kind` and
// `exportVersion` let an importer recognise and migrate the format later.
export interface JourneyExport {
  kind: "wa-ai-tool/journey-export";
  exportVersion: 1;
  exportedAt: string;
  chatbot: {
    id?: string;
    name?: string;
    isActive?: boolean;
    createdAt?: string | null;
  };
  source: "builder" | "draft";
  liveVersion?: number | null;
  stats: {
    nodes: number;
    edges: number;
    variables: number;
    apiConfigs: number;
  };
  definition: any;
}

// Count the meaningful parts of a flow definition for the export's stats block.
function countStats(definition: any): JourneyExport["stats"] {
  const len = (v: any) => (Array.isArray(v) ? v.length : 0);
  return {
    nodes: len(definition?.nodes),
    edges: len(definition?.edges),
    variables: len(definition?.variables),
    apiConfigs: len(definition?.apiConfigs),
  };
}

// Wrap a raw flow definition in the self-describing export envelope.
export function wrapJourneyExport(definition: any, meta: JourneyExportMeta): JourneyExport {
  return {
    kind: "wa-ai-tool/journey-export",
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    chatbot: {
      id: meta.chatbotId,
      name: meta.name,
      isActive: meta.isActive,
      createdAt: meta.createdAt ?? null,
    },
    source: meta.source,
    liveVersion: meta.liveVersion ?? null,
    stats: countStats(definition),
    definition,
  };
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
