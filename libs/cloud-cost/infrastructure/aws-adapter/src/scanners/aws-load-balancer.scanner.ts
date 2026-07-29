// SPDX-License-Identifier: Apache-2.0
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  type LoadBalancer as AwsLoadBalancer,
  type TargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  LoadBalancerType,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { LoadBalancer, LoadBalancerWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

type LoadBalancerWithIds = AwsLoadBalancer & { LoadBalancerArn: string; LoadBalancerName: string };

export class AwsLoadBalancerScanner implements WasteScannerPort {
  readonly kind = 'load-balancer' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new LoadBalancerWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new ElasticLoadBalancingV2Client({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const allLbs = await paginate<AwsLoadBalancer>(async (cursor) => {
        const r = await client.send(new DescribeLoadBalancersCommand({ Marker: cursor }));
        return { items: r.LoadBalancers ?? [], cursor: r.NextMarker };
      });

      const typeMatches = allLbs.filter((lb) => lb.Type === 'application' || lb.Type === 'network');
      const candidates = typeMatches.filter(
        (lb): lb is LoadBalancerWithIds => !!lb.LoadBalancerArn && !!lb.LoadBalancerName,
      );
      if (candidates.length !== typeMatches.length) {
        logger.debug(
          `${this.kind}: skipped ${typeMatches.length - candidates.length} entries missing LoadBalancerArn/LoadBalancerName`,
        );
      }

      const now = new Date();
      const entities: LoadBalancer[] = [];

      for (const lb of candidates) {
        const registeredTargetCount = await this.countRegisteredTargets(client, lb);
        const props = {
          arn: lb.LoadBalancerArn,
          name: lb.LoadBalancerName,
          region,
          accountId: this.accountId,
          // Cast, not narrowed: same shape as `aws-ebs-volume`'s `state`
          // cast — the SDK's `LoadBalancerTypeEnum` union exactly matches
          // `LoadBalancerType`'s member set, but the field is optional in
          // the SDK type with no safe fallback value for "AWS omitted the
          // type of a load balancer that unambiguously exists" — picking
          // one needs a product decision (deferred: see cast-cleanup ADR).
          type: lb.Type as LoadBalancerType,
          createdTime: lb.CreatedTime ?? new Date(),
          detectedAt: now,
          registeredTargetCount,
          tags: {},
          monthlyCostUsd: this.pricing.getPrice(region, 'load-balancer'),
        };
        const verdict = this.policy.evaluate(new LoadBalancer({ ...props, wasteReason: '' }), now);
        if (verdict.isWaste) {
          entities.push(new LoadBalancer({ ...props, wasteReason: verdict.reason }));
        }
      }

      return Result.ok(entities);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ELB', err));
    } finally {
      client.destroy();
    }
  }

  // More precise than just "target groups exist": an LB can have TGs configured but empty.
  private async countRegisteredTargets(
    client: ElasticLoadBalancingV2Client,
    lb: AwsLoadBalancer,
  ): Promise<number> {
    const targetGroups = await paginate<TargetGroup>(async (cursor) => {
      const r = await client.send(
        new DescribeTargetGroupsCommand({
          LoadBalancerArn: lb.LoadBalancerArn,
          Marker: cursor,
        }),
      );
      return { items: r.TargetGroups ?? [], cursor: r.NextMarker };
    });

    let total = 0;
    for (const tg of targetGroups) {
      const healthResponse = await client.send(
        new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }),
      );
      total += (healthResponse.TargetHealthDescriptions ?? []).length;
    }
    return total;
  }
}
