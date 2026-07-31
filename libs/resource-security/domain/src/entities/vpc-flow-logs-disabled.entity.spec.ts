// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { VpcFlowLogsDisabled } from './vpc-flow-logs-disabled.entity';
import type { VpcFlowLogsDisabledProps } from './vpc-flow-logs-disabled.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<VpcFlowLogsDisabledProps> = {}): VpcFlowLogsDisabled {
  return new VpcFlowLogsDisabled({ vpcId: 'vpc-123', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {}, ...overrides });
}

describe('VpcFlowLogsDisabled', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('vpc-123');
    expect(finding.kind).toBe('vpc-flow-logs-disabled');
    expect(finding.severity).toBe('warning');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ vpcId: 'vpc-999', tags: { env: 'prod' } });
    expect(finding.vpcId).toBe('vpc-999');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('Flow Log');
  });
});
