// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeImagesCommand } from '@aws-sdk/client-ec2';
import { AwsAmiUnusedScanner } from './aws-ami-unused.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

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
const scanner = new AwsAmiUnusedScanner(mockPricing);
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

function queueNoInstancesNoTemplates(images: unknown[]): void {
  mockSend
    .mockResolvedValueOnce({ Images: images })
    .mockResolvedValueOnce({ Reservations: [] })
    .mockResolvedValueOnce({ LaunchTemplates: [] });
}

describe('AwsAmiUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ami-unused');
  });

  it('flags an old AMI not referenced by any instance or launch template', async () => {
    queueNoInstancesNoTemplates([
      {
        ImageId: 'ami-1',
        Name: 'my-ami',
        CreationDate: oldDate,
        BlockDeviceMappings: [{ Ebs: { VolumeSize: 20 } }],
      },
    ]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((a) => a.id)).toEqual(['ami-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(1, 2);
  });

  it('does not flag an AMI referenced by a running instance', async () => {
    mockSend
      .mockResolvedValueOnce({
        Images: [{ ImageId: 'ami-2', Name: 'used-ami', CreationDate: oldDate }],
      })
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [{ ImageId: 'ami-2', State: { Name: 'running' } }] }],
      })
      .mockResolvedValueOnce({ LaunchTemplates: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag an AMI referenced by a launch template latest version', async () => {
    mockSend
      .mockResolvedValueOnce({
        Images: [{ ImageId: 'ami-3', Name: 'lt-ami', CreationDate: oldDate }],
      })
      .mockResolvedValueOnce({ Reservations: [] })
      .mockResolvedValueOnce({ LaunchTemplates: [{ LaunchTemplateId: 'lt-1' }] })
      .mockResolvedValueOnce({
        LaunchTemplateVersions: [{ LaunchTemplateData: { ImageId: 'ami-3' } }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report an AMI tagged cloudrift:ignore', async () => {
    queueNoInstancesNoTemplates([
      { ImageId: 'ami-keep', Name: 'keep', CreationDate: oldDate, Tags: [{ Key: 'cloudrift:ignore', Value: '' }] },
    ]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeImagesCommand scoped to self-owned images', async () => {
    queueNoInstancesNoTemplates([]);

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeImagesCommand));
    const constructorArgs = (DescribeImagesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Owners).toEqual(['self']);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
