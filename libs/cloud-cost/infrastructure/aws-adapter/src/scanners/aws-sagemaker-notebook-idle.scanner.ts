// SPDX-License-Identifier: Apache-2.0
import {
  SageMakerClient,
  ListNotebookInstancesCommand,
  type NotebookInstanceSummary,
} from '@aws-sdk/client-sagemaker';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { createLogger } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import { SageMakerNotebookIdle, SageMakerNotebookIdlePolicy, type WastePolicy } from 'cloud-cost-domain';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { createAwsClientConfig } from '../utils/client-config';
import { maxMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';

const DEFAULT_LOOKBACK_HOURS = 168;
const PRICING_CONCURRENCY = 5;
const logger = createLogger('cloudrift:scanner');

export interface SageMakerNotebookInstancePricingSource {
  getSageMakerNotebookInstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

type NotebookInstanceWithName = NotebookInstanceSummary & { NotebookInstanceName: string };

/**
 * Detects SageMaker notebook instances `InService` with maximum CPU below
 * threshold over the window — GPU instance types can cost hundreds to
 * thousands of $/day. CPU is the only signal available without extra IAM
 * permissions: it cannot see Jupyter kernel activity (documented caveat,
 * ADR-0065).
 */
export class AwsSageMakerNotebookIdleScanner extends CloudWatchIdleScanner<
  SageMakerClient,
  NotebookInstanceWithName,
  number,
  SageMakerNotebookIdle
> {
  readonly kind = 'sagemaker-notebook-idle' as const;
  protected readonly serviceLabel = 'SageMaker';

  constructor(
    private readonly pricing: SageMakerNotebookInstancePricingSource,
    private readonly accountId = 'unknown',
    policy: WastePolicy<SageMakerNotebookIdle> = new SageMakerNotebookIdlePolicy(),
    windowHours = DEFAULT_LOOKBACK_HOURS,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(region: AwsRegion): SageMakerClient {
    return new SageMakerClient({ ...createAwsClientConfig(), region: region.code });
  }

  protected destroyPrimaryClient(client: SageMakerClient): void {
    client.destroy();
  }

  protected async listResources(client: SageMakerClient): Promise<NotebookInstanceWithName[]> {
    const notebooks = await paginate<NotebookInstanceSummary>(async (cursor) => {
      const r = await client.send(
        new ListNotebookInstancesCommand({ StatusEquals: 'InService', NextToken: cursor }),
      );
      return { items: r.NotebookInstances ?? [], cursor: r.NextToken };
    });
    const valid = notebooks.filter((n): n is NotebookInstanceWithName => !!n.NotebookInstanceName);
    if (valid.length !== notebooks.length) {
      logger.debug(`${this.kind}: skipped ${notebooks.length - valid.length} entries missing NotebookInstanceName`);
    }
    return valid;
  }

  protected fetchMetric(cw: CloudWatchClient, _region: AwsRegion, notebook: NotebookInstanceWithName, window: MetricWindow) {
    return maxMetric(
      cw,
      '/aws/sagemaker/NotebookInstances',
      'CPUUtilization',
      [{ Name: 'NotebookInstanceName', Value: notebook.NotebookInstanceName }],
      window,
    );
  }

  protected override async resolvePrices(
    raw: NotebookInstanceWithName[],
    region: AwsRegion,
  ): Promise<Map<string, number>> {
    const instanceTypes = [...new Set(raw.map((n) => n.InstanceType ?? 'unknown'))];
    const entries = await mapWithConcurrency(instanceTypes, PRICING_CONCURRENCY, async (instanceType) => ({
      instanceType,
      price: (await this.pricing.getSageMakerNotebookInstancePricePerMonth(region, instanceType)) ?? 0,
    }));
    return new Map(entries.map((e) => [e.instanceType, e.price]));
  }

  protected toEntity(
    notebook: NotebookInstanceWithName,
    maxCpuPercent: number,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): SageMakerNotebookIdle {
    const instanceType = notebook.InstanceType ?? 'unknown';
    return new SageMakerNotebookIdle({
      notebookInstanceName: notebook.NotebookInstanceName,
      region,
      accountId: this.accountId,
      instanceType,
      status: notebook.NotebookInstanceStatus ?? 'Unknown',
      maxCpuPercent,
      windowHours: this.windowHours,
      lastModifiedTime: notebook.LastModifiedTime ?? new Date(0),
      detectedAt: now,
      // ListNotebookInstances doesn't return tags (unlike RDS's DBInstance.TagList).
      tags: {},
      monthlyCostUsd: +(prices.get(instanceType) ?? 0).toFixed(4),
    });
  }
}
