/**
 * Split text into overlapping chunks on sentence boundaries.
 *
 * @param text        The full text to chunk
 * @param chunkSize   Maximum character length per chunk (default 1000)
 * @param overlap     Characters pulled from end of previous chunk into next (default 200)
 * @returns           Array of trimmed, non-empty chunks
 */
export function chunkText(
  text: string,
  chunkSize = 1000,
  overlap = 200,
): string[] {
  if (!text.trim()) return [];

  // Split on sentence boundaries: . ! ? followed by whitespace
  const sentences = text.match(/[^.!?]*[.!?]+\s*/g);

  // If no sentence boundaries found, fall back to word splitting
  const parts = sentences ?? splitByWords(text, chunkSize);

  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    // If a single part exceeds chunkSize, split it by words
    if (part.length > chunkSize) {
      // Flush current buffer first
      if (current.trim()) {
        chunks.push(current.trim());
        current = getOverlap(current, overlap);
      }
      // Split the oversized part by words
      const wordChunks = splitByWords(part, chunkSize);
      for (const wc of wordChunks) {
        chunks.push((current + wc).trim());
        current = getOverlap(current + wc, overlap);
      }
      continue;
    }

    if (current.length + part.length > chunkSize) {
      if (current.trim()) {
        chunks.push(current.trim());
      }
      current = getOverlap(current, overlap) + part;
    } else {
      current += part;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/** Pull the last `overlap` characters from text as the overlap prefix. */
function getOverlap(text: string, overlap: number): string {
  if (text.length <= overlap) return text;
  return text.slice(-overlap);
}

/** Split text into segments of at most `maxLen` chars on word boundaries. */
function splitByWords(text: string, maxLen: number): string[] {
  const words = text.split(/\s+/);
  const segments: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > maxLen && current) {
      segments.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    segments.push(current);
  }

  return segments;
}
