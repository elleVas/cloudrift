import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
  type NetworkInterface,
} from '@aws-sdk/client-ec2';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { OrphanedEni, OrphanedEniWastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';

/**
 * Rileva le ENI con Status=available (non attaccate). Nessun costo diretto
 * (AWS non fattura le ENI inattive), ma segnala automazione/cleanup mancante.
 */
export class AwsEniOrphanedScanner implements WasteScannerPort {
  readonly kind = 'eni-orphaned' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new OrphanedEniWastePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new EC2Client({ region: region.code });
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
      const enis = rawEnis
        .map((eni) =>
          new OrphanedEni({
            networkInterfaceId: eni.NetworkInterfaceId!,
            region,
            accountId: this.accountId,
            vpcId: eni.VpcId ?? 'unknown',
            subnetId: eni.SubnetId ?? 'unknown',
            status: eni.Status ?? 'available',
            detectedAt: now,
            tags: Object.fromEntries(
              (eni.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? '']),
            ),
          }),
        )
        .filter((eni) => this.policy.evaluate(eni, now).isWaste);

      return Result.ok(enis);
    } catch (err) {
      return Result.fail(new AwsAdapterError('EC2', err as Error));
    } finally {
      client.destroy();
    }
  }
}
