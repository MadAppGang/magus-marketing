/**
 * Provider-agnostic image routing via the Vercel AI SDK.
 *
 * The plugin talks to one interface (`generateImage` from `ai`); each provider
 * package supplies the model handle. Adding a provider means adding a case
 * here and an entry in models.ts — no changes to the generation pipeline.
 *
 * Verified against ai@7 / @ai-sdk/google@4 / @ai-sdk/openai@4 /
 * @openrouter/ai-sdk-provider@3:
 *   - `generateImage` is stable in v7 (it was `experimental_generateImage` in v5)
 *   - google.image("gemini-3.1-flash-image") routes via google.generative-ai,
 *     which is the correct endpoint for Gemini image-output models (NOT Imagen)
 *   - OpenRouter exposes `imageModel(...)`, not `.image(...)`
 */

import type { ImageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { apiKeyFor, type PinnedModel } from "./models.js";

export class MissingApiKeyError extends Error {
  constructor(public readonly envVar: string, public readonly modelLabel: string) {
    super(`${envVar} is not set — required for ${modelLabel}`);
    this.name = "MissingApiKeyError";
  }
}

/**
 * Build the AI SDK image-model handle for a pinned model.
 * Throws MissingApiKeyError if that provider's key is absent, so the CLI can
 * exit with a precise message instead of a provider-side 401.
 */
export function imageModelFor(model: PinnedModel): ImageModel {
  const apiKey = apiKeyFor(model);
  if (!apiKey) throw new MissingApiKeyError(model.apiKeyEnvs[0], model.label);

  switch (model.provider) {
    case "google":
      return createGoogleGenerativeAI({ apiKey }).image(model.routeId);
    case "openai":
      return createOpenAI({ apiKey }).image(model.routeId);
    case "openrouter":
      // OpenRouter's provider names this `imageModel`, not `image`.
      return createOpenRouter({ apiKey }).imageModel(model.routeId);
  }
}

/** Which pinned models are usable right now, given the keys in the environment. */
export function availableProviders(models: PinnedModel[]): {
  ready: PinnedModel[];
  missing: PinnedModel[];
} {
  const ready: PinnedModel[] = [];
  const missing: PinnedModel[] = [];
  for (const m of models) {
    (apiKeyFor(m) ? ready : missing).push(m);
  }
  return { ready, missing };
}
