// SPDX-License-Identifier: Apache-2.0
import type { WasteReportDto } from 'cloud-cost-application';

interface FindingDelta<T> {
  readonly resolved: T[];
  readonly ongoing: T[];
  readonly new: T[];
}

/** Findings present in `older` but not `newer` are `resolved`; the reverse is `new`; present in both is `ongoing`. */
function diffFindingsById<T extends { id: string }>(older: readonly T[], newer: readonly T[]): FindingDelta<T> {
  const olderIds = new Set(older.map((f) => f.id));
  const newerIds = new Set(newer.map((f) => f.id));
  return {
    resolved: older.filter((f) => !newerIds.has(f.id)),
    ongoing: newer.filter((f) => olderIds.has(f.id)),
    new: newer.filter((f) => !olderIds.has(f.id)),
  };
}

function regionsDiffer(older: { regions: string[] }, newer: { regions: string[] }): boolean {
  const a = [...older.regions].sort();
  const b = [...newer.regions].sort();
  return a.length !== b.length || a.some((region, i) => region !== b[i]);
}

export interface CloudCostComparison {
  readonly domain: 'cloud-cost';
  readonly olderGeneratedAt: string;
  readonly newerGeneratedAt: string;
  readonly olderTotalWasteMonthlyUsd: number;
  readonly newerTotalWasteMonthlyUsd: number;
  readonly deltaUsd: number;
  /** null when the older total was $0 — a percentage change from zero isn't meaningful. */
  readonly deltaPercent: number | null;
  /**
   * Sum of the `monthlyCostUsd` of findings present in the older snapshot but
   * absent from the newer one. Labeled "presumed" deliberately: cloudrift is
   * read-only and never remediates anything, so it cannot know *why* a
   * finding disappeared (fixed by the user, resource deleted for an
   * unrelated reason, or simply out of scope this run) — see `regionsChanged`.
   */
  readonly presumedResolvedMonthlyUsd: number;
  readonly resolvedFindings: ReadonlyArray<{ id: string; kind: string; monthlyCostUsd: number }>;
  readonly newFindings: ReadonlyArray<{ id: string; kind: string; monthlyCostUsd: number }>;
  /** True if the two compared runs scanned different regions — a resolved/new finding may just reflect that, not real change. */
  readonly regionsChanged: boolean;
}

export function compareCloudCostSnapshots(older: WasteReportDto, newer: WasteReportDto): CloudCostComparison {
  const delta = diffFindingsById(older.findings, newer.findings);
  const deltaUsd = newer.totalWasteMonthlyUsd - older.totalWasteMonthlyUsd;

  return {
    domain: 'cloud-cost',
    olderGeneratedAt: older.meta.generatedAt,
    newerGeneratedAt: newer.meta.generatedAt,
    olderTotalWasteMonthlyUsd: older.totalWasteMonthlyUsd,
    newerTotalWasteMonthlyUsd: newer.totalWasteMonthlyUsd,
    deltaUsd,
    deltaPercent: older.totalWasteMonthlyUsd !== 0 ? (deltaUsd / older.totalWasteMonthlyUsd) * 100 : null,
    presumedResolvedMonthlyUsd: delta.resolved.reduce((sum, f) => sum + f.monthlyCostUsd, 0),
    resolvedFindings: delta.resolved.map((f) => ({ id: f.id, kind: f.kind, monthlyCostUsd: f.monthlyCostUsd })),
    newFindings: delta.new.map((f) => ({ id: f.id, kind: f.kind, monthlyCostUsd: f.monthlyCostUsd })),
    regionsChanged: regionsDiffer(older.meta, newer.meta),
  };
}

export interface HygieneComparison {
  readonly domain: 'dead-resources' | 'resource-security';
  readonly olderGeneratedAt: string;
  readonly newerGeneratedAt: string;
  readonly olderCountBySeverity: Record<string, number>;
  readonly newerCountBySeverity: Record<string, number>;
  readonly resolvedFindings: ReadonlyArray<{ id: string; kind: string; severity: string }>;
  readonly newFindings: ReadonlyArray<{ id: string; kind: string; severity: string }>;
  readonly regionsChanged: boolean;
}

/**
 * Structural shape `compareHygieneSnapshots` actually needs — deliberately
 * narrower than either full DTO (no `hygieneReason`/`riskReason`).
 */
interface HygieneReportLike {
  readonly meta: { readonly generatedAt: string; readonly regions: string[] };
  readonly countBySeverity: Record<string, number>;
  readonly findings: ReadonlyArray<{ id: string; kind: string; severity: string }>;
}

/**
 * Same shape as `compareCloudCostSnapshots`, but for the two severity-based
 * (no `$/month`) domains — `dead-resources` and `resource-security` share an
 * identical DTO shape except the reason field name, which isn't needed here.
 *
 * `older`/`newer` share one type parameter `T` (not a union of the two DTOs)
 * on purpose: a union would make `older.findings`/`newer.findings` two
 * *independently* unioned array types, and passing one to the other's
 * generic slot in `diffFindingsById` fails to type-check (TS can't infer a
 * single `T` for `readonly T[]` from a `readonly (A | B)[]` argument caused
 * by two unrelated unions). Binding both parameters to the same `T` forces
 * every call site to pass a matched pair of the *same* concrete DTO — which
 * is also the only comparison that ever makes semantic sense.
 */
export function compareHygieneSnapshots<T extends HygieneReportLike>(
  domain: 'dead-resources' | 'resource-security',
  older: T,
  newer: T,
): HygieneComparison {
  const delta = diffFindingsById(older.findings, newer.findings);

  return {
    domain,
    olderGeneratedAt: older.meta.generatedAt,
    newerGeneratedAt: newer.meta.generatedAt,
    olderCountBySeverity: older.countBySeverity,
    newerCountBySeverity: newer.countBySeverity,
    resolvedFindings: delta.resolved.map((f) => ({ id: f.id, kind: f.kind, severity: f.severity })),
    newFindings: delta.new.map((f) => ({ id: f.id, kind: f.kind, severity: f.severity })),
    regionsChanged: regionsDiffer(older.meta, newer.meta),
  };
}

export type HistoryComparison = CloudCostComparison | HygieneComparison;
