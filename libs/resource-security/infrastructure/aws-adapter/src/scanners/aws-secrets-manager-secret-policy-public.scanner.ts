// SPDX-License-Identifier: Apache-2.0
import { SecretsManagerClient, ListSecretsCommand, GetResourcePolicyCommand, type SecretListEntry } from '@aws-sdk/client-secrets-manager';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { SecretsManagerSecretPolicyPublic, SecretsManagerSecretPolicyPublicPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig, parsePolicyStatements, isWildcardPrincipal } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-secret `GetResourcePolicy` calls in flight at once. */
const SECRET_CHECK_CONCURRENCY = 8;

type SecretWithArn = SecretListEntry & { ARN: string; Name: string };

function isPublicPolicy(policyJson: string | undefined): boolean {
  return parsePolicyStatements(policyJson).some((s) => s.Effect === 'Allow' && isWildcardPrincipal(s.Principal) && s.Condition === undefined);
}

/** Detects Secrets Manager secrets with a resource policy granting access to any AWS principal, with no restricting condition. */
export class AwsSecretsManagerSecretPolicyPublicScanner implements ResourceSecurityScannerPort {
  readonly kind = 'secrets-manager-secret-policy-public' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new SecretsManagerSecretPolicyPublicPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new SecretsManagerClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawSecrets = await paginate<SecretListEntry>(async (cursor) => {
        const r = await client.send(new ListSecretsCommand({ NextToken: cursor }));
        return { items: r.SecretList ?? [], cursor: r.NextToken };
      });
      const validSecrets = rawSecrets.filter((s): s is SecretWithArn => !!s.ARN && !!s.Name);
      const now = new Date();

      const candidates = await mapWithConcurrency(validSecrets, SECRET_CHECK_CONCURRENCY, async (secret) => {
        try {
          const { ResourcePolicy } = await client.send(new GetResourcePolicyCommand({ SecretId: secret.ARN }));
          if (!isPublicPolicy(ResourcePolicy)) return undefined;
          return new SecretsManagerSecretPolicyPublic({ secretArn: secret.ARN, secretName: secret.Name, region, accountId: this.accountId, detectedAt: now, tags: {} });
        } catch (err) {
          logger.debug('secrets-manager-secret-policy-public: skipping secret after error', { secretArn: secret.ARN, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is SecretsManagerSecretPolicyPublic => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('SecretsManager', err));
    } finally {
      client.destroy();
    }
  }
}
