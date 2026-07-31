// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { SecretsManagerSecretPolicyPublic } from './secrets-manager-secret-policy-public.entity';
import type { SecretsManagerSecretPolicyPublicProps } from './secrets-manager-secret-policy-public.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<SecretsManagerSecretPolicyPublicProps> = {}): SecretsManagerSecretPolicyPublic {
  return new SecretsManagerSecretPolicyPublic({
    secretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123',
    secretName: 'my-secret',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('SecretsManagerSecretPolicyPublic', () => {
  it('exposes id (secretArn), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123');
    expect(finding.kind).toBe('secrets-manager-secret-policy-public');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ secretName: 'other-secret', tags: { env: 'prod' } });
    expect(finding.secretName).toBe('other-secret');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('any AWS principal');
  });
});
