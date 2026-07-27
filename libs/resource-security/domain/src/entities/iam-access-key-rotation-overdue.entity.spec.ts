// SPDX-License-Identifier: Apache-2.0
import { IamAccessKeyRotationOverdue } from './iam-access-key-rotation-overdue.entity';
import type { IamAccessKeyRotationOverdueProps } from './iam-access-key-rotation-overdue.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeFinding(overrides: Partial<IamAccessKeyRotationOverdueProps> = {}): IamAccessKeyRotationOverdue {
  return new IamAccessKeyRotationOverdue({
    accessKeyId: 'AKIA1',
    userName: 'alice',
    accountId: '123456789012',
    createdAt: new Date(Date.now() - 200 * MS_PER_DAY),
    detectedAt: new Date(),
    tags: {},
    ...overrides,
  });
}

describe('IamAccessKeyRotationOverdue', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('AKIA1');
    expect(finding.kind).toBe('iam-access-key-rotation-overdue');
    expect(finding.severity).toBe('warning');
  });

  it('riskReason reports the key age', () => {
    expect(makeFinding().riskReason).toContain('200d');
  });

  it('exposes the remaining props', () => {
    const createdAt = new Date(Date.now() - 100 * MS_PER_DAY);
    const detectedAt = new Date();
    const finding = makeFinding({ accessKeyId: 'AKIA9', userName: 'bob', accountId: '999999999999', createdAt, detectedAt, tags: { env: 'prod' } });
    expect(finding.accessKeyId).toBe('AKIA9');
    expect(finding.userName).toBe('bob');
    expect(finding.accountId).toBe('999999999999');
    expect(finding.createdAt).toBe(createdAt);
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
  });
});
