# Changelog

> Filtered view. This lists only the plugins published to the `magus-marketing` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

## [seo 2.1.0] - 2026-08-24

### Fixed

- **`/seo:alternatives` offered a model claudish cannot serve.** The picker listed
  `claude-embedded`, and what the user picks goes straight into the `team` call's
  `models` array with no filtering step. claudish accepts exactly five native names —
  `internal`, `default`, `opus`, `sonnet`, `haiku` — and forwards anything else to the
  Anthropic API verbatim, which answers 404 for an invented one. Now offers `internal`.
  Native names only became runnable slots in claudish 7.65.0, so before that there was
  nothing correct to offer here, which is presumably where the invented name came from.

- **Every model was recorded as a success, whatever actually happened.** Both commands
  called `track_model_performance "$model" "success" ...` with the status hardcoded. A
  slot that 404'd, timed out, or returned nothing was written into
  `ai-docs/llm-performance.json` as a fast, free, zero-issue model — and that file feeds
  the "Top Performers" list shown at the next run's model selection. The silent failure
  was promoting itself. Now passes the slot's real status from the team response.

- **Nothing checked that the embedded review had been written.** `/seo:review`
  dispatches `seo:editor` as an `Agent` that returns a brief summary and persists the
  real review to `reviews/claude-review.md` — so the returned message proves nothing
  about the file. An agent that answered without writing left an absent or stub file,
  which consolidation reads as a clean review: no issues found, so none reported. A new
  step verifies the file landed and is not a stub before consolidating.

  It stays an `Agent` rather than moving into the `team` call, unlike the multimodel
  fix — though not for the reason first supposed. `--agent` does **not** drag an agent's
  pinned model onto the session. Measured 2026-08-24 with a probe agent declaring
  `model: haiku`: `claude --model sonnet --agent <it>` reported `init.model =
  claude-sonnet-5` and billed only sonnet, while still applying the agent's tool
  allowlist (`init.tools = ['Read']`). The real reason is that allowlist. `agent`
  applies to EVERY slot in a run, and `seo:editor` grants only `Read, Write, Glob,
  Grep` — migrating would strip Bash and WebSearch from every external reviewer, a
  behaviour change buying nothing, since the artifact check above already closes the
  defect.

- **`ISSUES` was counted from a path the previous step never wrote.** The count read
  `${model}-review.md` while the step above wrote `{model_slug}-review.md`. Those differ
  for any id containing `/` or `@`, and the mismatch fell straight into the `|| echo 0`
  branch — a clean review reported for a file that was never opened.

### Added

- **`min_output_bytes=400` on both `team` calls.** These prompts mandate topics but no
  machine-checkable format, so `require_pattern` has nothing to match. 400 bytes is a
  deliberate floor rather than a quality bar: far below any genuine review or generated
  draft, so it catches only a slot that returned nothing or a stub. Requires
  claudish >= 7.65.0.

- The `<parallel_execution_requirement>` example in each command now carries the same
  shape check as the real call below it. An example that omits it is where the omission
  gets copied from.

---

## [magus-marketing 2.0.2] - 2026-08-19

### Changed

- Channel version aligned with Marketplace 9.3.1: carries `claudish` v1.0.1, the
  runtime dependency dual-published here for `seo`. No other marketing plugin changed.

---

## [magus-marketing 2.0.1] - 2026-08-19

### Changed

- Channel version aligned with the Marketplace 9.3.0 dispatch-integrity release it
  carries: `seo` v2.0.1, `video-editing` v1.2.1, `instantly` v2.0.1. No content beyond
  9.3.0; this bump exists because the channel number previously stayed at 2.0.0 while
  its plugins moved, and the publish pipeline is now exercised end-to-end from CI.

---

## [image-generate 3.0.0] - 2026-07-29

### Added
- **Provider-agnostic routing** on the Vercel AI SDK (`ai` v7). Five pinned models across three providers behind one interface: **Nano Banana Pro** (default), **Nano Banana 2**, **Nano Banana 2 Lite**, **GPT Image 2**, **Seedream 4.5**. Adding a provider is one case in `src/providers.ts` plus one entry in `src/models.ts` — the generation pipeline is untouched.
- **Background staleness advisory** (`src/staleness.ts`). Compares the pins against the live image catalog (`queryModels?catalog=image`, 24h cache) and reports when something newer ships. Advisory only: it never switches models, never blocks generation, and **fails closed** — it verifies the response identifies itself as `catalog: "image"`, because an undeployed endpoint falls through to a generic chat-model list.
- **`--models`** inventory showing each pin, its tier, sizing capability, and which API key was found.
- Multiple accepted env var names per provider (`GEMINI_API_KEY`, `GOOGLE_GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`) so an already-working key needs no renaming.

