# ADR-0046: `ValueObject.equals()` uses a recursive `deepEqual`, not `JSON.stringify` comparison

- **Status:** Accepted (2026-07-09)

## Context

`ValueObject<T>.equals()` compared `JSON.stringify(this.props) === JSON.stringify(other.props)`. Object key order in `JSON.stringify` output follows insertion order, which is not guaranteed to be identical between two structurally-equal objects — two value objects with the same properties but a different construction order would compare unequal. Not an observed bug (every value object in the codebase is constructed with the same property order today), but a correctness property the implementation didn't actually hold, latent until some future value object's construction paths diverged.

## Decision

`equals()` now delegates to a recursive `deepEqual(a, b)`: primitives compared via `Object.is` (correctly distinguishes `NaN`/`NaN` and `+0`/`-0`, unlike `===`), `Date` compared by `getTime()`, arrays element-by-element (including length), and plain objects key-by-key using each object's own key set — order-independent by construction, since it iterates keys and looks up the corresponding value on the other side rather than serializing both to strings first.

## Alternatives Considered

- **Per-value-object explicit `equals()` overrides** where it matters. Rejected: the value object count is small today, but pushing the fix to call sites means every *future* value object inherits the same latent bug unless its author remembers to override — a base-class fix is generic and closes the gap for anything not yet written, not just what exists now.
- **Sort object keys before `JSON.stringify` comparison** (minimal diff from the original approach). Rejected in favor of a real `deepEqual`: sorting keys fixes the ordering issue but is still O(n log n) string-building work for a structural comparison that a direct recursive walk does in O(n) without allocating intermediate strings, and doesn't correctly handle `Date` (two different `Date` instances with the same timestamp serialize identically only by coincidence of `JSON.stringify`'s `Date.toISOString()` behavior, not by an explicit, intentional comparison).

## Consequences

No per-value-object changes needed — the fix is generic in `ValueObject`'s base class and applies to every current and future value object. 3 new tests cover the cases the old implementation got wrong or only accidentally right: differing key insertion order, nested `Date` fields, nested arrays. All 208 domain tests and 32 shared-kernel tests pass unchanged otherwise.
