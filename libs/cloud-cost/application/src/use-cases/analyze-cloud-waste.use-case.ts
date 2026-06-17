import { Result } from 'shared-kernel';
import { categoryOf } from 'cloud-cost-domain';
import type {
  FindWastedResourcesRequest,
  FindWastedResourcesUseCasePort,
  WastedResourcesSummary,
  WastedResource,
  WasteScannerPort,
  ResourceScanError,
} from 'cloud-cost-domain';

/**
 * Coordinatore generico: esegue gli scanner registrati (uno per tipo di
 * risorsa) in parallelo tra loro e in sequenza sulle regioni, per non
 * concentrare chiamate simultanee sulle stesse API regionali.
 *
 * Gli errori sono raccolti per (scanner, regione): il fallimento di una
 * regione non scarta i risultati delle altre, né quelli degli altri scanner.
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
          const result = await scanner.scan(region);
          if (result.ok) {
            findings.push(...result.value);
          } else {
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
