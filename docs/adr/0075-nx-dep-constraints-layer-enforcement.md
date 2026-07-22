# ADR-0075: Nx `depConstraints` enforce the hexagonal layering at lint time

- **Status:** Accepted (2026-07-22)

## Context

`eslint.config.mjs` already ran `@nx/enforce-module-boundaries`, but with `depConstraints: [{ sourceTag: '*', onlyDependOnLibsWithTags: ['*'] }]` — a wildcard that accepts any import from any project. No project had an `nx.tags` entry either. An external review (`docs/todo/code-review-2026-07-22.md`) flagged this as the boundary being real only by convention: nothing stopped `cloud-cost-domain` from importing `cloud-cost-infrastructure-aws-adapter` directly, which would silently defeat the entire hexagonal design ([ADR-0013](0013-ddd-hexagonal-plugin-model.md), [ADR-0016](0016-waste-rules-in-domain.md)) — a mistake would only be caught by a human noticing it in review, not by any tool.

## Decision

Tagged the five projects to match the hexagonal layers already documented in `docs/en/architecture.md`'s layer diagram:

| Project | Tag |
|---|---|
| `shared-kernel` | `scope:shared` |
| `cloud-cost-domain` | `scope:domain` |
| `cloud-cost-application` | `scope:application` |
| `cloud-cost-infrastructure-aws-adapter` | `scope:infrastructure` |
| `cli` | `scope:app` |

Tags live in each project's `package.json` under `nx.tags` (the same file already carrying each project's `nx.targets`), not a separate `project.json` — none of the libs had one, and adding a parallel config file per project just to hold one array wasn't worth it.

Replaced the wildcard `depConstraints` with one rule per layer:

```js
depConstraints: [
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:domain', onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain'] },
  { sourceTag: 'scope:application', onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain', 'scope:application'] },
  { sourceTag: 'scope:infrastructure', onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain', 'scope:infrastructure'] },
  { sourceTag: 'scope:app', onlyDependOnLibsWithTags: ['scope:shared', 'scope:domain', 'scope:application', 'scope:infrastructure', 'scope:app'] },
],
```

`scope:infrastructure` is deliberately not allowed to depend on `scope:application` — adapters implement domain ports (`WasteScannerPort`, `PricingPort`) directly; the application layer only orchestrates them from the composition root, it is never itself a dependency of an adapter. This matches the dependency graph every `package.json` already declared (verified before writing the rule, not assumed).

## Alternatives Considered

- **Leave the wildcard, rely on review discipline.** Rejected: this is exactly the status quo the review flagged as the problem — a lint rule that exists but enforces nothing gives false confidence.
- **A `project.json` per lib carrying the tag**, matching the Nx-generated default for new libs. Rejected: none of the five projects currently has one (tags and everything else already live in `package.json`); introducing the parallel file just for a one-line array adds a second place to look without a corresponding benefit.

## Consequences

Verified in three steps: (1) `pnpm nx run-many --target=lint --all` passed clean with the new rules — the real dependency graph already matched the intended layering exactly, so no existing import needed to change; (2) a throwaway illegal import (`cloud-cost-domain` importing from `cloud-cost-infrastructure-aws-adapter`) was added and confirmed to fail `@nx/enforce-module-boundaries` with a hard error, then reverted — proving the rule is live, not a no-op; (3) full `lint`/`test`/`build` across all five projects stayed green. Since `ci.yml`'s `lint` job runs on every push/PR to `main` and `build` depends on it, any future PR crossing a layer boundary the wrong way now fails CI, not just local review.
