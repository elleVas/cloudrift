// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { KmsKeyRotationDisabled } from './kms-key-rotation-disabled.entity';
import type { KmsKeyRotationDisabledProps } from './kms-key-rotation-disabled.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<KmsKeyRotationDisabledProps> = {}): KmsKeyRotationDisabled {
  return new KmsKeyRotationDisabled({ keyId: 'key-123', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {}, ...overrides });
}

describe('KmsKeyRotationDisabled', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('key-123');
    expect(finding.kind).toBe('kms-key-rotation-disabled');
    expect(finding.severity).toBe('warning');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ keyId: 'key-999', tags: { env: 'prod' } });
    expect(finding.keyId).toBe('key-999');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('rotation');
  });
});
