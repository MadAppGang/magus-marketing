/**
 * Direct /images/edits call for OpenAI — a workaround for an upstream SDK bug.
 *
 * WHY THIS EXISTS (verified experimentally 2026-07-28, not inferred):
 *
 * `@ai-sdk/openai@4.0.20` wraps edit images in a bare `Blob`, and
 * `convertToFormData` in @ai-sdk/provider-utils does `formData.append(key, value)`
 * with no filename argument. OpenAI's /images/edits then rejects the request.
 * The same package's *files* API appends WITH a filename, so this is an
 * oversight on the image path, not an API limitation.
 *
 * Controlled test, same endpoint / key / bytes, one variable:
 *   Blob, no filename  -> 400 "Invalid file 'image': missing filename"
 *   same bytes + name  -> 200 OK
 *
 * So we bypass the SDK for exactly this case. Everything else still goes
 * through `generateImage`. Delete this module once the SDK passes a filename —
 * the check is `supportsEdit` in models.ts.
 */

const ENDPOINT = "https://api.openai.com/v1/images/edits";

/** Sniff the container so the multipart filename carries a truthful extension. */
function sniff(bytes: Uint8Array): { ext: string; mediaType: string } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png", mediaType: "image/png" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mediaType: "image/jpeg" };
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ext: "webp", mediaType: "image/webp" };
  }
  // OpenAI accepts png/jpeg/webp; default to png rather than sending no type.
  return { ext: "png", mediaType: "image/png" };
}

export interface OpenAiEditOptions {
  apiKey: string;
  model: string;
  prompt: string;
  images: Uint8Array[];
  /** e.g. "1536x1024". Omitted means the model default. */
  size?: string;
  maxRetries?: number;
}

export interface OpenAiEditResult {
  uint8Array: Uint8Array;
  mediaType: string;
}

export async function openaiEditImage(opts: OpenAiEditOptions): Promise<OpenAiEditResult> {
  const { apiKey, model, prompt, images, size, maxRetries = 2 } = opts;
  if (images.length === 0) throw new Error("openaiEditImage requires at least one image");

  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  if (size) form.append("size", size);

  images.forEach((bytes, i) => {
    const { ext, mediaType } = sniff(bytes);
    // The filename is the entire point of this module.
    form.append(
      images.length > 1 ? "image[]" : "image",
      new Blob([bytes], { type: mediaType }),
      `image-${i}.${ext}`
    );
  });

  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 1000, 8000)));
    }
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string }>;
        output_format?: string;
      };
      const b64 = json.data?.[0]?.b64_json;
      if (!b64) throw new Error("OpenAI returned no image data");
      const fmt = (json.output_format ?? "png").toLowerCase();
      return {
        uint8Array: Uint8Array.from(Buffer.from(b64, "base64")),
        mediaType: fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : `image/${fmt}`,
      };
    }

    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    lastError = body?.error?.message ?? `HTTP ${res.status}`;
    // Only 429/5xx are worth retrying; a 400 will fail identically every time.
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(lastError || "OpenAI image edit failed");
}
