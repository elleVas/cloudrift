# ADR-0094: `wasteReason` is derived from the policy's `WasteVerdict`, not hardcoded on the entity

- **Status:** Accepted (2026-07-28)

## Context

Every `cloud-cost` scanner follows the same shape: build candidate entities from the AWS response, then call `this.policy.evaluate(entity, now)` and keep only the ones where `.isWaste` is `true`. `WastePolicy.judge()` already returns a full `WasteVerdict { isWaste, reason }` — the `reason` is the policy's own explanation for the verdict, sometimes a static string (`waste('no registered targets')`), sometimes genuinely dynamic (`waste(\`manual snapshot ${ageDays}d old\`)`).

14 of the simpler "grace-period" style entities (`EbsVolume`, `AmiUnused`, `CodepipelinePipelineStale`, `EbsSnapshot`, `Ec2Instance`, `EcrImageUntagged`, `ElasticIp`, `LoadBalancer`, `LogGroup`, `OrphanedEni`, `RdsInstance`, `RdsManualSnapshotOld`, `S3Bucket`, `S3MultipartUploadAbandoned`) never used that computed `reason` at all: every scanner discarded it, keeping only `.isWaste`, and each entity had its own independent `get wasteReason()` getter — usually a hardcoded literal duplicating (and sometimes drifting from) the policy's own string. In four cases this was a genuine data loss, not just duplication:

- `Ec2Instance` had a `stoppedSince?: Date` prop added *specifically* to compute how long an instance had been stopped, but `wasteReason` never read it — always returned the same static `'stopped (attached EBS still billed)'`.
- `RdsManualSnapshotOld` and `CodepipelinePipelineStale`'s policies already computed a fully dynamic, context-rich reason (real age in days, "never executed" vs. "no execution in Nd" distinction) that the entity silently threw away in favor of a generic static string.
- `AmiUnused`'s policy already gated on a grace period computed from `creationDate`, but the entity's reason never surfaced that age.

The `WastedResource` interface (`wasted-resource.ts`) only requires `wasteReason: string` — it says nothing about *how* that string is produced. Sibling entities outside this group of 14 (`IdleEbsVolume`, `Gp2Volume`, `DocumentDbInstance`, and the other CloudWatch-metric-driven kinds) already compute `wasteReason` correctly by deriving it from their own constructor props (e.g. `` `zero I/O in last ${metricWindowHours}h` ``) — they don't go through this bug because they never had a separate "policy reason" to lose in the first place; their `WastePolicy.judge()` is a simple threshold check with no independently-valuable reason string.

## Decision

For the 14 affected entities, thread the policy's real `WasteVerdict.reason` into the entity instead of letting the entity invent its own. Three options were on the table:

- **A — thread the policy's `verdict.reason` into the entity.** Single source of truth: the policy already owns the business rule and already computes the right explanation: the entity just stores and returns it.
- **B — entity self-derives from its own already-available props** (the pattern already used for `IdleEbsVolume`/`Gp2Volume`), independent of the policy.
- **C — hybrid:** apply A only to the 4 cases with genuine dynamic data loss, leave the other 10 (cosmetic text drift only, no data loss) as static literals.

**Chosen: A, applied uniformly to all 14** — not just the 4 with obvious data loss. Rationale: even where the policy's reason was itself static, having the entity re-declare the same string independently is a duplication that can silently drift (the entity's copy and the policy's copy are not the same code, and nothing enforces they say the same thing) — Option A removes that duplication everywhere it exists, not just where it currently happens to matter.

### Mechanical shape

Each affected entity gained a `wasteReason: string` field on its `*Props` interface; the getter became a trivial `return this.props.wasteReason`. Each policy that only ever returned a static `waste('...')` reason, but had age data available (`createTime`/`creationDate`/`stoppedSince`/etc.), was enriched to include the real computed age — matching the idiom already used by `RdsManualSnapshotOld`/`CodepipelinePipelineStale`'s policies (`` `${this.ageInDays(x, now).toFixed(0)}d` ``). Two policies (`ElasticIpWastePolicy`, `OrphanedEniWastePolicy`) have no creation-date data at all — both explicitly comment "no grace period applicable" — so their reason stayed a static string, just de-duplicated between policy and entity rather than enriched.

