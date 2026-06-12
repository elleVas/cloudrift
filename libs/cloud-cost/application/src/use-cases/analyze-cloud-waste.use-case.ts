import { Result } from 'shared-kernel';
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

    const totalMonthlyCostUsd = findings.reduce(
      (sum, finding) => sum + finding.costEstimate.monthlyCostUsd,
      0,
    );

    return Result.ok({ findings, totalMonthlyCostUsd, scanErrors });
  }
}
