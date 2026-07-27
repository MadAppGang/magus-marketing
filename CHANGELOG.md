# Changelog

> Filtered view. This lists only the plugins published to the `magus-marketing` marketplace.
> The complete history across every plugin and channel lives in `CHANGELOG.md` at
> [MadAppGang/magus-src](https://github.com/MadAppGang/magus-src).

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
