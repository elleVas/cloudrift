// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVpcsCommand, DescribeFlowLogsCommand } from '@aws-sdk/client-ec2';
import { AwsVpcFlowLogsDisabledScanner } from './aws-vpc-flow-logs-disabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsVpcFlowLogsDisabledScanner();

describe('AwsVpcFlowLogsDisabledScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('vpc-flow-logs-disabled');
  });

  it('flags a VPC with no active flow log', async () => {
    mockSend.mockResolvedValueOnce({ Vpcs: [{ VpcId: 'vpc-1' }] }).mockResolvedValueOnce({ FlowLogs: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a VPC with an active flow log', async () => {
    mockSend
      .mockResolvedValueOnce({ Vpcs: [{ VpcId: 'vpc-1' }] })
      .mockResolvedValueOnce({ FlowLogs: [{ ResourceId: 'vpc-1', FlowLogStatus: 'ACTIVE' }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('flags a VPC whose flow log exists but is not ACTIVE', async () => {
    mockSend
      .mockResolvedValueOnce({ Vpcs: [{ VpcId: 'vpc-1' }] })
      .mockResolvedValueOnce({ FlowLogs: [{ ResourceId: 'vpc-1', FlowLogStatus: 'ERROR' }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('sends DescribeVpcsCommand and DescribeFlowLogsCommand', async () => {
    mockSend.mockResolvedValueOnce({ Vpcs: [] }).mockResolvedValueOnce({ FlowLogs: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeVpcsCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeFlowLogsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
