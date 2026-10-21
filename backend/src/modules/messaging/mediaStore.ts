import { config } from "../../infra/config.js";
import type { InboundMedia, InboundType } from "../runtime/types.js";

// Inbound WhatsApp media handling.
//
// When a user sends a photo/video/document to a Question, Meta only gives us a
// media id that expires in a few days. To keep the file we:
//   1. ask Meta for the media's temporary download URL,
//   2. download the bytes (authorized with the WABA access token),
//   3. upload them to a Supabase Storage bucket,
//   4. return a durable public URL.
// If Supabase isn't configured, this is skipped and callers keep the metadata.

const GRAPH = "https://graph.facebook.com/v21.0";

export function isMediaStoreConfigured(): boolean {
  return Boolean(config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY);
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/3gpp": "3gp",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac",
  "application/pdf": "pdf",
};

function extFor(mime: string | undefined, filename: string | undefined): string {
  if (filename && filename.includes(".")) return filename.split(".").pop()!.slice(0, 8);
  return EXT[(mime ?? "").split(";")[0].trim()] ?? "bin";
}

// Ask Meta for the short-lived download URL for a media id.
async function getMediaUrl(mediaId: string, token: string): Promise<{ url: string; mime?: string } | null> {
  const res = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`[media] metadata fetch failed: ${res.status}`); return null; }
  const data: any = await res.json();
  return data?.url ? { url: data.url, mime: data.mime_type } : null;
}

// Download the actual bytes (the media URL also needs the bearer token).
async function download(url: string, token: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { console.error(`[media] download failed: ${res.status}`); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

// Upload bytes to Supabase Storage and return a public URL.
async function uploadToSupabase(path: string, bytes: Buffer, contentType: string): Promise<string | null> {
  const base = config.SUPABASE_URL!.replace(/\/$/, "");
  const bucket = config.SUPABASE_MEDIA_BUCKET;
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: bytes as any,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error(`[media] supabase upload failed: ${res.status} ${t.slice(0, 200)}`);
    return null;
  }
  return `${base}/storage/v1/object/public/${bucket}/${path}`;
}

// Download an inbound media item from Meta and store it in Supabase. Returns a
// media object with a durable `url` added, or the original metadata on failure
// (so a storage hiccup never drops the user's answer).
export async function storeInboundMedia(
  media: InboundMedia,
  type: InboundType,
  token: string,
  chatbotId: string
): Promise<InboundMedia> {
  // Location has no file; nothing to download.
  if (!media?.id || !isMediaStoreConfigured() || !token) return media;
  try {
    const meta = await getMediaUrl(media.id, token);
    if (!meta) return media;
    const dl = await download(meta.url, token);
    if (!dl) return media;
    const mime = media.mimeType ?? meta.mime ?? dl.contentType;
    const path = `${chatbotId}/${type}/${media.id}.${extFor(mime, media.filename)}`;
    const url = await uploadToSupabase(path, dl.bytes, mime);
    return url ? { ...media, url, mimeType: mime } : media;
  } catch (err) {
    console.error("[media] store failed:", (err as Error)?.message ?? err);
    return media;
  }
}
