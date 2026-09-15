/**
 * Pinned image-generation models.
 *
 * WHY THESE ARE HARDCODED (this is deliberate, do not "fix" it):
 *
 * Chat/coding models are resolved live from claudish's catalog, because they
 * change weekly and a stale ID silently routes to a dead model. Image models
 * are different: there are few of them, they change rarely, and each one needs
 * provider-specific wiring (endpoint shape, auth, output handling) that cannot
 * be inferred from a catalog entry. Resolving them dynamically would mean
 * routing to a model this plugin has never been tested against.
 *
 * So this set is pinned and updated *with the plugin*. To keep that from
 * rotting invisibly — the exact failure that killed the old shared alias
 * snapshot — `staleness.ts` checks them against the live image catalog in the
 * background and tells the user when something newer ships. It never switches
 * models on its own.
 *
 * There is exactly one ID per model and NO fallback chain. A fallback is where
 * staleness hides: the previous implementation carried `?? "gemini-2.0-flash-exp"`
 * on two paths and neither ever surfaced when the primary went dead.
 */

export type ProviderId = "google" | "openai" | "openrouter";

export interface PinnedModel {
  /** Canonical catalog model ID (matches models-index `modelId`). */
  readonly id: string;
  /** Provider-native route ID. Differs from `id` on OpenRouter. */
  readonly routeId: string;
  readonly provider: ProviderId;
  readonly label: string;
  /**
   * Env vars that may hold this provider's API key, canonical first.
   * Several names are in circulation for the same key (the AI SDK defaults to
   * GOOGLE_GENERATIVE_AI_API_KEY, Google's docs say GEMINI_API_KEY, and shared
   * .env files often use GOOGLE_GEMINI_API_KEY). Accept them all rather than
   * making people rename a working key.
   */
  readonly apiKeyEnvs: readonly [string, ...string[]];
  readonly maxResolution: string;
  /**
   * How this model expresses output shape.
   *   "aspect" — accepts `aspectRatio` ("16:9")
   *   "size"   — accepts `size` ("1536x1024") and IGNORES aspectRatio
   * Verified per provider: passing aspectRatio to a "size" model is silently
   * dropped with only a buried SDK warning, so the caller must translate.
   */
  readonly sizing: "aspect" | "size";
  /** Supported `size` values, widest-first. Only meaningful when sizing="size". */
  readonly sizes?: readonly string[];
  /**
   * Whether --edit / --ref (input images) work on this model.
   *
   * All pinned models currently support it. OpenAI only does so via the
   * direct-HTTP workaround in openai-edit.ts, because @ai-sdk/openai@4.0.20
   * appends edit images with no filename and /images/edits rejects them.
   * Set this false for any future model whose provider cannot take input images.
   */
  readonly supportsEdit: boolean;
  /**
   * Catalog release date of the pinned model (ISO). This is the baseline the
   * staleness check compares against — keep it in step when bumping a pin.
   */
  readonly releaseDate: string;
  readonly notes: string;
}

