#!/usr/bin/env bun
/**
 * image-generate — provider-agnostic AI image generation.
 *
 * Usage:
 *   image-generate output.png "prompt"
 *   image-generate output.png "prompt1" "prompt2" --style styles/glass.md
 *   image-generate output.png "edit instruction" --edit input.png
 *   image-generate output.png "prompt" --ref reference.png --aspect 16:9
 *   image-generate output.png "prompt" --model seedream
 *   image-generate --models
 */

import { generate, ErrorCode, ASPECT_RATIOS } from "./generate.js";
import { resolveModel, defaultModel, listModels, modelKeys, aliasOf, apiKeyEnvFor } from "./models.js";
import { availableProviders } from "./providers.js";
import { checkStaleness, formatReport } from "./staleness.js";

function printHelp(): void {
  console.log(`
image-generate — AI image generation across providers

USAGE
  image-generate <output> <prompt...> [options]
  image-generate --models

OPTIONS
  --style <file>       Markdown style file prepended to every prompt
  --edit <image>       Source image to edit
  --ref <image>        Reference image (repeatable)
  --aspect <ratio>     ${ASPECT_RATIOS.join(", ")}
  --model <name>       ${modelKeys().join(" | ")}  (default: ${defaultModel().id})
  --max-retries <n>    Retry attempts on transient errors (default: 3)
  --no-check           Skip the background model-freshness check
  -h, --help           Show this help

Multiple prompts write numbered files: out_001.png, out_002.png, …
`);
}

/**
 * `--models` is an inventory, not a health check — it must never read as an
 * error. Key state is shown per model as neutral availability, with no summary
 * warning footer.
 */
function printModels(): void {
  const { ready } = availableProviders(listModels());
  console.log("\nPinned image models\n");
  for (const m of listModels()) {
    const ok = ready.includes(m);
    const shape = m.sizing === "size" ? (m.sizes?.join(", ") ?? "sizes") : "any aspect ratio";
    console.log(`  ${ok ? "✓" : "·"} ${aliasOf(m).padEnd(12)} ${m.id}`);
    console.log(`      ${m.label} · ${m.provider} · up to ${m.maxResolution} · ${shape}`);
    console.log(`      ${m.notes}`);
    console.log(
      ok
        ? `      ready (${apiKeyEnvFor(m)} set)`
        : `      set ${m.apiKeyEnvs[0]} to enable`
    );
    console.log();
  }
  console.log(
    "Pinned deliberately and updated with the plugin — see CLAUDE.md,\n" +
      '"Image Model Pinning". Freshness is checked in the background, advisory only.\n'
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (args.includes("--models")) {
    printModels();
    process.exit(0);
  }

  const options = {
    style: null as string | null,
    edit: null as string | null,
    ref: [] as string[],
    aspect: "1:1",
    model: defaultModel(),
    maxRetries: 3,
    check: true,
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--style" && args[i + 1]) options.style = args[++i]!;
    else if (arg === "--edit" && args[i + 1]) options.edit = args[++i]!;
    else if (arg === "--ref" && args[i + 1]) options.ref.push(args[++i]!);
    else if (arg === "--no-check") options.check = false;
    else if (arg === "--aspect" && args[i + 1]) {
      options.aspect = args[++i]!;
      if (!ASPECT_RATIOS.includes(options.aspect)) {
        console.error(`ERROR: Invalid aspect ratio. Valid: ${ASPECT_RATIOS.join(", ")}`);
        process.exit(2);
      }
    } else if (arg === "--model" && args[i + 1]) {
      const requested = args[++i]!;
      const resolved = resolveModel(requested);
      if (!resolved) {
        // Never near-match a model name. Report the supported set instead.
        console.error(
          `ERROR: Unknown model "${requested}".\n` +
            `Supported: ${modelKeys().join(", ")}\n` +
            `(or a full ID: ${listModels().map((m) => m.id).join(", ")})`
        );
        process.exit(2);
      }
      options.model = resolved;
    } else if (arg === "--max-retries" && args[i + 1]) {
      options.maxRetries = parseInt(args[++i]!, 10);
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  if (positional.length < 2) {
    console.error("ERROR: Requires an output path and at least one prompt");
    printHelp();
    process.exit(2);
  }

  const [outputPath, ...prompts] = positional as [string, ...string[]];

  // Fail fast rather than spending an API round-trip on a provider error the
  // registry already knows about.
  if ((options.edit || options.ref.length) && !options.model.supportsEdit) {
    const alt = listModels().filter((m) => m.supportsEdit).map((m) => aliasOf(m));
    console.error(
      `ERROR: --edit/--ref is not supported on ${options.model.label} (${options.model.id}).\n` +
        `Models that support input images: ${alt.join(", ")}`
    );
    process.exit(2);
  }

  // Advisory freshness check runs concurrently with generation so it never
  // adds latency. Failures are silent by design.
  const stalenessPromise = options.check
    ? checkStaleness().catch(() => null)
    : Promise.resolve(null);

  const result = await generate({
    prompts,
    outputPath,
    model: options.model,
    stylePath: options.style,
    editPath: options.edit,
    refPaths: options.ref,
    aspectRatio: options.aspect,
    maxRetries: options.maxRetries,
  });

  if (result.errorCode === ErrorCode.API_KEY_MISSING) {
    console.error(
      `ERROR: no API key found for ${options.model.label}.\n` +
        `  Set one of: ${options.model.apiKeyEnvs.join(", ")}`
    );
    // Name the models that WOULD work right now. No automatic fallback — the
    // user chooses — but a bare "key missing" while two providers sit ready is
    // an unhelpful dead end.
    const { ready } = availableProviders(listModels());
    const usable = ready.filter((m) => m.id !== options.model.id);
    if (usable.length) {
      console.error(
        `\nUsable with the keys you have: ${usable.map((m) => `--model ${aliasOf(m)}`).join("  ")}`
      );
    }
    process.exit(2);
  }

  console.log(`\nCompleted: ${result.succeeded}/${result.total} images`);
  if (result.failed > 0) {
    console.log("\nFailed images:");
    for (const r of result.results) {
      if (!r.success) console.log(`  - ${r.prompt || "Unknown"}: ${r.error ?? "Unknown error"}`);
    }
  }

  const advisory = formatReport(await stalenessPromise);
  if (advisory) console.log(advisory);

  process.exit(result.success ? 0 : 1);
}

main().catch((e: Error) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});
