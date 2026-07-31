// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { KmsKeyRotationDisabled } from '../entities/kms-key-rotation-disabled.entity';
import { KmsKeyRotationDisabledPolicy } from './kms-key-rotation-disabled.policy';

const region = AwsRegion.create('us-east-1');

describe('KmsKeyRotationDisabledPolicy', () => {
  it('flags — the scanner only emits keys with rotation disabled', () => {
    const finding = new KmsKeyRotationDisabled({ keyId: 'key-123', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new KmsKeyRotationDisabledPolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new KmsKeyRotationDisabled({ keyId: 'key-123', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new KmsKeyRotationDisabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
