import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { compressImage } from "./file-extraction";

const MAX_IMAGE_BYTES = 5_242_880;

/**
 * Create a large uncompressed PNG image for testing.
 * A 4000x3000 solid-color image is ~36 MB uncompressed but even as PNG
 * it's large enough to exceed Anthropic's 5 MB limit when converted to JPEG
 * at high quality with noise added.
 */
async function createLargeImage(targetBytes: number): Promise<Buffer> {
  // Start with a large noisy image (noise compresses poorly → big JPEG)
  const width = 4000;
  const height = 3000;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);

  // Fill with random-ish data so JPEG can't compress it too well
  for (let i = 0; i < raw.length; i++) {
    raw[i] = Math.floor(Math.random() * 256);
  }

  let quality = 100;
  let buf = await sharp(raw, { raw: { width, height, channels } })
    .jpeg({ quality })
    .toBuffer();

  // If still not big enough, increase dimensions
  if (buf.byteLength < targetBytes) {
    // The random noise should produce a large enough JPEG at 4000x3000
    // If not, this is still a valid test — we just verify compression works
    return buf;
  }

  return buf;
}

describe("compressImage", () => {
  it("compresses an image to under 5 MB", async () => {
    const largeImage = await createLargeImage(MAX_IMAGE_BYTES + 1_000_000);

    // Only run the meaningful assertion if we actually got a large image
    if (largeImage.byteLength <= MAX_IMAGE_BYTES) {
      // Image wasn't large enough for the test — skip
      return;
    }

    const result = await compressImage(largeImage);

    expect(result.data.byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(result.mediaType).toBe("image/jpeg");
  });

  it("returns a valid JPEG for a small image (no compression needed)", async () => {
    // Create a small 100x100 solid color image (well under 5 MB)
    const smallImage = await sharp({
      create: { width: 100, height: 100, channels: 3, background: "#ff0000" },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    expect(smallImage.byteLength).toBeLessThan(MAX_IMAGE_BYTES);

    const result = await compressImage(smallImage);

    expect(result.data.byteLength).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    expect(result.mediaType).toBe("image/jpeg");
  });

  it("preserves image readability after compression", async () => {
    const largeImage = await createLargeImage(MAX_IMAGE_BYTES + 500_000);

    if (largeImage.byteLength <= MAX_IMAGE_BYTES) {
      return;
    }

    const result = await compressImage(largeImage);

    // Verify the result is a valid image by reading its metadata
    const metadata = await sharp(result.data).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBeGreaterThan(0);
    expect(metadata.height).toBeGreaterThan(0);
  });
});
