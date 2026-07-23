// SPDX-License-Identifier: Apache-2.0
import { Result, createLogger } from 'shared-kernel';
import type {
  FindDeadResourcesRequest,
  FindDeadResourcesUseCasePort,
  DeadResourcesSummary,
  DeadResource,
  DeadResourceScannerPort,
  DeadResourceScanError,
  DeadResourceSeverity,
} from 'dead-resources-domain';

const logger = createLogger('cloudrift:scanner');

/** Same bound as `AnalyzeCloudWasteUseCase` (`cloud-cost-application`) — see ADR-0064/ADR-0063. */
const DEFAULT_SCAN_CONCURRENCY = 12;

/**
 * Generic coordinator: every (scanner, region) pair becomes one job in a
 * FIFO queue consumed by a small worker pool with a single global bound.
 * Deliberately mirrors `AnalyzeCloudWasteUseCase`'s shape (ADR-0078) rather
 * than being shared with it — the two coordinators operate on disjoint
 * finding types and summing dollars has no equivalent to compute here.
 */
export class FindDeadResourcesUseCase implements FindDeadResourcesUseCasePort {
  constructor(
    private readonly scanners: readonly DeadResourceScannerPort[],
    private readonly scanConcurrency = DEFAULT_SCAN_CONCURRENCY,
  ) {}

  async execute(request: FindDeadResourcesRequest): Promise<Result<DeadResourcesSummary>> {
    const findings: DeadResource[] = [];
    const scanErrors: DeadResourceScanError[] = [];

    // Global-scope scanners (IAM) get exactly one job, not one per region —
    // an AWS global service has no per-region data to deduplicate. The
    // region passed to that one job is arbitrary (the first requested) and
    // the scanner implementation must ignore it (ADR-0078). Callers always
    // pass at least one region (CLI default, wizard requires a selection).
    const jobs = this.scanners.flatMap((scanner) =>
      scanner.scope === 'global' ? [{ scanner, region: request.regions[0] }] : request.regions.map((region) => ({ scanner, region })),
    );

    let nextJob = 0;
    const worker = async (): Promise<void> => {
      while (nextJob < jobs.length) {
        const { scanner, region } = jobs[nextJob++];
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
      }
    };

    const workerCount = Math.max(1, Math.min(this.scanConcurrency, jobs.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const countBySeverity: Record<DeadResourceSeverity, number> = { info: 0, warning: 0, critical: 0 };
    for (const finding of findings) {
      countBySeverity[finding.severity]++;
    }

    return Result.ok({ findings, countBySeverity, scanErrors });
  }
}
