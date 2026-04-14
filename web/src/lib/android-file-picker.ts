import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { logger } from "@/lib/logger";

function timestampFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `photo_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.jpg`;
}

async function webPathToFile(webPath: string, name: string): Promise<File> {
  const response = await fetch(webPath);
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

export async function takePhoto(): Promise<File[]> {
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      quality: 90,
    });

    if (!photo.webPath) return [];
    const file = await webPathToFile(photo.webPath, timestampFilename());
    return [file];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("cancelled") || msg.includes("canceled")) return [];
    logger.warn("[android-file-picker] takePhoto error:", err);
    return [];
  }
}

export async function pickFromGallery(): Promise<File[]> {
  try {
    const result = await Camera.pickImages({ quality: 90 });

    const files = await Promise.all(
      result.photos
        .filter((p) => p.webPath)
        .map((p, i) => {
          const ext = p.format === "png" ? "png" : "jpg";
          const name = `gallery_${Date.now()}_${i}.${ext}`;
          return webPathToFile(p.webPath!, name);
        }),
    );
    return files;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("cancelled") || msg.includes("canceled")) return [];
    logger.warn("[android-file-picker] pickFromGallery error:", err);
    return [];
  }
}
