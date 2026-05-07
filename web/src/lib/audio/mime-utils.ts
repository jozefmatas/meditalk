/**
 * Map audio MIME type to file extension.
 *
 * Safari records `audio/mp4` while Chrome records `audio/webm`.
 * A mismatched filename + content can confuse server-side format
 * detection (e.g. ElevenLabs), so we derive the extension from the
 * actual MIME type of the blob.
 */
export function audioMimeToExt(mime: string): string {
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  return ".webm";
}
