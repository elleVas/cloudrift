// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { Ec2KeyPairUnused } from './ec2-keypair-unused.entity';
import type { Ec2KeyPairUnusedProps } from './ec2-keypair-unused.entity';

const region = AwsRegion.create('eu-west-1');

function makeKeyPair(overrides: Partial<Ec2KeyPairUnusedProps> = {}): Ec2KeyPairUnused {
  return new Ec2KeyPairUnused({
    keyPairId: 'key-0abc123',
    keyName: 'old-deploy-key',
    region,
    accountId: '123456789012',
    createdAt: new Date('2023-06-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    ...overrides,
  });
}

describe('Ec2KeyPairUnused', () => {
  it('exposes correct id and fields', () => {
    const keyPair = makeKeyPair();
    expect(keyPair.id).toBe('key-0abc123');
    expect(keyPair.keyName).toBe('old-deploy-key');
    expect(keyPair.accountId).toBe('123456789012');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const keyPair = makeKeyPair();
    expect(keyPair.kind).toBe('ec2-keypair-unused');
    expect(keyPair.hygieneReason).toContain('not referenced');
    expect(keyPair.severity).toBe('info');
  });

  it('tags default to an empty object when none are set', () => {
    expect(makeKeyPair().tags).toEqual({});
  });
});
