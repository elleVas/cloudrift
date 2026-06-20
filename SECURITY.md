# Security Policy

## Supported Versions

`@cloudrift/cli` has not yet been published to npm (see [docs/en/releasing.md](./docs/en/releasing.md)) — there is currently a single supported line: the latest commit on `main`. Once releases start shipping, only the most recent published major version will receive security fixes.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately by emailing **raffaelevasini@gmail.com** with:

- a description of the vulnerability and its potential impact
- steps to reproduce it (a minimal repro is very helpful)
- the cloudrift version / commit SHA you tested against

You should expect an initial response within **5 business days**. If the report is confirmed, a fix will be prioritized and a coordinated disclosure timeline agreed with you before any public details are shared. Credit is given to reporters who wish to be acknowledged, once a fix is released.

If you'd rather report through GitHub's private channel, you can also use [GitHub Security Advisories](https://github.com/elleVas/cloudrift/security/advisories/new) for this repository.

## Scope and Threat Model

cloudrift is a CLI tool that:

- reads **read-only** AWS API data (`Describe*`, `GetMetricStatistics`, `GetCallerIdentity`) via the AWS SDK, using whatever credentials are already configured in your environment (env vars, shared config/profile, instance/task role) — it never provisions, modifies, or deletes AWS resources, and never requests or stores credentials itself
- writes report artifacts (JSON/PDF) only to paths you explicitly pass via `--json`/`--pdf`
- makes outbound network calls only to AWS service endpoints (and, optionally, the AWS Pricing API with `--live-pricing`) — there is no telemetry, analytics, or other third-party network traffic

Vulnerability classes we're particularly interested in:

- a cloudrift bug that could cause AWS credentials, account IDs, or scan results to leak somewhere they shouldn't (logs, third-party network calls, written files outside the requested path)
- a dependency (npm package, including transitive ones) with a known exploitable vulnerability that's reachable from cloudrift's code paths
- command-injection, path-traversal, or arbitrary file write issues in CLI flag handling (e.g. `--json`, `--pdf`, `--config`)

Out of scope:

- vulnerabilities in AWS services themselves (report those to AWS Security)
- issues that require an attacker to already have write access to your AWS credentials or local filesystem
- the IAM permissions you grant to the credentials you run cloudrift with — that's on the user to scope to read-only, as documented in the [README](./README.md#required-iam-permissions)
