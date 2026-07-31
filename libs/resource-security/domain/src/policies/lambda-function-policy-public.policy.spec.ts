// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { LambdaFunctionPolicyPublic } from '../entities/lambda-function-policy-public.entity';
import { LambdaFunctionPolicyPublicPolicy } from './lambda-function-policy-public.policy';

const region = AwsRegion.create('us-east-1');

function makeFinding(tags: Record<string, string> = {}): LambdaFunctionPolicyPublic {
  return new LambdaFunctionPolicyPublic({
    functionName: 'my-fn',
    functionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-fn',
    region,
    accountId: '123456789012',
    detectedAt: new Date('2026-07-31'),
    tags,
  });
}

describe('LambdaFunctionPolicyPublicPolicy', () => {
  it('flags — the scanner only emits functions with a public resource policy', () => {
    expect(new LambdaFunctionPolicyPublicPolicy().evaluate(makeFinding()).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    expect(new LambdaFunctionPolicyPublicPolicy().evaluate(makeFinding({ 'cloudrift:ignore': 'true' })).flagged).toBe(false);
  });
});
