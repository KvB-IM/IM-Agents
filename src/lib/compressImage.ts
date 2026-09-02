/**
 * Shrink a photograph in the browser before uploading it.
 *
 * Bandwidth only — NOT correctness. Because uploads go direct to the blob store
 * rather than through a serverless function, there is no ~4.5MB request cap to
 * squeeze under, so a compression that under-performs still succeeds, just
 * slower. That distinction is the whole reason for the blob path: making
 * canvas compression load-bearing on a phone is how a licence photo fails at a
 * kitchen table.
 *
 * So every failure here falls back to the original file rather than throwing.
 * A 6MB upload on cellular is slow; a lost licence photo is a second visit.
 */

export interface CompressOptions {
  /** Longest edge, in pixels. 1600 keeps the small print on a licence legible. */
  maxEdge?: number;
  /** JPEG quality, 0-1. */
  quality?: number;
  /** Below this, leave it alone — recompressing a small file gains nothing. */
  skipUnderBytes?: number;
}

export interface CompressResult {
  file: File;
  originalBytes: number;
  bytes: number;
  /** True when the original was returned unchanged. */
  passthrough: boolean;
  /** Why, when it fell back. Surfaced in logs, not to the agent. */
  reason?: string;
}

const DEFAULTS: Required<CompressOptions> = {
  maxEdge: 1600,
  quality: 0.8,
  skipUnderBytes: 400 * 1024,
};

export async function compressImage(
  input: File,
  options: CompressOptions = {},
): Promise<CompressResult> {
  const { maxEdge, quality, skipUnderBytes } = { ...DEFAULTS, ...options };
  const originalBytes = input.size;

  const passthrough = (reason: string): CompressResult => ({
    file: input,
    originalBytes,
    bytes: originalBytes,
    passthrough: true,
    reason,
  });

  if (!input.type.startsWith("image/")) return passthrough("not an image");
  if (originalBytes <= skipUnderBytes) return passthrough("already small");

  let bitmap: ImageBitmap | null = null;
  try {
    /* createImageBitmap rather than an <img> with a data URL: it decodes off
     * the main thread, handles EXIF orientation, and does not need the whole
     * file base64-encoded into a string first — which on a 12MP photo is where
     * a phone runs out of memory. */
    bitmap = await createImageBitmap(input);
  } catch (err) {
    return passthrough(`decode failed: ${String(err)}`);
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    /* OffscreenCanvas where available — it does not touch the DOM and has
     * looser memory limits on iOS. Falls back to a detached <canvas>. */
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height });

    const ctx = canvas.getContext("2d") as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) return passthrough("no 2d context");

    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, quality);
    if (!blob) return passthrough("encode returned nothing");

    /* Recompression can enlarge an already-optimised image. Keep whichever is
     * smaller — the point is fewer bytes over a cellular link, not having run
     * the canvas. */
    if (blob.size >= originalBytes) return passthrough("no smaller than the original");

    const name = input.name.replace(/\.[^.]+$/, "") || "photo";
    return {
      file: new File([blob], `${name}.jpg`, { type: "image/jpeg" }),
      originalBytes,
      bytes: blob.size,
      passthrough: false,
    };
  } catch (err) {
    return passthrough(`resize failed: ${String(err)}`);
  } finally {
    bitmap?.close?.();
  }
}

/** `toBlob` on a canvas, `convertToBlob` on an OffscreenCanvas. */
function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ type: "image/jpeg", quality }).catch(() => null);
  }
  return new Promise((resolve) => {
    // Can hand back null under memory pressure, which is exactly why every
    // caller path here falls back to the original file.
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}