The scanner-side complication: the policy needs a constructed entity to call methods like `isUnattached()`/`isStopped()` (which read the entity's own props), but the entity's `wasteReason` must be known and frozen *before* final construction (`Entity.deepFreeze`, [ADR-0060](0060-entity-deep-freeze.md)). Each scanner now does:

```typescript
const props = { /* ...all fields except wasteReason... */ };
const verdict = this.policy.evaluate(new LogGroup({ ...props, wasteReason: '' }), now);
return verdict.isWaste ? new LogGroup({ ...props, wasteReason: verdict.reason }) : null;
```

— a throwaway entity built solely to run the policy, then the real, final entity built with `wasteReason` set from the verdict. Two constructions per candidate; entities are cheap immutable POJOs, so this has no measurable cost. The final `.filter((x): x is LogGroup => x !== null)` replaces the previous `.map(...).filter((x) => policy.evaluate(x, now).isWaste)` chain.

## Alternatives Considered

- **Option B (entity self-derives from its own props).** Rejected as the *general* fix: it works cleanly when the entity already has exactly the right prop for the job (as `IdleEbsVolume` does with `metricWindowHours`), but for at least 3 of the 14 cases (`RdsManualSnapshotOld`, `CodepipelinePipelineStale`, `AmiUnused`) it would mean re-deriving age math in the entity that the policy *already* computes — duplicating the computation, not just the string, in the file that's supposed to hold facts, not decisions ([adding-a-resource.md](../en/adding-a-resource.md)'s own stated rule: "the entity carries the facts; the decision belongs to the policy").
- **Option C (hybrid, only fix the 4 real data-loss cases).** Considered as the minimal-diff option and initially recommended, but rejected by the user in favor of full consistency: leaving 10 entities with a policy/entity text duplication that "happens to currently agree" is exactly the kind of latent drift this ADR exists to close off.
- **Changing `WastePolicy.evaluate()`'s signature to return the constructed entity directly** (so scanners wouldn't need the double-construction). Not pursued: `WastePolicy<T>` is generic over the entity type and knows nothing about how to construct one — moving construction into the policy would invert the dependency (policy would need to import/construct domain entities it currently only judges), a bigger change for no benefit over the two-pass pattern above.

## Consequences

All 14 entities' `wasteReason` now reflects exactly what the policy decided, including real computed age where the policy has the data for it (e.g. `EbsVolume`: `'unattached, created 45d ago'` instead of the bare `'unattached'`). `EbsSnapshot` turned out to have the identical hardcoded-literal bug (`'source volume deleted'`), not part of the original bug report — found and fixed in the same pass since it matched the pattern exactly.

Every `*.entity.spec.ts`, the shared `waste-policies.spec.ts`, relevant `*.scanner.spec.ts`, and incidental cross-package fixtures in `apps/cli/src/formatters/*.spec.ts` / `apps/cli/src/commands/analyze-waste.command.spec.ts` / `libs/cloud-cost/application/src/{dto,use-cases}/*.spec.ts` that constructed these entities directly now pass `wasteReason` explicitly. None of those fixtures failed at test time before this fix — `tsconfig.json`'s `typecheck` target excludes `*.spec.ts` (only `tsconfig.spec.json`, run by ts-jest, sees them), so a missing required prop there is a real but silent type hole; worth knowing if a future required-prop addition seems to "just work" without touching test fixtures. 1184 tests green across `cloud-cost-domain`, `cloud-cost-infrastructure-aws-adapter`, `cloud-cost-application`, and `cli`.

This pattern (policy computes a real verdict reason, scanner discards it, entity re-invents a worse one) was verified only inside `cloud-cost`'s 14 grace-period-style `WastePolicy` subclasses. The parallel `dead-resources` and `resource-security` domains ([ADR-0078](0078-dead-resources-parallel-domain.md), similarly shaped `DeadResourcePolicy`/`SecurityFindingPolicy`) were not audited for the same bug — do not assume they're already covered.
