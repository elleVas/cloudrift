import { EC2Client, DescribeNetworkInterfacesCommand } from '@aws-sdk/client-ec2';
import { AwsEniOrphanedScanner } from './aws-eni-orphaned.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEniOrphanedScanner();

describe('AwsEniOrphanedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('eni-orphaned');
  });

  it('reports an available (unattached) ENI', async () => {
    mockSend.mockResolvedValueOnce({
      NetworkInterfaces: [
        {
          NetworkInterfaceId: 'eni-1',
          VpcId: 'vpc-1',
          SubnetId: 'subnet-1',
          Status: 'available',
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((eni) => eni.id)).toEqual(['eni-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBe(0);
  });

  it('filters by status=available server-side', async () => {
    mockSend.mockResolvedValueOnce({ NetworkInterfaces: [] });

    await scanner.scan(region);

    const args = (DescribeNetworkInterfacesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(args.Filters).toEqual([{ Name: 'status', Values: ['available'] }]);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys the client on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('EC2');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
