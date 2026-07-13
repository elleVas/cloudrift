// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeAddressesCommand,
  type Address,
} from '@aws-sdk/client-ec2';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { ElasticIp, ElasticIpWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type AddressWithIds = Address & { AllocationId: string; PublicIp: string };

export class AwsElasticIpScanner implements WasteScannerPort {
  readonly kind = 'elastic-ip' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new ElasticIpWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    try {
      const response = await client.send(
        new DescribeAddressesCommand({
          Filters: [{ Name: 'domain', Values: ['vpc'] }],
        }),
      );

      const now = new Date();
      const rawAddresses = response.Addresses ?? [];
      const validAddresses = rawAddresses.filter(
        (a): a is AddressWithIds => !!a.AllocationId && !!a.PublicIp,
      );
      if (validAddresses.length !== rawAddresses.length) {
        logger.debug(
          `${this.kind}: skipped ${rawAddresses.length - validAddresses.length} entries missing AllocationId/PublicIp`,
        );
      }

      const unassociated = validAddresses
        .map(
          (a) =>
            new ElasticIp({
              allocationId: a.AllocationId,
              publicIp: a.PublicIp,
              region,
              accountId: this.accountId,
              detectedAt: now,
              associationId: a.AssociationId,
              instanceId: a.InstanceId,
              tags: Object.fromEntries(
                (a.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
              ),
              monthlyCostUsd: this.pricing.getPrice(region, 'elastic-ip'),
            }),
        )
        .filter((ip) => this.policy.evaluate(ip, now).isWaste);

      return Result.ok(unassociated);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ElasticIP', err as Error));
    } finally {
      client.destroy();
    }
  }
}
