import { createClient } from "@/lib/supabase/client";

export interface UploadResult {
  path: string;
  fileId: string;
}

/**
 * Sanitize filename for storage - remove/replace special characters.
 * Keeps ASCII letters, numbers, dots, hyphens, underscores.
 * Preserves file extension.
 */
function sanitizeFilename(filename: string): string {
  // Split name and extension
  const lastDotIndex = filename.lastIndexOf(".");
  const name =
    lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
  const ext = lastDotIndex > 0 ? filename.substring(lastDotIndex) : "";

  // Normalize unicode characters (e.g., č → c, á → a)
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Replace spaces and special chars with hyphens, keep only safe characters
  const sanitized = normalized
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized + ext;
}

/**
 * Upload a file directly to Supabase Storage from the browser.
 * Bypasses Vercel's 4.5 MB serverless body-size limit by going
 * straight to the storage bucket (RLS enforces userId prefix).
 */
export async function uploadToStorage(
  file: File | Blob,
  fileName: string,
  opts?: { encounterId?: string },
): Promise<UploadResult> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Not authenticated");
  }

  const fileId = crypto.randomUUID();
  const sanitizedFileName = sanitizeFilename(fileName);
  const path = opts?.encounterId
    ? `${user.id}/${opts.encounterId}/${fileId}-${sanitizedFileName}`
    : `${user.id}/${fileId}-${sanitizedFileName}`;

  const contentType =
    file instanceof File ? file.type : "application/octet-stream";

  const { error: uploadError } = await supabase.storage
    .from("encounter-files")
    .upload(path, file, { contentType, upsert: false });

  if (uploadError) {
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  return { path, fileId };
}
