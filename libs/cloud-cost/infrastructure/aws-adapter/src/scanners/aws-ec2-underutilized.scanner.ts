import {
  EC2Client,
  DescribeInstancesCommand,
  type Instance,
  type Reservation,
} from '@aws-sdk/client-ec2';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { UnderutilizedEc2Instance, Ec2UnderutilizedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const DEFAULT_WINDOW_HOURS = 168;
const CLOUDWATCH_CONCURRENCY = 5;
const PRICING_CONCURRENCY = 5;
/** Risparmio stimato da un downsize di un tier (advisory, da verificare). */
const RIGHTSIZE_SAVING_FRACTION = 0.5;

/**
 * Il prezzo per-instance-type è risolto on-demand dalla Pricing API (la
 * cardinalità degli instance type è troppo alta per il listino statico/il
 * prefetch di `warmUp`): `AwsPricingApiAdapter` soddisfa questa interfaccia
 * per duck typing.
 */
export interface Ec2InstancePricingSource {
  getEc2InstancePricePerMonth(region: AwsRegion, instanceType: string): Promise<number | undefined>;
}

/**
 * Rileva istanze EC2 *running* con CPU massima sotto soglia sull'intera
 * finestra di osservazione: probabile sovradimensionamento. Advisory
 * (categoria optimization, stima): CPU bassa non garantisce che RAM/rete
 * siano altrettanto sottoutilizzate, va verificato prima di un rightsizing.
 * Richiede `--live-pricing`: senza un prezzo per instance type, non c'è
 * risparmio stimabile.
 */
export class AwsEc2UnderutilizedScanner implements WasteScannerPort {
  readonly kind = 'ec2-underutilized' as const;

  constructor(
    private readonly pricing: Ec2InstancePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new Ec2UnderutilizedPolicy(),
    private readonly windowHours = DEFAULT_WINDOW_HOURS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const ec2 = new EC2Client({ region: region.code });
    const cw = new CloudWatchClient({ region: region.code });
    try {
      const reservations = await paginate<Reservation>(async (cursor) => {
        const r = await ec2.send(
          new DescribeInstancesCommand({
            Filters: [{ Name: 'instance-state-name', Values: ['running'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.Reservations ?? [], cursor: r.NextToken };
      });

      const rawInstances = reservations.flatMap((r) => r.Instances ?? []);
      if (rawInstances.length === 0) return Result.ok([]);

      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - this.windowHours * 60 * 60 * 1000);
      const periodSeconds = this.windowHours * 3600;

      const cpu = await mapWithConcurrency(rawInstances, CLOUDWATCH_CONCURRENCY, (i) =>
        this.cpuStats(cw, i.InstanceId!, startTime, endTime, periodSeconds),
      );

      const instanceTypes = [...new Set(rawInstances.map((i) => i.InstanceType ?? 'unknown'))];
      const priceEntries = await mapWithConcurrency(
        instanceTypes,
        PRICING_CONCURRENCY,
        async (instanceType) => ({
          instanceType,
          price: (await this.pricing.getEc2InstancePricePerMonth(region, instanceType)) ?? 0,
        }),
      );
      const priceByType = new Map(priceEntries.map((e) => [e.instanceType, e.price]));

      const now = new Date();
      const instances = rawInstances
        .map((inst: Instance, index) => {
          const instanceType = inst.InstanceType ?? 'unknown';
          const monthlyPrice = priceByType.get(instanceType) ?? 0;
          return new UnderutilizedEc2Instance({
            instanceId: inst.InstanceId!,
            region,
            accountId: this.accountId,
            instanceType,
            avgCpuPercent: cpu[index].avg,
            maxCpuPercent: cpu[index].max,
            windowDays: +(this.windowHours / 24).toFixed(1),
            launchTime: inst.LaunchTime ?? new Date(),
            detectedAt: now,
            tags: Object.fromEntries(
              (inst.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
            monthlyCostUsd: +(monthlyPrice * RIGHTSIZE_SAVING_FRACTION).toFixed(4),
          });
        })
        .filter((instance) => this.policy.evaluate(instance, now).isWaste);

      return Result.ok(instances);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      ec2.destroy();
      cw.destroy();
    }
  }

  private async cpuStats(
    cw: CloudWatchClient,
    instanceId: string,
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
  ): Promise<{ avg: number; max: number }> {
    const r = await cw.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Average', 'Maximum'],
      }),
    );
    const dp = r.Datapoints?.[0];
    return { avg: dp?.Average ?? 0, max: dp?.Maximum ?? 0 };
  }
}
