# ADR-0028: ts-jest for tests

- **Status:** Accepted

## Context

Tests are written in `.spec.ts` and need to run without a separate compile step.

## Decision

`ts-jest` as the transformer, with `diagnostics: false` in the preset (type-checking is already covered by the separate `typecheck` Nx target, so disabling it here keeps tests fast). Jest configs stay `jest.config.cjs`, not `.ts`.

## Alternatives Considered

- **`ts-node` with `.ts` jest configs.** Rejected: `ts-node` isn't installed and would be an extra dependency added purely to load config files.
- **`@swc/jest` or Babel for faster transforms.** Not adopted: no concrete performance problem observed that would justify the swap; `ts-jest` integrates simply with the workspace's existing `moduleNameMapper`.

## Consequences

Test runs don't re-typecheck, relying on the separate `typecheck` target for type safety. Converting jest configs to `.ts` would require adding `ts-node` as a new dependency.
