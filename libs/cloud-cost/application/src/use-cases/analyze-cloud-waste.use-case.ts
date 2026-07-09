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
 * Generic coordinator: runs the registered scanners (one per resource
 * type) in parallel with each other and in sequence over the regions, so as not
 * to concentrate simultaneous calls on the same regional APIs.
 *
 * Errors are collected per (scanner, region): the failure of one
 * region does not discard the results of the others, nor those of the other scanners.
 */
export class AnalyzeCloudWasteUseCase implements FindWastedResourcesUseCasePort {
  constructor(private readonly scanners: readonly WasteScannerPort[]) {}

  async execute(
    request: FindWastedResourcesRequest,
  ): Promise<Result<WastedResourcesSummary>> {
    const findings: WastedResource[] = [];
    const scanErrors: ResourceScanError[] = [];

    await Promise.all(
      this.scanners.map(async (scanner) => {
        for (const region of request.regions) {
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
      }),
    );

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
