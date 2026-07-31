// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { VpcFlowLogsDisabled } from '../entities/vpc-flow-logs-disabled.entity';
import { VpcFlowLogsDisabledPolicy } from './vpc-flow-logs-disabled.policy';

const region = AwsRegion.create('us-east-1');

describe('VpcFlowLogsDisabledPolicy', () => {
  it('flags — the scanner only emits VPCs with no active flow log', () => {
    const finding = new VpcFlowLogsDisabled({ vpcId: 'vpc-123', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new VpcFlowLogsDisabledPolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new VpcFlowLogsDisabled({ vpcId: 'vpc-123', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new VpcFlowLogsDisabledPolicy().evaluate(finding).flagged).toBe(false);
  });
});
