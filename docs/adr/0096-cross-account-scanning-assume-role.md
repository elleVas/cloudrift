# ADR-0096: Cross-account scanning via `--assume-role-arn` (STS AssumeRole)

- **Status:** Accepted (2026-07-29)

## Context

Every scanner, and `resolveAwsAccountId()` ([ADR-0026](0026-account-id-via-sts.md)), used whatever credentials the AWS SDK's default provider chain resolved (env vars, shared config/profile, EC2/ECS/Lambda role, SSO) with no way to override them per invocation. Scanning a second AWS account required the user to switch their ambient credentials (a different `AWS_PROFILE`, a fresh SSO login, editing `~/.aws/config`) before each run — awkward for a one-off cross-account check, and unworkable for scripting "run this same scan across N accounts" without shelling out to `aws sts assume-role` by hand and exporting the resulting keys as env vars.

## Decision

New `--assume-role-arn <arn>` flag (plus optional `--external-id <id>`) on all five scanning/reporting commands (`analyze`, `cost`, `trend`, `dead-resources`, `resource-security`). Resolution is centralized in one place per command:

- `resolveCredentials()` (`apps/cli/src/commands/resolve-options.ts`) calls the new `assumeRole()` (`libs/shared/aws-infra-utils/src/utils/assume-role.ts`), built on `fromTemporaryCredentials` from `@aws-sdk/credential-providers`. It resolves the credential provider **eagerly** — invoking it once right there — specifically so a bad role ARN, a trust policy that denies the caller, or a wrong `--external-id` fails loudly at the top of the command, never silently, and never by falling back to the ambient credentials (which would scan the wrong account without telling anyone).
- When `--assume-role-arn` is omitted, `resolveCredentials()` returns `undefined` and every downstream call keeps using the SDK's own default provider chain exactly as before — this is strictly additive, zero behavior change for the common case.
- The resulting `AwsCredentialIdentityProvider | undefined` is threaded as an explicit optional constructor/function parameter through every layer that talks to AWS: `createAwsClientConfig(credentials?)` conditionally spreads a `credentials` key into the client config; `resolveAwsAccountId(credentials?)` passes it to the `STSClient` so the reported `accountId` reflects the **assumed** identity, not the caller's own (no separate "which account did we actually scan" bookkeeping needed); every scanner constructor across `cloud-cost`, `dead-resources`, and `resource-security` gained one more optional parameter; `AwsPricingApiAdapter` and `AwsCostExplorerAdapter` gained a constructor parameter.
- **Positional convention, not a breaking one:** scanner constructors already took positional args (pricing, accountId, policy, window hours, ...) with no options-object refactor — adding `credentials` mid-list would have been a silent, easy-to-miss breaking change for every call site. Convention adopted: "flat" scanners (not extending `CloudWatchIdleScanner`) take `credentials` right after `accountId`; `CloudWatchIdleScanner` subclasses ([ADR-0044](0044-cloudwatch-idle-scanner-template-method.md)) take it as their own last constructor parameter, forwarded into the shared base class's constructor. This keeps every existing positional argument at the same index — the new parameter is always appended, never inserted.
- `sts:AssumeRole` added to `REQUIRED_IAM_POLICY` (`apps/cli/src/iam-policy.ts`) — this is the action the **calling** principal needs; the **target** role's own trust policy (in the account being scanned) must separately grant that principal `sts:AssumeRole`, which cloudrift cannot express or provision — documented with a sample trust policy in `docs/en/iam-permissions.md` / `docs/it/permessi-iam.md`.

## Alternatives Considered

- **Rely on AWS named profiles (`AWS_PROFILE` / `~/.aws/config`) per invocation.** Rejected: requires the user to pre-provision a profile per target account outside cloudrift, doesn't compose with a single scripted invocation that names the target account inline, and is exactly the friction this feature exists to remove.
- **Built-in multi-account "sweep" mode** (cloudrift itself iterating an AWS Organizations account list and scanning each one). Deferred, not rejected outright: out of scope for this phase. A single assumed role per invocation already composes with an external loop (a shell `for` loop over role ARNs, or a CI matrix) without cloudrift needing `organizations:*` permissions or owning any new orchestration/aggregation logic. Revisit if users actually want a single command that fans out across an entire Organization — similar in spirit to the deferred-for-now stance in [ADR-0067](0067-saas-readiness-architectural-hints.md).
- **Silently fall back to ambient credentials if `assumeRole()` fails.** Rejected: the whole point of this flag is "scan *that* account, not mine" — a silent fallback would scan the wrong account and still print a report, with nothing in the output to say so.
- **Lazy credential resolution** (pass the provider through unresolved, let the first AWS SDK call surface any failure). Rejected: the first failure would then surface deep inside whichever scanner happened to run first, with a stack trace/error shape that varies scanner to scanner, instead of one clear message at the top of the command before any scan begins.

## Consequences

Cross-account scanning is a **per-invocation** flag, not a built-in multi-account feature: covering N accounts means invoking cloudrift N times (once per role ARN), each invocation fully independent — its own report, its own `accountId` (the assumed one), its own exit code. This is intentionally left to the caller (shell loop, CI matrix) rather than built into cloudrift.

New dependency: `@aws-sdk/credential-providers` in `shared-aws-infra-utils`. Every scanner constructor across three domains gained one more optional parameter — a mechanical, purely additive change (verified via `nx run-many -t typecheck,lint,test` across all affected projects; zero test regressions).

`sts:AssumeRole` is now part of the policy printed by `cloudrift iam-policy` and returned by the `get_required_iam_permissions` MCP tool — users who don't use `--assume-role-arn` gain one unused-but-harmless action in that policy; there's no per-flag IAM policy variant today (same limitation `iam-policy` already has for `--scanners`-style narrowing).
