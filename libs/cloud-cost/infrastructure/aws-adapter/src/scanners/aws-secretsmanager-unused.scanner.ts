// SPDX-License-Identifier: Apache-2.0
import {
  SecretsManagerClient,
  ListSecretsCommand,
  type SecretListEntry,
} from '@aws-sdk/client-secrets-manager';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, PricingPort, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { SecretsManagerUnused, SecretsManagerUnusedPolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

const logger = createLogger('cloudrift:scanner');

type SecretWithIds = SecretListEntry & { ARN: string; Name: string };

export class AwsSecretsManagerUnusedScanner implements WasteScannerPort {
  readonly kind = 'secretsmanager-unused' as const;

  constructor(
    private readonly pricing: PricingPort,
    private readonly accountId = 'unknown',
    private readonly policy = new SecretsManagerUnusedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const client = new SecretsManagerClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawSecrets = await paginate<SecretListEntry>(async (cursor) => {
        const r = await client.send(new ListSecretsCommand({ NextToken: cursor }));
        return { items: r.SecretList ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const monthlyCostUsd = this.pricing.getPrice(region, 'secretsmanager-secret');
      const validSecrets = rawSecrets.filter((s): s is SecretWithIds => !!s.ARN && !!s.Name);
      if (validSecrets.length !== rawSecrets.length) {
        logger.debug(`${this.kind}: skipped ${rawSecrets.length - validSecrets.length} entries missing ARN/Name`);
      }

      const secrets = validSecrets
        .map(
          (s) =>
            new SecretsManagerUnused({
              arn: s.ARN,
              region,
              accountId: this.accountId,
              name: s.Name,
              createdDate: s.CreatedDate ?? new Date(0),
              lastAccessedDate: s.LastAccessedDate,
              detectedAt: now,
              tags: Object.fromEntries((s.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? ''])),
              monthlyCostUsd,
            }),
        )
        .filter((secret) => this.policy.evaluate(secret, now).isWaste);

      return Result.ok(secrets);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SecretsManager', err as Error));
    } finally {
      client.destroy();
    }
  }
}
