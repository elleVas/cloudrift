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
 * Global bound on in-flight (scanner, region) scans, any mix, for real AWS
 * usage. Overridable via `CLOUDRIFT_SCAN_CONCURRENCY` (see
 * `analyze-waste.composition.ts`) — the LocalStack e2e harness sets it much
 * lower, since LocalStack Community's single-process gateway can't reliably
 * absorb this many concurrent connections the way real AWS can. See
 * ADR-0063 (supersedes ADR-0062).
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
