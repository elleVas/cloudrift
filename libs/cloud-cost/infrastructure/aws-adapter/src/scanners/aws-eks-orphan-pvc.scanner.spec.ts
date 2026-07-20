// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { EKSClient, ListClustersCommand } from '@aws-sdk/client-eks';
import { AwsEksOrphanPvcScanner } from './aws-eks-orphan-pvc.scanner';
import { AwsRegion, type PricingPort } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-ec2');
jest.mock('@aws-sdk/client-eks');

const mockEc2Send = jest.fn();
const mockEc2Destroy = jest.fn();
const mockEksSend = jest.fn();
const mockEksDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockEc2Send, destroy: mockEc2Destroy }));
  (EKSClient as jest.Mock).mockImplementation(() => ({ send: mockEksSend, destroy: mockEksDestroy }));
  mockEksSend.mockResolvedValue({ clusters: [] });
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEksOrphanPvcScanner(mockPricing);
const OLD_DATE = new Date('2025-01-01');

function pvcVolume(overrides: Record<string, unknown> = {}) {
  return {
    VolumeId: 'vol-pvc-1',
    Size: 20,
    VolumeType: 'gp3',
    State: 'available',
    CreateTime: OLD_DATE,
    Tags: [
      { Key: 'kubernetes.io/created-for/pvc/name', Value: 'data-pvc' },
      { Key: 'kubernetes.io/created-for/pvc/namespace', Value: 'app-ns' },
    ],
    ...overrides,
  };
}

describe('AwsEksOrphanPvcScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('eks-orphan-pvc');
  });

  it('reports an unattached PVC volume with no recoverable cluster tag', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [pvcVolume()] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vol-pvc-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(1.6, 2); // 20 GB * $0.08 gp3
  });

  it('reports an in-use volume whose owning cluster no longer exists', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Volumes: [
        pvcVolume({
          State: 'in-use',
          Tags: [
            { Key: 'kubernetes.io/created-for/pvc/name', Value: 'data-pvc' },
            { Key: 'kubernetes.io/created-for/pvc/namespace', Value: 'app-ns' },
            { Key: 'kubernetes.io/cluster/gone-cluster', Value: 'owned' },
          ],
        }),
      ],
    });
    mockEksSend.mockResolvedValueOnce({ clusters: ['other-cluster'] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vol-pvc-1']);
  });

  it('does not report an in-use volume whose owning cluster still exists', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Volumes: [
        pvcVolume({
          State: 'in-use',
          Tags: [
            { Key: 'kubernetes.io/created-for/pvc/name', Value: 'data-pvc' },
            { Key: 'kubernetes.io/created-for/pvc/namespace', Value: 'app-ns' },
            { Key: 'kubernetes.io/cluster/prod-cluster', Value: 'owned' },
          ],
        }),
      ],
    });
    mockEksSend.mockResolvedValueOnce({ clusters: ['prod-cluster'] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a just-created unattached volume within the grace period', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [pvcVolume({ CreateTime: new Date() })] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeVolumesCommand filtered on the PVC tag key', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    expect(mockEc2Send).toHaveBeenCalledWith(expect.any(DescribeVolumesCommand));
    const constructorArgs = (DescribeVolumesCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(constructorArgs.Filters).toEqual([
      { Name: 'tag-key', Values: ['kubernetes.io/created-for/pvc/name'] },
    ]);
    expect(mockEksSend).toHaveBeenCalledWith(expect.any(ListClustersCommand));
  });

  it('handles missing optional fields with safe defaults', async () => {
    mockEc2Send.mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-bare', Size: 5, State: 'available', CreateTime: OLD_DATE }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const vol = result.value[0] as import('cloud-cost-domain').EksOrphanPvc;
    expect(vol.volumeType).toBe('gp2');
    expect(vol.pvcName).toBe('unknown');
    expect(vol.pvcNamespace).toBe('unknown');
    expect(vol.clusterName).toBeUndefined();
  });

  it('destroys both clients after a successful call and after a failure', async () => {
    mockEc2Send.mockResolvedValueOnce({ Volumes: [] });
    await scanner.scan(region);
    expect(mockEc2Destroy).toHaveBeenCalledTimes(1);
    expect(mockEksDestroy).toHaveBeenCalledTimes(1);

    mockEc2Send.mockRejectedValueOnce(new Error('boom'));
    await scanner.scan(region);
    expect(mockEc2Destroy).toHaveBeenCalledTimes(2);
    expect(mockEksDestroy).toHaveBeenCalledTimes(2);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockEc2Send.mockRejectedValueOnce(new Error('Network error'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('EBS');
    }
  });

  it('follows NextToken across multiple volume pages and aggregates all volumes', async () => {
    mockEc2Send
      .mockResolvedValueOnce({ Volumes: [pvcVolume({ VolumeId: 'vol-page1' })], NextToken: 'cursor-2' })
      .mockResolvedValueOnce({ Volumes: [pvcVolume({ VolumeId: 'vol-page2' })] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((v) => v.id)).toEqual(['vol-page1', 'vol-page2']);
  });
});

// Ensures the mock pricing stays aligned with the real PricingPort.
const _typecheck: PricingPort = mockPricing;
void _typecheck;
