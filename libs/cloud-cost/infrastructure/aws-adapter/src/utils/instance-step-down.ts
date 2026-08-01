// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical AWS instance-size ordering, smallest to largest. `metal` sizes
 * are deliberately excluded: they don't sit at a fixed position across
 * families (and stepping "down" from/into metal isn't a meaningful
 * recommendation), so an instance type ending in `.metal` is left alone.
 */
const SIZE_TIERS = [
  'nano',
  'micro',
  'small',
  'medium',
  'large',
  'xlarge',
  '2xlarge',
  '3xlarge',
  '4xlarge',
  '6xlarge',
  '8xlarge',
  '9xlarge',
  '10xlarge',
  '12xlarge',
  '16xlarge',
  '18xlarge',
  '24xlarge',
  '32xlarge',
  '48xlarge',
] as const;

/**
 * One size down within the same family (e.g. `m5.2xlarge` → `m5.xlarge`,
 * `db.r5.large` → `db.r5.medium`). Returns `null` when the type doesn't
 * parse, is already the smallest known tier, or the size isn't in the
 * canonical ordering (e.g. `.metal`) — callers must treat `null` as "no
 * derivable recommendation for this instance", not retry with a bigger
 * step: a single step down is the only claim this function is willing to
 * make (the caller has no CloudWatch memory signal, so a bigger jump isn't
 * defensible either way).
 */
export function stepDownOneSize(instanceType: string): string | null {
  const lastDot = instanceType.lastIndexOf('.');
  if (lastDot === -1) return null;
  const family = instanceType.slice(0, lastDot);
  const size = instanceType.slice(lastDot + 1);
  const tierIndex = SIZE_TIERS.indexOf(size as (typeof SIZE_TIERS)[number]);
  if (tierIndex <= 0) return null;
  return `${family}.${SIZE_TIERS[tierIndex - 1]}`;
}
