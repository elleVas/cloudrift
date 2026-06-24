# ADR-0020: Multi-cloud: path kept open, not built now

- **Status:** Accepted

## Context

The ports architecture makes pricing-source and entry-point substitution easy, which raises the question of how far that substitutability extends — specifically, whether it buys multi-cloud "for free."

## Decision

Document a concrete 3-phase path (generalize the inbound `AwsRegion` boundary into a `CloudLocation`-like VO → add new `ResourceKind`s or a new bounded context for the second provider → multi-provider composition root) without implementing any of it now, since today's actual domain *is* AWS waste.

## Alternatives Considered

- **Introduce a generic `CloudLocation`/provider abstraction now, pre-emptively.** Rejected: no second cloud provider exists yet; this would be an empty abstraction guessed in advance, with no real second case to validate it against.
- **Promise "you just write an adapter" as the cost of adding a provider.** Rejected as inaccurate: new entities (a GCP Persistent Disk is not an EBS volume), new policies (waste semantics differ), and a new price table are real work even with the ports in place.

## Consequences

AWS-specific naming stays in the ubiquitous language (`EbsVolume`, not `Disk`) until a second provider is a real, funded requirement. See `docs/en/architecture.md#towards-multi-cloud` for the full phase breakdown.
