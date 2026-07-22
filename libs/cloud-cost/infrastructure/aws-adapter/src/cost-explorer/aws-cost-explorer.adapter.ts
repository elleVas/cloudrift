// SPDX-License-Identifier: Apache-2.0
import { CostExplorerClient, GetCostAndUsageCommand, type ResultByTime } from '@aws-sdk/client-cost-explorer';
import { Result } from 'shared-kernel';
import type { CostByService, CostExplorerPort, CostPeriodBucket } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

const METRIC = 'UnblendedCost';

/**
 * Cost Explorer is a global service with a single fixed API endpoint
 * (us-east-1), unlike every other adapter in this package: the client here
 * is never parameterized by the regions being scanned for resources.
 */
const COST_EXPLORER_REGION = 'us-east-1';

export class AwsCostExplorerAdapter implements CostExplorerPort {
  async getCostAndUsage(params: {
    startDate: string;
    endDate: string;
    granularity: 'DAILY' | 'MONTHLY';
  }): Promise<Result<CostPeriodBucket[]>> {
    const client = new CostExplorerClient({ ...createAwsClientConfig(), region: COST_EXPLORER_REGION });
    try {
      const results: ResultByTime[] = [];
      let nextPageToken: string | undefined;
      do {
        const response = await client.send(
          new GetCostAndUsageCommand({
            TimePeriod: { Start: params.startDate, End: params.endDate },
            Granularity: params.granularity,
            Metrics: [METRIC],
            GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
            NextPageToken: nextPageToken,
          }),
        );
        results.push(...(response.ResultsByTime ?? []));
        nextPageToken = response.NextPageToken;
      } while (nextPageToken);

      return Result.ok(results.map(toBucket));
    } catch (err) {
      return Result.fail(new AwsAdapterError('CostExplorer', err as Error));
    } finally {
      client.destroy();
    }
  }
}

function toBucket(result: ResultByTime): CostPeriodBucket {
  const byService: CostByService[] = (result.Groups ?? [])
    .map((group) => ({
      service: group.Keys?.[0] ?? 'Unknown',
      amountUsd: Number(group.Metrics?.[METRIC]?.Amount ?? '0'),
    }))
    .filter((s) => s.amountUsd !== 0);

  return {
    start: result.TimePeriod?.Start ?? '',
    end: result.TimePeriod?.End ?? '',
    totalUsd: byService.reduce((sum, s) => sum + s.amountUsd, 0),
    byService,
    final: result.Estimated !== true,
  };
}
