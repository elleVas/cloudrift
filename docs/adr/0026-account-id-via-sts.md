# ADR-0026: Account ID resolved via STS, not asked from the user

- **Status:** Accepted

## Context

Reports need the AWS account ID; the credentials used for the scan already know it.

## Decision

`resolveAwsAccountId()` calls `sts:GetCallerIdentity` automatically. `--account-id` remains as an explicit override. If STS is unreachable, the tool degrades to `'unknown'` rather than failing the scan.

## Alternatives Considered

- **Require `--account-id` always, typed by the user.** Rejected: redundant given the same credentials already know the account, and error-prone for manually typed values that end up in reports circulated to others.

## Consequences

Account ID is correct by construction in the common case. STS is a soft dependency: its failure degrades the report rather than aborting it.
</content>
