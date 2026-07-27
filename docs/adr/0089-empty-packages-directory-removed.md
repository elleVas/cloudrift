# ADR-0089: Empty `packages/` directory removed

- **Status:** Accepted (2026-07-27)

## Context

The repo carried a `packages/` directory containing only a `.gitkeep`, wired into `pnpm-workspace.yaml`'s `'packages/*'` glob. It predated the current `apps/`/`libs/` Nx layout and had never held anything. An external code review (`docs/todo/todo.md`, item 7) flagged it: a reviewer sees an empty top-level directory and reads it as an abandoned or unfinished piece of the project, not as intentional structure.

## Decision

Delete `packages/` and its `.gitkeep`, and remove the now-pointless `'packages/*'` entry from `pnpm-workspace.yaml`. Every real package in this repo already lives under `apps/` (the CLI) or `libs/` (the four bounded contexts plus `shared/`); nothing referenced `packages/*`.

## Alternatives Considered

- **Repurpose it for a publishable `@cloudrift/sdk`.** Rejected for now: no such package exists or is planned. Reintroducing a `packages/` root (or any new top-level workspace root) can happen later, driven by an actual package that needs it, rather than kept empty on the chance one might.

## Consequences

One less structural question for a new contributor or reviewer to puzzle over. If a genuine reason to add a new workspace root ever comes up (e.g. a publishable SDK distinct from `apps/cli` and the internal `libs/`), it gets created then, with real contents from the start.
