/**
 * Generation pipeline: styles, reference/edit images, batch output.
 *
 * Retry/backoff is delegated to the AI SDK (`maxRetries`) rather than
 * reimplemented — the previous hand-rolled backoff duplicated what the
 * framework already does.
 */

import { generateImage } from "ai";

// We surface provider warnings ourselves (see below), with the model named and
// no stack trace. Leaving the SDK's own logger on would print each one twice.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";
import { imageModelFor, MissingApiKeyError } from "./providers.js";
import { openaiEditImage } from "./openai-edit.js";
import { apiKeyFor, type PinnedModel } from "./models.js";

export const ErrorCode = {
  SUCCESS: "SUCCESS",
  API_KEY_MISSING: "API_KEY_MISSING",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  API_ERROR: "API_ERROR",
  PARTIAL_FAILURE: "PARTIAL_FAILURE",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ASPECT_RATIOS = [
  "1:1", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9",
  // Nano Banana 2 additions
  "1:4", "4:1", "1:8", "8:1",
];

const MAX_PROMPT_CHARS = 4000;

export interface GenerateOptions {
  prompts: string[];
  outputPath: string;
  model: PinnedModel;
  stylePath?: string | null;
  editPath?: string | null;
  refPaths?: string[];
  aspectRatio?: string;
  maxRetries?: number;
}

export interface ImageResult {
  prompt: string;
  outputPath?: string;
  success: boolean;
  errorCode?: ErrorCodeValue;
  error?: string;
}

export interface GenerateResult {
  success: boolean;
  errorCode: ErrorCodeValue;
  results: ImageResult[];
  total: number;
  succeeded: number;
  failed: number;
}

function sanitizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error("Prompt is empty");
  if (trimmed.length > MAX_PROMPT_CHARS) {
    throw new Error(`Prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  }
  return trimmed;
}

function loadStyle(stylePath: string): string {
  const content = readFileSync(stylePath, "utf8");
  if (!content.trim()) throw new Error(`Style file is empty: ${stylePath}`);
  return content.trim();
}

function loadImage(imagePath: string): Uint8Array {
  return new Uint8Array(readFileSync(imagePath));
}

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

/** Swap the output extension to match what the provider actually returned. */
export function correctExtension(outPath: string, mediaType: string): string {
  const want = EXT_BY_MEDIA_TYPE[mediaType?.toLowerCase()];
  if (!want) return outPath;
  const current = extname(outPath).toLowerCase();
  if (current === want) return outPath;
  // .jpg and .jpeg are the same thing — don't churn the name over it.
  if (want === ".jpg" && current === ".jpeg") return outPath;
  return join(dirname(outPath), basename(outPath, extname(outPath)) + want);
}

/**
 * Translate an aspect ratio into the shape argument this model actually honours.
 *
 * Models differ: Google and OpenRouter take `aspectRatio`, OpenAI takes `size`
 * and silently DROPS aspectRatio (verified — it emits only a buried SDK
 * warning). Passing the wrong one means the user asks for 16:9 and gets a
 * square with no visible complaint, so translate rather than hope.
 */
export function shapeArgs(
  model: PinnedModel,
  aspectRatio: string
): { aspectRatio?: `${number}:${number}` } | { size?: `${number}x${number}` } {
  if (model.sizing === "aspect") {
    return { aspectRatio: aspectRatio as `${number}:${number}` };
  }

  const sizes = model.sizes ?? [];
  if (sizes.length === 0) return {};

  const [w, h] = aspectRatio.split(":").map(Number);
  if (!w || !h) return { size: sizes[0] as `${number}x${number}` };
  const wanted = w / h;

  // Pick the supported size whose ratio is closest to what was asked for.
  let best = sizes[0]!;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const s of sizes) {
    const [sw, sh] = s.split("x").map(Number);
    if (!sw || !sh) continue;
    const delta = Math.abs(sw / sh - wanted);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return { size: best as `${number}x${number}` };
}

export async function generate(opts: GenerateOptions): Promise<GenerateResult> {
  const {
    prompts,
    outputPath,
    model,
    stylePath = null,
    editPath = null,
    refPaths = [],
    aspectRatio = "1:1",
    maxRetries = 3,
  } = opts;

  let imageModel;
  try {
    imageModel = imageModelFor(model);
  } catch (e) {
    if (e instanceof MissingApiKeyError) {
      return {
        success: false,
        errorCode: ErrorCode.API_KEY_MISSING,
        results: [],
        total: prompts.length,
        succeeded: 0,
        failed: prompts.length,
      };
    }
    throw e;
  }

  let styleText = "";
  const inputImages: Uint8Array[] = [];
  try {
    if (stylePath) styleText = loadStyle(stylePath);
    // Edit source first — providers treat the leading image as the subject.
    if (editPath) inputImages.push(loadImage(editPath));
    for (const p of refPaths) inputImages.push(loadImage(p));
  } catch (e) {
    return {
      success: false,
      errorCode: ErrorCode.FILE_NOT_FOUND,
      results: [{ prompt: "", success: false, error: (e as Error).message }],
      total: prompts.length,
      succeeded: 0,
      failed: prompts.length,
    };
  }

  const outputBase = basename(outputPath, extname(outputPath));
  const outputExt = extname(outputPath) || ".png";
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });

  const results: ImageResult[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const raw = prompts[i]!;
    let safePrompt: string;
    try {
      safePrompt = sanitizePrompt(raw);
    } catch (e) {
      results.push({
        prompt: raw,
        success: false,
        errorCode: ErrorCode.INVALID_INPUT,
        error: (e as Error).message,
      });
      continue;
    }

    const text = styleText ? `${styleText}\n\n${safePrompt}` : safePrompt;
    const outPath =
      prompts.length > 1
        ? join(outputDir, `${outputBase}_${String(i + 1).padStart(3, "0")}${outputExt}`)
        : outputPath;

    try {
      let image: { uint8Array: Uint8Array; mediaType: string };
      let warnings: Array<Record<string, unknown>> = [];

      if (model.provider === "openai" && inputImages.length) {
        // Upstream SDK cannot send edit images to OpenAI — see openai-edit.ts.
        const shape = shapeArgs(model, aspectRatio) as { size?: string };
        image = await openaiEditImage({
          apiKey: apiKeyFor(model)!,
          model: model.routeId,
          prompt: text,
          images: inputImages,
          size: shape.size,
          maxRetries,
        });
      } else {
        const res = await generateImage({
          model: imageModel,
          // Object form carries edit/reference images; string form when there are none.
          prompt: inputImages.length ? { images: inputImages, text } : text,
          // Aspect vs size is per-model — see shapeArgs.
          ...shapeArgs(model, aspectRatio),
          maxRetries,
        });
        image = res.image;
        warnings = (res.warnings ?? []) as Array<Record<string, unknown>>;
      }

      // Surface provider warnings instead of letting them sink into SDK logs.
      // An ignored parameter is exactly the kind of silent wrong-output this
      // plugin exists to avoid.
      for (const w of warnings ?? []) {
        const detail = "details" in w && w.details ? ` — ${w.details}` : "";
        const feature = "feature" in w && w.feature ? ` "${w.feature}"` : "";
        console.warn(`WARN [${model.id}]${feature}${detail}`);
      }

      // Providers don't always return the format the filename implies —
      // seedream returns JPEG regardless of a .png output path. Name the file
      // after what it actually contains rather than shipping a mislabelled one.
      const actualPath = correctExtension(outPath, image.mediaType);
      writeFileSync(actualPath, image.uint8Array);
      if (actualPath !== outPath) {
        console.log(`Note: ${model.id} returned ${image.mediaType}; wrote ${actualPath}`);
      }
      console.log(`Generated: ${actualPath}`);
      results.push({ prompt: safePrompt, outputPath: actualPath, success: true });
    } catch (e) {
      const msg = (e as Error).message ?? "Unknown error";
      console.error(`ERROR: ${msg}`);
      results.push({
        prompt: safePrompt,
        success: false,
        errorCode: ErrorCode.API_ERROR,
        error: msg,
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return {
    success: failed === 0 && succeeded > 0,
    errorCode: failed === 0 ? ErrorCode.SUCCESS : ErrorCode.PARTIAL_FAILURE,
    results,
    total: prompts.length,
    succeeded,
    failed,
  };
}
