// SPDX-License-Identifier: Apache-2.0
import { LambdaClient, ListFunctionsCommand, GetPolicyCommand } from '@aws-sdk/client-lambda';
import { AwsLambdaFunctionPolicyPublicScanner } from './aws-lambda-function-policy-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-lambda');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (LambdaClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsLambdaFunctionPolicyPublicScanner();
const fn = { FunctionName: 'my-fn', FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:my-fn' };

const publicPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 'lambda:InvokeFunction' }] });
const scopedPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'lambda:InvokeFunction' }] });

describe('AwsLambdaFunctionPolicyPublicScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('lambda-function-policy-public');
  });

  it('flags a function with a public resource policy', async () => {
    mockSend.mockResolvedValueOnce({ Functions: [fn] }).mockResolvedValueOnce({ Policy: publicPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a function with a scoped resource policy', async () => {
    mockSend.mockResolvedValueOnce({ Functions: [fn] }).mockResolvedValueOnce({ Policy: scopedPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a function with no resource policy at all', async () => {
    const err = new Error('The resource you requested does not exist.');
    err.name = 'ResourceNotFoundException';
    mockSend.mockResolvedValueOnce({ Functions: [fn] }).mockRejectedValueOnce(err);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListFunctionsCommand and GetPolicyCommand', async () => {
    mockSend.mockResolvedValueOnce({ Functions: [fn] }).mockResolvedValueOnce({ Policy: scopedPolicy });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListFunctionsCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetPolicyCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListFunctions itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
