---
name: image-providers
description: Reference for generating images across Google, OpenAI and ByteDance through one CLI. Use when generating or editing images, picking an image model, or resolving image API key and provider errors.
user-invocable: false
plugin: image-generate
updated: 2026-07-28
---

# Image Providers Reference

One interface, five pinned models across three providers. The CLI routes to the right API based on
`--model`; you never call a provider SDK directly.

## Quick Start

```bash
bun src/main.ts output.png "A minimal 3D cube"
bun src/main.ts output.png "A minimal 3D cube" --model seedream
bun src/main.ts --models        # what is pinned, and which keys are present
```

## Models

**Do not hardcode model IDs into prompts, docs, or commands.** Run `--models`
for the current pins — that command reads the registry directly, so it cannot
drift. The aliases below are stable; the IDs behind them change with the plugin.

| Alias | Model | Tier | API key (any of) |
|-------|-------|------|------------------|
| `nano-banana-pro` | Nano Banana Pro | studio quality (default) | `GEMINI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` |
| `nano-banana` | Nano Banana 2 | pro-level at Flash speed | same as above |
| `nano-banana-lite` | Nano Banana 2 Lite | fastest / cheapest | same as above |
| `gpt-image` | GPT Image 2 | OpenAI | `OPENAI_API_KEY` |
| `seedream` | Seedream 4.5 | ByteDance via OpenRouter | `OPENROUTER_API_KEY` |

All five support `--edit` / `--ref`.

`nano-banana-pro` is the default. Only the provider whose model you request needs a
key, and several names for the same key are accepted — the CLI reports which
ones it looked for. `--models` shows what is ready right now.

An unknown `--model` is an **error**, never a near match. `seedream5pro` will
not silently resolve to `seedream`; the CLI lists the supported set instead.

### Input images on `gpt-image` use a direct-HTTP workaround

`@ai-sdk/openai` wraps edit images in a `Blob` (no filename) and the multipart
helper appends it without one, so `/images/edits` rejects the request. Verified
experimentally: identical bytes succeed the moment a filename is attached. The
plugin therefore calls `/images/edits` directly for this one case
(`src/openai-edit.ts`); everything else goes through the AI SDK. Delete that
module once the SDK passes a filename.

### Output format

Providers return what they return: Gemini and Seedream both emit JPEG even when
the output path ends in `.png`. The CLI writes the file with the extension that
matches the actual bytes and prints a note, rather than producing a mislabelled
file.

## Model pinning and freshness

These models are pinned deliberately and updated with the plugin — see
CLAUDE.md → "Image model pinning" for the reasoning. A background check
compares the pins against the live image catalog and prints an advisory when
something newer ships. It is advisory only: it never switches models, never
blocks generation, and stays silent when it cannot reach the catalog. Disable
it with `--no-check`.

## Aspect Ratios

| Ratio | Use Case |
|-------|----------|
| 1:1 | Social media, icons |
| 3:4 | Portrait photos |
| 4:3 | Traditional photos |
| 4:5 | Instagram portrait |
| 5:4 | Landscape photos |
| 9:16 | Mobile, stories |
| 16:9 | YouTube, desktop |
| 21:9 | Cinematic, ultrawide |
| 1:4, 4:1, 1:8, 8:1 | Banners and strips (Nano Banana 2) |

## CLI Flags

| Flag | Description | Example |
|------|-------------|---------|
| `--style` | Apply style template | `--style styles/glass.md` |
| `--edit` | Edit an existing image | `--edit photo.jpg` |
| `--ref` | Reference image (repeatable) | `--ref style.png` |
| `--aspect` | Aspect ratio | `--aspect 16:9` |
| `--model` | Model alias | `--model seedream` |
| `--max-retries` | Retry attempts | `--max-retries 5` |
| `--no-check` | Skip the freshness advisory | |
| `--models` | List pinned models and key status | |

Multiple prompts produce numbered files: `out_001.png`, `out_002.png`, …

## Error Codes

| Code | Meaning | Recovery |
|------|---------|----------|
| `SUCCESS` | Operation completed | — |
| `API_KEY_MISSING` | That provider's key is unset | Export the key named in the error |
| `FILE_NOT_FOUND` | Style/edit/ref file missing | Check the path |
| `INVALID_INPUT` | Empty or over-long prompt | Fix the prompt |
| `API_ERROR` | Provider rejected the request | Read the message; check content policy |
| `PARTIAL_FAILURE` | Some batch items failed | Inspect individual results |

## Retry Behaviour

Retries are handled by the AI SDK with exponential backoff on transient
failures (rate limits, 5xx, timeouts). Default 3, tune with `--max-retries`.

## Best Practices

1. **Prompts** — be specific about style, lighting, composition
2. **Styles** — use markdown templates for consistency across a batch
3. **References** — supply visual examples instead of describing a style
4. **Batch** — generate variations in one call, then pick
5. **Model choice** — `nano-banana-pro` when the image is the deliverable,
   `nano-banana` for the balanced middle, `nano-banana-lite` for high-volume
   batches, `gpt-image` for text rendering, `seedream` for photographic realism
