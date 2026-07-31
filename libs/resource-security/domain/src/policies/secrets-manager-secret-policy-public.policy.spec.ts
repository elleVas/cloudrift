// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SecretsManagerSecretPolicyPublic } from '../entities/secrets-manager-secret-policy-public.entity';
import { SecretsManagerSecretPolicyPublicPolicy } from './secrets-manager-secret-policy-public.policy';

const region = AwsRegion.create('us-east-1');

function makeFinding(tags: Record<string, string> = {}): SecretsManagerSecretPolicyPublic {
  return new SecretsManagerSecretPolicyPublic({
    secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123',
    secretName: 'my-secret',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags,
  });
}

describe('SecretsManagerSecretPolicyPublicPolicy', () => {
  it('flags — the scanner only emits secrets with a public resource policy', () => {
    expect(new SecretsManagerSecretPolicyPublicPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    expect(new SecretsManagerSecretPolicyPublicPolicy().evaluate(makeFinding({ 'cloudrift:ignore': 'true' })).flagged).toBe(false);
  });
});
