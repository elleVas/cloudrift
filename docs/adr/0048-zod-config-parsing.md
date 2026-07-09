# ADR-0048: Zod replaces the hand-written config parser

- **Status:** Accepted (2026-07-09)

## Context

`cloudrift.config.ts` parsed `cloudrift.config.json` with 308 lines of repeated `if (typeof obj.field !== '...') errors.push(...)` blocks, one per field, hand-aggregating errors and hand-maintaining the mapping between the parsed shape and the `CloudriftConfig` TypeScript interface. Correct, but every field followed an identical pattern with no shared abstraction, and the parser's correctness relative to `CloudriftConfig` depended entirely on the author keeping both in sync by hand — nothing would fail to compile if they drifted, since the parser built a plain object and cast it.

## Decision

A single declarative Zod schema, `CloudriftConfigSchema`, replaces the hand-written parser: `CloudriftConfigSchema.safeParse(obj)` does validation, type coercion, default values and error aggregation in one call. The schema is declared `satisfies z.ZodType<CloudriftConfig, unknown>` — if the schema's inferred shape and the public `CloudriftConfig` interface ever diverge, the project fails to compile rather than silently drifting apart.

```typescript
const CloudriftConfigSchema = z.object({
  excludeRegions: z.array(z.string()).optional(),
  minAgeDays: z.number().nonnegative().optional(),
  // …
}) satisfies z.ZodType<CloudriftConfig, unknown>;
```

## Alternatives Considered

- **Keep the hand-written parser, factor out the repeated `if`/push pattern into a small validation helper.** Rejected: reduces line count but keeps the fundamental gap — nothing ties the parser's shape to `CloudriftConfig` at compile time, so the two can still drift silently. A schema library closes that gap as a side effect of solving the verbosity problem, not as separate work.
- **`io-ts` or `yup`.** Rejected in favor of Zod: `io-ts`'s API (explicit codecs, `fp-ts` idioms) is heavier than needed for a flat config object; `yup` has weaker TypeScript type inference from the schema (the `satisfies z.ZodType<CloudriftConfig, unknown>` compile-time check depends on Zod's inference being accurate). Zod is also already a common enough dependency that it doesn't meaningfully add to the CLI's install footprint story.

## Consequences

`cloudrift.config.ts`: 308 → 151 lines. All 26 pre-existing config tests pass unchanged, including multi-error aggregation (Zod's `safeParse` collects every validation failure in one pass, matching the old parser's behavior of not stopping at the first bad field). Error messages improved as a side effect (Zod's default messages are more specific than the hand-written ones were in places). No runtime dependency concern: Zod has zero dependencies of its own and is small enough that its addition to `apps/cli/package.json` doesn't change the CLI's practical footprint.
