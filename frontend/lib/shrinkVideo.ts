/**
 * Shrink a big video to 1080p H.264 in the browser before uploading it.
 *
 * Phones record 4K HEVC at ~40 Mbps: a 1:45 clip is ~500 MB, which takes many minutes to upload
 * and is slow for the server to decode on every cut. The browser re-encodes it with the device's
 * hardware encoder (WebCodecs, via mediabunny) to ~1/6 of the size, usually faster than the
 * upload it saves. Anything that isn't worth it or isn't supported is uploaded untouched.
 */

/** Short side of the output; the server cuts 1080×1920 clips, so more is wasted. */
const TARGET_SHORT_SIDE = 1080;
/** Files already at or under 1080p and this bitrate go up as they are. */
const SKIP_BELOW_BPS = 12_000_000;
/** Very long files (full stream VODs) would take too long to re-encode on a phone. */
const MAX_SECONDS = 30 * 60;

export type ShrinkProgress = (fraction: number) => void;

export async function shrinkForUpload(file: File, onProgress?: ShrinkProgress, signal?: AbortSignal): Promise<File> {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return file;

  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return file;
    const duration = await input.computeDuration();
    if (!duration || duration > MAX_SECONDS) return file;

    const w = track.displayWidth;
    const h = track.displayHeight;
    const short = Math.min(w, h);
    const bitrate = (file.size * 8) / duration;
    if (short <= TARGET_SHORT_SIDE && bitrate <= SKIP_BELOW_BPS) return file;

    // Keep the aspect ratio, short side 1080 (never upscale), even dimensions for H.264.
    const scale = Math.min(1, TARGET_SHORT_SIDE / short);
    const width = Math.round((w * scale) / 2) * 2;
    const height = Math.round((h * scale) / 2) * 2;
    if (!(await mb.canEncodeVideo("avc", { width, height }))) return file;

    // Fragmented MP4 is written strictly in order, so chunks can stream into a Blob instead
    // of holding the whole file in one buffer.
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let written = 0;
    let outOfOrder = false;
    const sink = new WritableStream<{ type: "write"; data: Uint8Array<ArrayBuffer>; position: number }>({
      write(chunk) {
        if (chunk.position !== written) outOfOrder = true;
        parts.push(chunk.data);
        written += chunk.data.byteLength;
      },
    });
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "fragmented" }),
      target: new mb.StreamTarget(sink),
    });

    const conversion = await mb.Conversion.init({
      input,
      output,
      tracks: "primary",
      video: { width, height, fit: "contain", codec: "avc", quality: mb.QUALITY_HIGH, hardwareAcceleration: "prefer-hardware" },
      audio: { codec: "aac" },
    });
    if (!conversion.isValid) return file; // e.g. this browser can't decode the source codec

    const abort = () => void conversion.cancel();
    signal?.addEventListener("abort", abort, { once: true });
    if (onProgress) conversion.onProgress = (p) => onProgress(Math.min(1, p));
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener("abort", abort);
    }

    // Not meaningfully smaller (already efficient), or written oddly: send the original.
    if (outOfOrder || written === 0 || written > file.size * 0.8) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
    return new File(parts, name, { type: "video/mp4" });
  } catch (err) {
    if (signal?.aborted) throw err;
    console.warn("Couldn't shrink the video before upload; sending the original.", err);
    return file;
  } finally {
    input.dispose();
  }
}
