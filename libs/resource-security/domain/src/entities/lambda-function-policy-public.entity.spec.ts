// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { LambdaFunctionPolicyPublic } from './lambda-function-policy-public.entity';
import type { LambdaFunctionPolicyPublicProps } from './lambda-function-policy-public.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<LambdaFunctionPolicyPublicProps> = {}): LambdaFunctionPolicyPublic {
  return new LambdaFunctionPolicyPublic({
    functionName: 'my-fn',
    functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-fn',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags: {},
    ...overrides,
  });
}

describe('LambdaFunctionPolicyPublic', () => {
  it('exposes id (functionArn), kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('arn:aws:lambda:us-east-1:123456789012:function:my-fn');
    expect(finding.kind).toBe('lambda-function-policy-public');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ functionName: 'other-fn', tags: { env: 'prod' } });
    expect(finding.functionName).toBe('other-fn');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('any AWS principal');
  });
});
