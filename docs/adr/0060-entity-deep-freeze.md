# ADR-0060: `Entity` deep-freezes props recursively

- **Status:** Accepted (2026-07-10)

## Context

Every entity constructor did `this.props = Object.freeze({ ...props })`, but `Object.freeze` is shallow: nested fields like `tags: Record<string, string>` (all 29 entities) or `attachedVolumes: AttachedVolume[]` (`ec2-instance.entity.ts`) were declared `readonly` at the type level but not actually frozen — `entity.tags['x'] = 'y'` compiled and mutated the object at runtime. For a domain model that emphasizes immutability, this was a real inconsistency: harmless today (nothing mutates a tag after construction), but a future formatter or adapter mutating a finding in place to "enrich" it would produce an invisible, intermittent bug no test would catch.

## Decision

`Entity<TId>` (`libs/shared/kernel/src/base/entity.base.ts`) gains a `protected deepFreeze<T>(value: T): Readonly<T>` method: recursively freezes plain objects and arrays, using `Object.isFrozen` as a guard against cycles and redundant work, and deliberately leaving `Date` instances alone (freezing wouldn't stop `setMonth()` anyway — Date mutators aren't property writes — and no entity mutates a stored Date in place). All 29 entities switched from `Object.freeze({ ...props })` to `this.deepFreeze({ ...props })` — the same one-line change everywhere, no new duplication introduced.

Presented as an explicit architectural choice before implementing (per this project's rule): base-class method vs. a shared free function vs. a narrower fix touching only `tags`. The user picked the base-class method, consistent with this project's existing preference for a base class/injected collaborator over free-function utilities when removing duplication.

## Alternatives Considered

- **A shared free function** (`deepFreeze()` exported from a new shared-kernel utils file, imported by each entity). Rejected in favor of the base-class method — same algorithm, but as an inherited method rather than a standalone import, matching the pattern already used for `equals()`.
- **A narrow fix freezing only `tags`.** Rejected: doesn't generalize to `attachedVolumes` (the one other nested field) or any future nested field a new entity introduces — would need to be revisited per-entity instead of being structural.

## Consequences

New tests in `entity.base.spec.ts` (+4): mutating a nested object throws `TypeError` in strict mode, same for an object nested inside an array, `Date` remains usable after freezing, primitives/`null` pass through unchanged. 43/43 shared-kernel, 208/208 domain, 293/293 aws-adapter, 65/65 cli tests pass. See `docs/code-review-2026-07-10.md` §4.
