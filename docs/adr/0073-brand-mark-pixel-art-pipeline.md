# ADR-0073: Brand mark generated from the real logo via an offline pixel-art sampling pipeline

- **Status:** Accepted (2026-07-22)

## Context

The CLI's only visual identity was `ascii-banner.ts`, a large hand-drawn block-letter wordmark unrelated to the project's actual logo (`docs/assets/cloudrift.png`, a cloud + wave mark). With the interactive wizard ([ADR-0071](0071-unified-entry-wizard-bare-invocation.md)) introducing a first-time-user intro screen, and `analyze`'s own banner needing to stay visually consistent with it, the ask was for one shared brand mark, sampled from the real logo rather than redrawn by hand.

## Decision

`renderCell()`/`renderBrandMark()` (`apps/cli/src/brand-mark.ts`) render a small pixel-art icon from **precomputed data** (`brand-mark-icon-data.ts`, a grid of `PixelArtCell { top, bottom }` hex-color pairs), generated offline by `scripts/generate-brand-mark-icon.mjs` from `docs/assets/cloudrift.png` and committed as a plain TypeScript data file — the CLI itself never processes the source image at runtime. `renderBrandMark()` is called by both the wizard's intro and `analyze`'s banner, replacing `ascii-banner.ts` (deleted) as the one shared piece of chrome instead of each command owning a separate ASCII scene.

**Generation pipeline** (`generate-brand-mark-icon.mjs`, using `jimp`, a new **devDependency** — never imported by CLI runtime code, never shipped in the published bundle):

1. `image.posterize(6)` — the source PNG has anti-aliased/blended edges between color bands with no clean low-resolution grid to recover by resizing alone (verified: scanning rows for runs of identical pixel color came back almost entirely run-length 1). Posterizing snaps every band to a handful of flat, distinct colors *before* resizing, which is what fixed legibility — tried first at two smaller target sizes (22×11, 30×15) with the same blur, confirming the source blending, not the target resolution, was the actual problem.
2. `image.resize({ w, h })` with `mode` deliberately left `undefined`. Passing any explicit mode — including `bilinearInterpolation`, jimp's own documented default — routes through a visibly noisier code path (verified by diffing outputs side by side); this is an empirical, undocumented finding, not something to "correct" back to an explicit default without re-verifying it looks better.
3. Each terminal character packs **two source pixel rows** via the half-block technique (foreground color = top pixel, background color = bottom pixel, glyph `▀`), doubling vertical resolution versus one flat-colored block per cell.
4. Alpha below a threshold (128) maps to `null` (transparent) rather than a forced background color, so the icon's corners show the terminal's actual background/theme instead of masking it with the source image's own fill.

Final resolution: 40×20 characters (80×40 sampled source pixels). A parallel attempt to pixel-art the **wordmark** itself from a second, stencil-style asset (`title-cloudrift.png`) was tried and abandoned — thin outlined letterforms don't survive the downscale even with dilation, illegible at compact sizes. The title stays a plain styled terminal string (tracked spacing, a color pulled from the icon's own wave palette) rather than a pixel-art render; `generate-brand-mark-title.mjs` is kept for future reuse if a filled (non-outlined) letters asset becomes available.

## Alternatives Considered

- **Runtime image processing (load/sample the PNG when the CLI starts).** Rejected: pulls `jimp` (and PNG decoding) into the shipped runtime bundle for a static, unchanging asset — pure cost with no benefit over precomputing once and committing plain data.
- **Keep the hand-drawn ASCII banner.** Rejected: unrelated to the actual cloudrift logo, and the ask was specifically for the brand mark to be recognizably *the* logo, not a generic terminal art scene.
- **A solid filled background behind the icon+text block.** Tried and rejected: read as a heavy flat rectangle, especially over text rows with blank space, rather than a logo. A thin violet→cyan gradient border framing icon and text together reads as one unit while staying light.

## Consequences

`jimp` is a new devDependency of `generate-brand-mark-icon.mjs` and `generate-brand-mark-title.mjs`, with zero runtime footprint — neither script's output is anything more than a committed data file. A third, `jimp`-free script, `generate-pdf-logo-data.mjs`, separately base64-embeds the same source PNG verbatim (no pixel sampling) into `pdf-logo-data.ts` for the PDF masthead's embedded logo ([ADR-0072](0072-pdf-shared-layout-module.md)) — a plain file read, since the PDF wants the full-resolution image, not a downsampled terminal rendition. Regenerating the brand mark after a logo change is a manual, explicit step (`node scripts/generate-brand-mark-icon.mjs`), not automatic — `docs/assets/cloudrift.png` and `brand-mark-icon-data.ts` can drift if one is updated without re-running the script.
