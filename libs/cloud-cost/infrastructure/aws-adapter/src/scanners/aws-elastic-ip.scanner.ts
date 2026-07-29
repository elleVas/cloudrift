// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeAddressesCommand,
  type Address,
} from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type {
  AwsRegion,
  PricingPort,
  WasteScannerPort,
  WastedResource,
} from 'cloud-cost-domain';
import { ElasticIp, ElasticIpWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

type AddressWithIds = Address & { AllocationId: string; PublicIp: string };

export class AwsElasticIpScanner implements WasteScannerPort {
  readonly kind = 'elastic-ip' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new ElasticIpWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(this.credentials), region: region.code });
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
        .map((a) => {
          const props = {
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
          };
          const verdict = this.policy.evaluate(new ElasticIp({ ...props, wasteReason: '' }), now);
          return verdict.isWaste ? new ElasticIp({ ...props, wasteReason: verdict.reason }) : null;
        })
        .filter((ip): ip is ElasticIp => ip !== null);

      return Result.ok(unassociated);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ElasticIP', err));
    } finally {
      client.destroy();
    }
  }
}