### Changed
- **Renamed from `nanobanana`.** Breaking: `nanobanana@magus` in `enabledPlugins` must become `image-generate@magus`. claudeup surfaces the old entry as deprecated with a cleanup action.
- Rewritten from JavaScript to TypeScript; `main.js` replaced by `src/`. Retry/backoff delegated to the AI SDK instead of hand-rolled.
- `skills/gemini-api` → `skills/image-providers` (it is no longer Google-only).

### Fixed
- **`--aspect` was silently ignored on `gpt-image-2`** — that model takes `size`, not `aspectRatio`, and the SDK dropped the parameter with only a buried warning. You asked for 16:9 and got a square. Now translated per-model via a `sizing` capability.
- **`--edit` / `--ref` failed on `gpt-image-2`.** Root cause proven experimentally: `@ai-sdk/openai@4.0.20` wraps edit images in a `Blob` and `convertToFormData` appends it with no filename, so `/images/edits` rejects it. Identical bytes succeed the moment a filename is attached. Worked around with a direct `/images/edits` call (`src/openai-edit.ts`), scoped to that one case and documented for deletion once the SDK is fixed.
- **Output files were mislabelled.** All three providers can return JPEG regardless of a `.png` output path. The extension now follows the actual bytes, with a note.
- **Dead fallback models removed.** The previous code carried `?? "gemini-2.0-flash-exp"` on two paths; neither surfaced when the primary died. There is now exactly one ID per model and no fallback chain.
- An unknown `--model` is an error listing the supported set — never a near match (`seedream5pro` must not resolve to `seedream`).

### Why
The plugin's image model had gone stale invisibly. Pinning is still correct for image models — there are few of them, each needs provider-specific wiring, and a wrong ID routes to an *untested* model rather than an obvious error — but pinning is only safe while staleness stays detectable. Hence the advisory, and hence no fallbacks. See CLAUDE.md → "Image Model Pinning".

---

## [instantly 1.0.7] - 2026-07-29

### Changed
- Pointers to the deleted `shared/model-aliases.json` replaced with live-catalog resolution, and concrete model IDs in illustrative examples replaced with placeholders. Behaviour is otherwise unchanged; a patch release so claudeup actually ships the updated guidance.

---

## [seo 1.8.1] - 2026-07-29

### Changed
- Pointers to the deleted `shared/model-aliases.json` replaced with live-catalog resolution, and concrete model IDs in illustrative examples replaced with placeholders. Behaviour is otherwise unchanged; a patch release so claudeup actually ships the updated guidance.
> **This file is the source of truth.** It covers every plugin across every distribution
> channel, plus internal tooling. Each dist repo receives a sanitised, channel-scoped copy
> generated by `scripts/filter-changelog.ts` during `publish-dist.sh`.
>
> Heading convention drives that filter: `## [<Plugin> X.Y.Z] - <date>` for plugin releases,
> and `## [<channel> X.Y.Z] - <date>` (`Marketplace`, `magus-marketing`, `magus-alpha`) for
> channel-wide entries. A heading the filter cannot attribute is dropped from every dist copy.

---

## [magus-marketing 1.0.0] - 2026-07-27

### Added

- First release of the `magus-marketing` marketplace
  ([MadAppGang/magus-marketing](https://github.com/MadAppGang/magus-marketing)), carrying the
  marketing and content plugins previously published on `magus`:

  | Plugin | Version | Purpose |
  |---|---|---|
  | `seo` | 1.8.0 | SEO analysis and optimization with AUTO GATEs |
  | `nanobanana` | 2.4.0 | AI image generation with Gemini 3 Pro Image |
  | `video-editing` | 1.1.4 | FFmpeg, Whisper, Final Cut Pro integration |
  | `instantly` | 1.0.6 | Cold email outreach via the Instantly.ai MCP |
  | `claudish` | 1.0.0 | MCP runtime; dual-published because `seo` depends on it |

- Install with `/plugin marketplace add MadAppGang/magus-marketing`, then enable plugins as
  `<name>@magus-marketing`.

### Why

Keeping marketing tooling in the core development marketplace made `magus` noisier for the
developers who are its main audience, and coupled unrelated release cadences. Plugin source
still lives in one repo (`magus-src`); only distribution is split.

---

## [video-editing 1.1.4] - 2026-05-07

### Fixed
- Skill and agent descriptions rewritten to Anthropic's pattern, with the trailing
  trigger-keyword lists stripped.