export const PINNED_MODELS: Record<string, PinnedModel> = {
  // ── Nano Banana family (Google) ───────────────────────────────────────────
  // Three tiers of one product line. Use Google's marketing names, not the
  // gemini-* API IDs: users ask for "nano banana pro", not "gemini-3-pro-image".
  // All three verified generate + edit before pinning (2026-07-28).
  "nano-banana-pro": {
    id: "gemini-3-pro-image",
    routeId: "gemini-3-pro-image",
    provider: "google",
    label: "Nano Banana Pro",
    apiKeyEnvs: ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    maxResolution: "4K",
    sizing: "aspect",
    supportsEdit: true,
    releaseDate: "2026-05-28",
    notes:
      "Studio-quality precision and control. Slowest and priciest of the " +
      "family — the one to reach for when the output is the deliverable. Default.",
  },
  "nano-banana": {
    id: "gemini-3.1-flash-image",
    routeId: "gemini-3.1-flash-image",
    provider: "google",
    label: "Nano Banana 2",
    apiKeyEnvs: ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    maxResolution: "4K",
    sizing: "aspect",
    supportsEdit: true,
    releaseDate: "2026-02-26",
    notes:
      "Pro-level generation and editing at Flash speed. Image search " +
      "grounding, 0.5K/1K/2K/4K output. The balanced middle tier.",
  },
  "nano-banana-lite": {
    id: "gemini-3.1-flash-lite-image",
    routeId: "gemini-3.1-flash-lite-image",
    provider: "google",
    label: "Nano Banana 2 Lite",
    apiKeyEnvs: ["GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    maxResolution: "2K",
    sizing: "aspect",
    supportsEdit: true,
    releaseDate: "2026-06-30",
    notes:
      "Fastest and cheapest of the family. For high-volume batches and " +
      "iteration where throughput matters more than fidelity.",
  },
  "gpt-image": {
    id: "gpt-image-2",
    routeId: "gpt-image-2",
    provider: "openai",
    label: "GPT Image 2",
    apiKeyEnvs: ["OPENAI_API_KEY"],
    maxResolution: "4K",
    // Verified 2026-07-28: rejects aspectRatio, accepts these sizes.
    sizing: "size",
    sizes: ["1536x1024", "1024x1024", "1024x1536"],
    // Works via the direct-HTTP workaround in openai-edit.ts.
    supportsEdit: true,
    releaseDate: "2026-04-21",
    notes: "OpenAI's image model. Strong text rendering and instruction following.",
  },
  seedream: {
    id: "seedream-4.5",
    // OpenRouter is the only route claudish reports for this model.
    routeId: "bytedance-seed/seedream-4.5",
    provider: "openrouter",
    label: "Seedream 4.5",
    apiKeyEnvs: ["OPENROUTER_API_KEY"],
    maxResolution: "2K",
    sizing: "aspect",
    // Verified working 2026-07-28 (OpenRouter is not multipart).
    supportsEdit: true,
    releaseDate: "2025-12-23",
    notes: "ByteDance Seedream via OpenRouter. Strong photographic realism.",
  },
};

/** Alias used when `--model` is omitted. */
export const DEFAULT_MODEL_KEY = "nano-banana-pro";

export function defaultModel(): PinnedModel {
  return PINNED_MODELS[DEFAULT_MODEL_KEY]!;
}

/**
 * Resolve a user-supplied `--model` value to a pinned model.
 *
 * Accepts the short alias ("seedream"), the canonical ID ("seedream-4.5") or
 * the provider route ID. Returns null for anything unknown — the caller must
 * report the supported set rather than guessing a near match. A near-string
 * match is how "kimi3" once resolved to kimi-k2.5.
 */
export function resolveModel(input: string): PinnedModel | null {
  const key = input.trim().toLowerCase();
  if (!key) return null;

  const direct = PINNED_MODELS[key];
  if (direct) return direct;

  for (const m of Object.values(PINNED_MODELS)) {
    if (m.id.toLowerCase() === key || m.routeId.toLowerCase() === key) return m;
  }
  return null;
}

export function listModels(): PinnedModel[] {
  return Object.values(PINNED_MODELS);
}

/** Alias keys, for help text and error messages. */
export function modelKeys(): string[] {
  return Object.keys(PINNED_MODELS);
}

/** First env var that actually holds a key for this model, or null. */
export function apiKeyEnvFor(model: PinnedModel): string | null {
  return model.apiKeyEnvs.find((name) => process.env[name]) ?? null;
}

/** The key value, or null when none of the accepted env vars are set. */
export function apiKeyFor(model: PinnedModel): string | null {
  const name = apiKeyEnvFor(model);
  return name ? (process.env[name] ?? null) : null;
}

/** Short alias for a model, for suggesting `--model <alias>` back to the user. */
export function aliasOf(model: PinnedModel): string {
  for (const [key, m] of Object.entries(PINNED_MODELS)) {
    if (m.id === model.id) return key;
  }
  return model.id;
}
