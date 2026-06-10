import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  type LoadBalancer as AwsLoadBalancer,
  type TargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { Result } from 'shared-kernel';
import type { LoadBalancerRepositoryPort, AwsRegion, LoadBalancerType, PricingPort } from 'cloud-cost-domain';
import { LoadBalancer } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

export class AwsLoadBalancerRepositoryAdapter implements LoadBalancerRepositoryPort {
  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId: string = 'unknown',
  ) {}

  async findIdleLoadBalancers(
    region: AwsRegion,
  ): ReturnType<LoadBalancerRepositoryPort['findIdleLoadBalancers']> {
    const client = new ElasticLoadBalancingV2Client({ region: region.code });
    try {
      const allLbs = await paginate<AwsLoadBalancer>(async (cursor) => {
        const r = await client.send(new DescribeLoadBalancersCommand({ Marker: cursor }));
        return { items: r.LoadBalancers ?? [], cursor: r.NextMarker };
      });

      const filtered = allLbs.filter(
        (lb) => lb.Type === 'application' || lb.Type === 'network',
      );

      const idleLbs: LoadBalancer[] = [];

      for (const lb of filtered) {
        const targetGroups = await paginate<TargetGroup>(async (cursor) => {
          const r = await client.send(
            new DescribeTargetGroupsCommand({ LoadBalancerArn: lb.LoadBalancerArn, Marker: cursor }),
          );
          return { items: r.TargetGroups ?? [], cursor: r.NextMarker };
        });

        let totalRegisteredTargets = 0;
        for (const tg of targetGroups) {
          const healthResponse = await client.send(
            new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }),
          );
          totalRegisteredTargets += (healthResponse.TargetHealthDescriptions ?? []).length;
        }

        if (totalRegisteredTargets === 0) {
          idleLbs.push(this.mapToEntity(lb, region));
        }
      }

      return Result.ok(idleLbs);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ELB', err as Error));
    } finally {
      client.destroy();
    }
  }

  private mapToEntity(lb: AwsLoadBalancer, region: AwsRegion): LoadBalancer {
    return new LoadBalancer({
      arn: lb.LoadBalancerArn!,
      name: lb.LoadBalancerName!,
      region,
      accountId: this.accountId,
      type: lb.Type as LoadBalancerType,
      createdTime: lb.CreatedTime ?? new Date(),
      detectedAt: new Date(),
      tags: {},
      monthlyCostUsd: this.pricing.getLoadBalancerPricePerMonth(region),
    });
  }
}
