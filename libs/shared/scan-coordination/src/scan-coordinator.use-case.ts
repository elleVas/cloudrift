// SPDX-License-Identifier: Apache-2.0
import { Result, createLogger } from 'shared-kernel';
import { mapWithConcurrency } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

/**
 * Global bound on in-flight (scanner, region) scans, any mix. Restored to 12
 * (2026-07-13, ADR-0064) after root-causing a socket hang up that briefly
 * dropped this to 1: it was a client-side bug (every scanner shared one
 * `NodeHttpHandler`, so one finishing destroyed another's in-flight
 * connections), not a real AWS reliability limit. Re-verified against real
 * AWS post-fix: 0 errors, identical findings, at 1/3/5/10/20 in-flight scans
 * alike. Overridable per domain via the constructor's second argument (e.g.
 * `CLOUDRIFT_SCAN_CONCURRENCY`, see `analyze-waste.composition.ts`).
 */
export const DEFAULT_SCAN_CONCURRENCY = 12;

export interface ScanCoordinatorError<TKind extends string = string> {
  readonly kind: TKind;
  readonly region: string;
  readonly error: Error;
}

export interface ScannableRegion {
  readonly code: string;
}

export interface ScannableScanner<TKind extends string, TRegion extends ScannableRegion, TFinding> {
  readonly kind: TKind;
  readonly scope?: 'regional' | 'global';
  scan(region: TRegion): Promise<Result<TFinding[], Error>>;
}

export interface ScanCoordinatorRequest<TRegion extends ScannableRegion> {
  readonly regions: readonly TRegion[];
}

/**
 * Shared orchestration for cloudrift's scan domains (cloud-cost,
 * dead-resources, resource-security): every (scanner, region) pair becomes
 * one job in a FIFO queue consumed by a bounded worker pool. Jobs are queued
 * scanner-major, so the first batch workers pull spreads across regions
 * instead of concentrating on the first one. Errors are collected per
 * (scanner, region) — the failure of one job does not discard the results
 * of the others, nor does it fail the use case as a whole.
 *
 * Global-scope scanners get exactly one job, not one per region — an AWS
 * global service (e.g. IAM) has no per-region data to deduplicate. The
 * region passed to that one job is arbitrary (the first requested) and the
 * scanner implementation must ignore it. Callers always pass at least one
 * region (CLI default, wizard requires a selection).
 *
 * Subclasses supply only the domain-specific final aggregation (dollar
 * totals, severity counts, ...) via `buildSummary`.
 */
export abstract class ScanCoordinatorUseCase<
  TKind extends string,
  TRegion extends ScannableRegion,
  TFinding,
  TSummary,
> {
  constructor(
    private readonly scanners: readonly ScannableScanner<TKind, TRegion, TFinding>[],
    private readonly scanConcurrency: number = DEFAULT_SCAN_CONCURRENCY,
  ) {}

  protected abstract buildSummary(findings: TFinding[], scanErrors: ScanCoordinatorError<TKind>[]): TSummary;

  async execute(request: ScanCoordinatorRequest<TRegion>): Promise<Result<TSummary>> {
    const findings: TFinding[] = [];
    const scanErrors: ScanCoordinatorError<TKind>[] = [];

    const jobs = this.scanners.flatMap((scanner) =>
      scanner.scope === 'global' ? [{ scanner, region: request.regions[0] }] : request.regions.map((region) => ({ scanner, region })),
    );

    await mapWithConcurrency(jobs, this.scanConcurrency, async ({ scanner, region }) => {
      const regionLabel = scanner.scope === 'global' ? 'global' : region.code;
      const startedAt = Date.now();
      const result = await scanner.scan(region);
      const durationMs = Date.now() - startedAt;
      if (result.ok) {
        logger.debug(`${scanner.kind} scan ok`, { region: regionLabel, durationMs, findings: result.value.length });
        findings.push(...result.value);
      } else {
        logger.debug(`${scanner.kind} scan failed`, { region: regionLabel, durationMs, error: result.error.message });
        scanErrors.push({ kind: scanner.kind, region: regionLabel, error: result.error });
      }
    });

    return Result.ok(this.buildSummary(findings, scanErrors));
  }
}
