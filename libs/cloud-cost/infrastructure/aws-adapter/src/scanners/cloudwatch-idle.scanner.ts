// SPDX-License-Identifier: Apache-2.0
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, ResourceKind, WasteScannerPort, WastedResource, WastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { metricWindow, type MetricWindow } from '../utils/cloudwatch-metrics';
import { createAwsClientConfig } from '../utils/client-config';

/**
 * Template method for the CloudWatch-based scanners (REVIEW.md #2): list
 * resources with a primary SDK client, fetch one CloudWatch metric per
 * resource (optionally resolving a live per-type price alongside it, for the
 * scanners gated by `--live-pricing`), then build and filter entities. Owns
 * the client lifecycle, the concurrency fan-out, and the Result/error
 * wrapping — a concrete scanner only implements the hooks below, keeping its
 * own public constructor (so composition root and specs are unaffected).
 *
 * Deliberately generic (not one shared shape for the metric): `TMetric` lets
 * each scanner fetch what it actually needs — a single sum, an
 * {avg,max} CPU pair, or a {read,write} pair kept apart — without forcing an
 * artificial common return type.
 */
export abstract class CloudWatchIdleScanner<TPrimaryClient, TRaw, TMetric, TEntity extends WastedResource>
  implements WasteScannerPort
{
  abstract readonly kind: ResourceKind;
  protected abstract readonly serviceLabel: string;

  constructor(
    protected readonly policy: WastePolicy<TEntity>,
    protected readonly windowHours: number,
    protected readonly metricConcurrency = 5,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const primary = this.createPrimaryClient(region);
    const cw = new CloudWatchClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const raw = await this.listResources(primary, region);
      if (raw.length === 0) return Result.ok([]);

      const window = metricWindow(this.windowHours);
      const [metrics, prices] = await Promise.all([
        mapWithConcurrency(raw, this.metricConcurrency, (resource) =>
          this.fetchMetric(cw, region, resource, window),
        ),
        this.resolvePrices(raw, region),
      ]);

      const now = new Date();
      const entities = raw
        .map((resource, index) => this.toEntity(resource, metrics[index], prices, region, now))
        .filter((entity) => this.policy.evaluate(entity, now).isWaste);

      return Result.ok(entities);
    } catch (err) {
      return Result.fail(new AwsAdapterError(this.serviceLabel, err as Error));
    } finally {
      this.destroyPrimaryClient(primary);
      cw.destroy();
    }
  }

  protected abstract createPrimaryClient(region: AwsRegion): TPrimaryClient;
  protected abstract destroyPrimaryClient(client: TPrimaryClient): void;
  protected abstract listResources(client: TPrimaryClient, region: AwsRegion): Promise<TRaw[]>;
  protected abstract fetchMetric(
    cw: CloudWatchClient,
    region: AwsRegion,
    resource: TRaw,
    window: MetricWindow,
  ): Promise<TMetric>;

  /**
   * Live per-type prices (Pricing API), keyed however the scanner likes
   * (instance type, a composite spec key, ...). Default no-op for the
   * scanners whose price is static/synchronous (`PricingPort.getPrice`
   * called directly in `toEntity`); overridden by the `--live-pricing`
   * scanners that need an async fan-out over unique resource "types".
   */
  protected async resolvePrices(_raw: TRaw[], _region: AwsRegion): Promise<Map<string, number>> {
    return new Map();
  }

  protected abstract toEntity(
    resource: TRaw,
    metric: TMetric,
    prices: Map<string, number>,
    region: AwsRegion,
    now: Date,
  ): TEntity;
}
