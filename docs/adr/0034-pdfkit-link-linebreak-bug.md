# ADR-0034: PDF links via pdfkit's `link` option, never combined with `lineBreak: false`

- **Status:** Accepted (2026-06-22)

## Context

The disclaimer/contact footer ([ADR-0005](0005-disclaimer-contact-in-application-layer.md)) needed genuinely clickable `mailto:`/LinkedIn links in the generated PDF, not just styled text.

## Decision

Use pdfkit's `link` option to add URI annotations, verified by inspecting the generated PDF directly. **Never combine `link` with `lineBreak: false`** on the same call — that combination crashes pdfkit with `unsupported number: NaN`, because the link-width calculation only happens in the line-wrapping code path that `lineBreak: false` disables.

## Alternatives Considered

- **Render link text as plain, non-clickable styled text with the URL spelled out.** Rejected: worse UX for a disclaimer/contact footer that's meant to be acted on directly from the PDF.

## Consequences

A documented landmine for any future pdfkit text/link code in this codebase: `lineBreak: false` and `link` must never be set together on the same `.text()` call.
</content>
