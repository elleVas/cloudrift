# ADR-0001: Scanner coverage criteria: fixed cost at rest only

- **Status:** Accepted (2026-06-21)

## Context

cloudrift needs a repeatable filter for deciding which AWS services get a dedicated waste scanner, instead of negotiating scope case by case every time a new service is proposed.

## Decision

A service qualifies for a scanner only if it accumulates a **fixed cost at rest**: a provisioned resource that keeps costing money even when nobody uses it (EBS, EIP, RDS, NAT Gateway, ElastiCache, EFS, etc.). Pay-per-use/serverless services (Athena, SQS, SNS, Step Functions, API Gateway, Glue) are out of scope: if you don't invoke them, you don't pay, so there is no "waste" in the sense the `WastedResource` domain models.

## Alternatives Considered

- **Cover every AWS service uniformly, flagging "low utilization" instead of "active waste."** Rejected: blurs the domain's core promise — a number you can act on by deleting something — and explodes scope indefinitely.
- **Add a separate "usage inefficiency" domain** (e.g. unpartitioned Athena scans, idle API Gateway stages). Rejected for now: different semantics from `WastedResource`, would require a new bounded context. Left open as a future option only if explicitly requested.

## Consequences

Keeps `WastedResource` semantically coherent. New-scanner requests for pay-per-use services get a fast, consistent answer instead of a fresh debate each time. See `docs/en/technical-choices.md` for how this maps onto the current 18-scanner list.
</content>
