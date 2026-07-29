// SPDX-License-Identifier: Apache-2.0
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
  type NetworkInterface,
} from '@aws-sdk/client-ec2';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { OrphanedEni, OrphanedEniWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError, paginate, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');

type NetworkInterfaceWithId = NetworkInterface & { NetworkInterfaceId: string };

/**
 * Rileva le ENI con Status=available (non attaccate). Nessun costo diretto
 * (AWS non fattura le ENI inattive), ma segnala automazione/cleanup mancante.
 */
export class AwsEniOrphanedScanner implements WasteScannerPort {
  readonly kind = 'eni-orphaned' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new OrphanedEniWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawEnis = await paginate<NetworkInterface>(async (cursor) => {
        const r = await client.send(
          new DescribeNetworkInterfacesCommand({
            Filters: [{ Name: 'status', Values: ['available'] }],
            NextToken: cursor,
          }),
        );
        return { items: r.NetworkInterfaces ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validEnis = rawEnis.filter((eni): eni is NetworkInterfaceWithId => !!eni.NetworkInterfaceId);
      if (validEnis.length !== rawEnis.length) {
        logger.debug(`${this.kind}: skipped ${rawEnis.length - validEnis.length} entries missing NetworkInterfaceId`);
      }

      const enis = validEnis
        .map((eni) => {
          const props = {
            networkInterfaceId: eni.NetworkInterfaceId,
            region,
            accountId: this.accountId,
            vpcId: eni.VpcId ?? 'unknown',
            subnetId: eni.SubnetId ?? 'unknown',
            status: eni.Status ?? 'available',
            detectedAt: now,
            tags: Object.fromEntries(
              (eni.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
          };
          const verdict = this.policy.evaluate(new OrphanedEni({ ...props, wasteReason: '' }), now);
          return verdict.isWaste ? new OrphanedEni({ ...props, wasteReason: verdict.reason }) : null;
        })
        .filter((eni): eni is OrphanedEni => eni !== null);

      return Result.ok(enis);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err));
    } finally {
      client.destroy();
    }
  }
}
