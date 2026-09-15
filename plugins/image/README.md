# image

Provider-agnostic AI image generation and editing for Claude Code. One CLI over a pinned
registry of Google, OpenAI and ByteDance image models; three commands; no subagents.

**Category:** media · **License:** MIT · **Channel:** `magus-marketing`

## What it does

- **Text-to-image** on any pinned model, with per-model sizing handled for you
- **Image editing** with a natural-language instruction, optionally guided by reference images
- **Style templates**: markdown files in `styles/` prepended to every prompt
- **Batch generation**: several prompts in one call, numbered outputs
- **Freshness advisory**: a background check tells you when a pinned model has a newer
  release; it never switches models on its own

The models are pinned deliberately and updated with the plugin. Run `--models` for the
current set; nothing in these docs restates a model ID.

## Installation

1. Add the marketplace and enable the plugin in `.claude/settings.json`:
   ```json
   {
     "enabledPlugins": {
       "image@magus-marketing": true
     }
   }
   ```
2. Install dependencies once:
   ```bash
   cd plugins/image && bun install
   ```
3. Set the API key for the provider of the model you want. `--models` names the
   variable each model accepts and shows which ones are ready:
   ```bash
   bun plugins/image/src/main.ts --models
   ```

## Commands

| Command | Does |
|---|---|
| `/image:generate "prompt" [...] [--style name] [--aspect r] [--ref img] [--model alias]` | Generate one image per prompt |
| `/image:edit <image> "instruction" [--ref img] [--model alias]` | Edit an existing image |
| `/image:style <create\|list\|show\|update\|delete> [name]` | Manage style templates; delete and overwrite ask first |

Each command validates its inputs, checks the chosen model reads `ready` in `--models`,
runs `src/main.ts` once, and reports the files produced and any failures.

## Quick start

```bash
/image:generate "A minimal 3D cube on black background"
/image:style create glass            # then describe the look when asked
/image:generate "gear icon" --style glass
/image:generate "cube" "sphere" "pyramid" --style glass --aspect 1:1
/image:edit photo.jpg "Make the sky more dramatic"
/image:generate "Same style, new subject" --ref generated/gear_icon.png
```

## Direct CLI

```bash
bun plugins/image/src/main.ts output.png "A minimal 3D cube"
bun plugins/image/src/main.ts out.png "gear" --style styles/glass.md --model seedream
bun plugins/image/src/main.ts out.png "cube" "sphere" "pyramid"          # out_001.png …
bun plugins/image/src/main.ts edited.png "Make sky blue" --edit photo.jpg
bun plugins/image/src/main.ts out.png "prompt" --ref style.png --aspect 16:9
bun plugins/image/src/main.ts --models
bun plugins/image/src/main.ts --help
```

Flags: `--style`, `--edit`, `--ref` (repeatable), `--aspect`, `--model`, `--max-retries`,
`--no-check`. An unknown `--model` is an error that lists the supported set; it never
resolves to a near match.

## Styles

A style is one markdown file under `styles/`. Its whole content is prepended to the
prompt. Format and an example live in `skills/style-format/SKILL.md`. Style files are
scanned for shell patterns before they are written.

## Errors

| Code | Meaning | Recovery |
|---|---|---|
| `API_KEY_MISSING` | The chosen model's key is unset | Export the variable the CLI names; it also lists models that are ready now |
| `FILE_NOT_FOUND` | Style, edit source or reference is missing | Check the path |
| `INVALID_INPUT` | Empty or over-long prompt | Fix the prompt |
| `API_ERROR` | Provider rejected the request | Read the message; content policy is the usual cause |
| `PARTIAL_FAILURE` | Some batch items failed | The CLI lists them; retry only those |

Transient failures (rate limits, 5xx, timeouts) retry with exponential backoff; tune with
`--max-retries`.

## Development

Bun and TypeScript only. `bun run typecheck` in `plugins/image` runs `tsc --noEmit`
(the repo-level `bun scripts/check-types.ts` covers it as well). Model pinning rules and
the staleness mechanism are documented in the root `CLAUDE.md` under "Image Model Pinning".
