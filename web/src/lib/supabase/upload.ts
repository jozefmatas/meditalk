import { createClient } from "@/lib/supabase/client";

export interface UploadResult {
  path: string;
  fileId: string;
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
  const path = opts?.encounterId
    ? `${user.id}/${opts.encounterId}/${fileId}-${fileName}`
    : `${user.id}/${fileId}-${fileName}`;

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
