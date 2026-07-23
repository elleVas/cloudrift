// SPDX-License-Identifier: Apache-2.0
import { Result, createLogger } from 'shared-kernel';
import type {
  FindResourceSecurityFindingsRequest,
  FindResourceSecurityFindingsUseCasePort,
  ResourceSecuritySummary,
  SecurityFinding,
  ResourceSecurityScannerPort,
  ResourceSecurityScanError,
  ResourceSecuritySeverity,
} from 'resource-security-domain';

const logger = createLogger('cloudrift:scanner');

/** Same bound as `FindDeadResourcesUseCase`/`AnalyzeCloudWasteUseCase` — see ADR-0064/ADR-0063. */
const DEFAULT_SCAN_CONCURRENCY = 12;

/**
 * Generic coordinator: every (scanner, region) pair becomes one job in a
 * FIFO queue consumed by a small worker pool with a single global bound.
 * Deliberately mirrors `FindDeadResourcesUseCase`'s shape rather than being
 * shared with it — the two coordinators operate on disjoint finding types.
 */
export class FindResourceSecurityFindingsUseCase implements FindResourceSecurityFindingsUseCasePort {
  constructor(
    private readonly scanners: readonly ResourceSecurityScannerPort[],
    private readonly scanConcurrency = DEFAULT_SCAN_CONCURRENCY,
  ) {}

  async execute(request: FindResourceSecurityFindingsRequest): Promise<Result<ResourceSecuritySummary>> {
    const findings: SecurityFinding[] = [];
    const scanErrors: ResourceSecurityScanError[] = [];

    // Global-scope scanners (IAM, S3 bucket listing, CloudTrail) get exactly
    // one job, not one per region — the region passed to that one job is
    // arbitrary (the first requested) and the scanner implementation must
    // ignore it. Callers always pass at least one region (CLI default,
    // wizard requires a selection).
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

    const countBySeverity: Record<ResourceSecuritySeverity, number> = { info: 0, warning: 0, critical: 0 };
    for (const finding of findings) {
      countBySeverity[finding.severity]++;
    }

    return Result.ok({ findings, countBySeverity, scanErrors });
  }
}
