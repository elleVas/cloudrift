// SPDX-License-Identifier: Apache-2.0
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { AwsCloudformationStackStuckScanner } from './aws-cloudformation-stack-stuck.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-cloudformation');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CloudFormationClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsCloudformationStackStuckScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

describe('AwsCloudformationStackStuckScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('cloudformation-stack-stuck');
  });

  it('flags a stack stuck in DELETE_FAILED', async () => {
    mockSend.mockResolvedValueOnce({
      Stacks: [
        {
          StackId: 'arn:aws:cloudformation:us-east-1:123:stack/s1/1',
          StackName: 's1',
          StackStatus: 'DELETE_FAILED',
          CreationTime: oldDate,
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual(['arn:aws:cloudformation:us-east-1:123:stack/s1/1']);
  });

  it('does not flag a healthy stack', async () => {
    mockSend.mockResolvedValueOnce({
      Stacks: [{ StackId: 'arn:aws:cloudformation:us-east-1:123:stack/s2/1', StackName: 's2', StackStatus: 'CREATE_COMPLETE', CreationTime: oldDate }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a stuck stack created within the grace period', async () => {
    mockSend.mockResolvedValueOnce({
      Stacks: [{ StackId: 'arn:aws:cloudformation:us-east-1:123:stack/s3/1', StackName: 's3', StackStatus: 'ROLLBACK_FAILED', CreationTime: new Date() }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeStacksCommand', async () => {
    mockSend.mockResolvedValueOnce({ Stacks: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeStacksCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
