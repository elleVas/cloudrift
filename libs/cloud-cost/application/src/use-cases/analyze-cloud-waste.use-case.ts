// SPDX-License-Identifier: Apache-2.0
import { Result, createLogger } from 'shared-kernel';
import { categoryOf } from 'cloud-cost-domain';
import type {
  FindWastedResourcesRequest,
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  WastedResource,
  WasteScannerPort,
  ResourceScanError,
} from 'cloud-cost-domain';

const logger = createLogger('cloudrift:scanner');

/**
 * Global bound on in-flight (scanner, region) scans, any mix. Overridable
 * via `CLOUDRIFT_SCAN_CONCURRENCY` (see `analyze-waste.composition.ts`).
 * Restored to 12 (2026-07-13, ADR-0064) after root-causing the socket
 * hang up that briefly dropped this to 1: it was a client-side bug (every
 * scanner shared one `NodeHttpHandler`, so one finishing destroyed another's
 * in-flight connections), not a real AWS reliability limit — ADR-0063's
 * original assumption was right, the earlier fix just targeted the wrong
 * layer. Re-verified against real AWS post-fix: 0 errors, identical findings,
 * at 1/3/5/10/20 in-flight scans alike.
 */
const DEFAULT_SCAN_CONCURRENCY = 12;

/**
 * Generic coordinator: every (scanner, region) pair becomes one job in a
 * FIFO queue consumed by a small worker pool with a single global bound —
 * instead of one unbounded Promise.all across scanners with regions in
 * series, where the total in-flight load was `scanners × internal fan-out`
 * on the first region and a multi-region scan took `regions × slowest
 * scanner`. Jobs are queued scanner-major (s1×r1, s1×r2, ..., s2×r1), so
 * the first batch the workers pull spreads across regions instead of
 * concentrating on the first one.
 *
 * Errors are collected per (scanner, region): the failure of one
 * region does not discard the results of the others, nor those of the other scanners.
 */
export class AnalyzeCloudWasteUseCase implements FindWastedResourcesUseCasePort {
  constructor(
    private readonly scanners: readonly WasteScannerPort[],
    private readonly scanConcurrency = DEFAULT_SCAN_CONCURRENCY,
  ) {}

  async execute(
    request: FindWastedResourcesRequest,
  ): Promise<Result<WastedResourcesSummary>> {
    const findings: WastedResource[] = [];
    const scanErrors: ResourceScanError[] = [];

    const jobs = this.scanners.flatMap((scanner) =>
      request.regions.map((region) => ({ scanner, region })),
    );

    let nextJob = 0;
    const worker = async (): Promise<void> => {
      while (nextJob < jobs.length) {
        const { scanner, region } = jobs[nextJob++];
        const startedAt = Date.now();
        const result = await scanner.scan(region);
        const durationMs = Date.now() - startedAt;
        if (result.ok) {
          logger.debug(`${scanner.kind} scan ok`, {
            region: region.code,
            durationMs,
            findings: result.value.length,
          });
          findings.push(...result.value);
        } else {
          logger.debug(`${scanner.kind} scan failed`, {
            region: region.code,
            durationMs,
            error: result.error.message,
          });
          scanErrors.push({
            kind: scanner.kind,
            region: region.code,
            error: result.error,
          });
        }
      }
    };

    const workerCount = Math.max(1, Math.min(this.scanConcurrency, jobs.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    let totalWasteMonthlyUsd = 0;
    let totalOptimizationMonthlyUsd = 0;
    for (const finding of findings) {
      const amount = finding.costEstimate.monthlyCostUsd;
      if (categoryOf(finding.kind) === 'waste') {
        totalWasteMonthlyUsd += amount;
      } else {
        totalOptimizationMonthlyUsd += amount;
      }
    }

    return Result.ok({
      findings,
      totalWasteMonthlyUsd,
      totalOptimizationMonthlyUsd,
      scanErrors,
    });
  }
}
