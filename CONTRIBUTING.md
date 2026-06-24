# Contributing to cloudrift

Thanks for your interest in contributing! This document covers everything you need to set up the project, make a change, and submit it.

By participating in this project you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License note

cloudrift is distributed under the [Apache License 2.0](./LICENSE.md). By submitting a contribution, you agree that it is licensed under the same terms as the rest of the project (see Section 5, "Submission of Contributions").

## Prerequisites

- **Node.js 18+**
- **pnpm** (`npm install -g pnpm`) — this is a pnpm workspace; do not use `npm`/`yarn`
- AWS credentials with read-only permissions if you want to run the CLI against a real account (see the [README](./README.md#required-iam-permissions))

## Getting set up

```sh
git clone https://github.com/elleVas/cloudrift.git
cd cloudrift
pnpm install
```

The repo is an [Nx](https://nx.dev) monorepo:

- `apps/cli` — the `@cloudrift/cli` command-line app
- `libs/cloud-cost/domain` — entities and waste policies (pure logic, no I/O)
- `libs/cloud-cost/application` — use cases / DTOs orchestrating the domain
- `libs/cloud-cost/infrastructure/aws-adapter` — AWS SDK scanners and pricing adapters
- `libs/shared/kernel` — `Result`, `Entity`, `ValueObject` base types shared across libs

Read [docs/en/architecture.md](./docs/en/architecture.md) before making structural changes — it explains the layering and why the domain has zero AWS imports.

## Everyday commands

Always go through Nx rather than calling the underlying tool directly:

```sh
pnpm nx run-many -t build        # build all projects
pnpm nx run-many -t test         # run all unit tests
pnpm nx run-many -t lint         # lint all projects
pnpm nx run-many -t typecheck    # typecheck all projects
pnpm nx affected -t test         # run only what your change actually affects
```

To target a single project: `pnpm nx test cloud-cost-domain`, `pnpm nx test cli`, etc.

CI (`.github/workflows/ci.yml`) runs lint, test, and build on every PR to `main`. A PR won't be merged if any of these fail.

## Making a change

1. **Open an issue first** for anything beyond a trivial fix (typo, doc clarification) — it avoids wasted work if the approach needs discussion.
2. Create a branch off `main`.
3. Make your change. Keep it focused: one logical change per PR.
4. Add or update tests. This project treats the test pyramid seriously — see [docs/en/testing.md](./docs/en/testing.md) for what belongs at the domain, infrastructure, and CLI e2e level. A scanner change with no spec update will be asked to add one.
5. Run `pnpm nx affected -t lint,test,typecheck` and make sure it's clean.
6. Commit with a clear message (imperative mood, e.g. `feat(cli): add --pdf artifact support`). Conventional-commit-style prefixes (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`) are appreciated but not enforced.
7. Open a pull request against `main`, describing what changed and why.

### Adding a new resource scanner

There's a dedicated walkthrough for this: [docs/en/adding-a-resource.md](./docs/en/adding-a-resource.md). It covers the entity → policy → scanner → DTO → formatter chain end to end.

### Code style

- No new abstractions beyond what the change needs — prefer duplication over a premature shared helper.
- The domain layer (`libs/cloud-cost/domain`) must never import an AWS SDK package. If you find yourself wanting to, the logic belongs in the infrastructure adapter instead.
- Comments explain *why*, not *what* — well-named identifiers should make the *what* obvious.
- `pnpm nx run-many -t lint` runs ESLint with the workspace's shared config; fix warnings on lines you touch, but you're not expected to clean up unrelated pre-existing warnings in the same PR.

## Reporting bugs

Open a [GitHub issue](https://github.com/elleVas/cloudrift/issues) with:

- the command you ran (flags included, credentials redacted)
- what you expected vs. what happened
- the cloudrift version (`cloudrift --version`) and Node version

For security vulnerabilities, do **not** open a public issue — see [SECURITY.md](./SECURITY.md).

## Questions

Open a [GitHub Discussion](https://github.com/elleVas/cloudrift/discussions) or issue, or email **raffaelevasini@gmail.com**.
