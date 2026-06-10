import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { AwsLoadBalancerRepositoryAdapter } from './aws-load-balancer.repository.adapter';
import { AwsRegion, type PricingPort } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-elastic-load-balancing-v2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ElasticLoadBalancingV2Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const mockPricing: PricingPort = {
  getEbsVolumePricePerGbMonth: () => 0.08,
  getEbsSnapshotPricePerGbMonth: () => 0.05,
  getElasticIpPricePerMonth: () => 3.6,
  getRdsStoragePricePerGbMonth: () => 0.115,
  getLoadBalancerPricePerMonth: () => 16.2,
  getNatGatewayPricePerMonth: () => 32.4,
};

const region = AwsRegion.create('us-east-1');
const adapter = new AwsLoadBalancerRepositoryAdapter(mockPricing);

const ALB_ARN = 'arn:aws:elasticloadbalancing:us-east-1:123:loadbalancer/app/my-alb/abc';
const TG_ARN = 'arn:aws:elasticloadbalancing:us-east-1:123:targetgroup/my-tg/xyz';

function mockLbResponse(lbs: object[]) {
  return { LoadBalancers: lbs };
}

function mockTgResponse(tgs: object[]) {
  return { TargetGroups: tgs };
}

function mockHealthResponse(targets: object[]) {
  return { TargetHealthDescriptions: targets };
}

describe('AwsLoadBalancerRepositoryAdapter', () => {
  it('returns empty list when no load balancers exist', async () => {
    mockSend.mockResolvedValueOnce(mockLbResponse([]));
    const result = await adapter.findIdleLoadBalancers(region);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns LB with no target groups as idle', async () => {
    mockSend
      .mockResolvedValueOnce(mockLbResponse([
        { LoadBalancerArn: ALB_ARN, LoadBalancerName: 'my-alb', Type: 'application', CreatedTime: new Date() },
      ]))
      .mockResolvedValueOnce(mockTgResponse([]));

    const result = await adapter.findIdleLoadBalancers(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe(ALB_ARN);
    expect(result.value[0].name).toBe('my-alb');
    expect(result.value[0].type).toBe('application');
  });

  it('returns LB whose target group has zero registered targets as idle', async () => {
    mockSend
      .mockResolvedValueOnce(mockLbResponse([
        { LoadBalancerArn: ALB_ARN, LoadBalancerName: 'my-alb', Type: 'application', CreatedTime: new Date() },
      ]))
      .mockResolvedValueOnce(mockTgResponse([{ TargetGroupArn: TG_ARN }]))
      .mockResolvedValueOnce(mockHealthResponse([]));

    const result = await adapter.findIdleLoadBalancers(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
  });

  it('excludes LBs that have registered targets', async () => {
    mockSend
      .mockResolvedValueOnce(mockLbResponse([
        { LoadBalancerArn: ALB_ARN, LoadBalancerName: 'my-alb', Type: 'application', CreatedTime: new Date() },
      ]))
      .mockResolvedValueOnce(mockTgResponse([{ TargetGroupArn: TG_ARN }]))
      .mockResolvedValueOnce(mockHealthResponse([
        { Target: { Id: 'i-123', Port: 80 }, TargetHealth: { State: 'healthy' } },
      ]));

    const result = await adapter.findIdleLoadBalancers(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('excludes gateway-type load balancers', async () => {
    mockSend.mockResolvedValueOnce(mockLbResponse([
      { LoadBalancerArn: ALB_ARN, LoadBalancerName: 'my-gwlb', Type: 'gateway', CreatedTime: new Date() },
    ]));

    const result = await adapter.findIdleLoadBalancers(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it('destroys the client after the call', async () => {
    mockSend.mockResolvedValueOnce(mockLbResponse([]));
    await adapter.findIdleLoadBalancers(region);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Unauthorized'));
    const result = await adapter.findIdleLoadBalancers(region);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('ELB');
    }
  });

  it('sends DescribeLoadBalancersCommand first', async () => {
    mockSend.mockResolvedValueOnce(mockLbResponse([]));
    await adapter.findIdleLoadBalancers(region);
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeLoadBalancersCommand));
  });

  it('follows NextMarker across multiple DescribeLoadBalancers pages', async () => {
    const lb1 = { LoadBalancerArn: ALB_ARN + '1', LoadBalancerName: 'alb-1', Type: 'application', CreatedTime: new Date() };
    const lb2 = { LoadBalancerArn: ALB_ARN + '2', LoadBalancerName: 'alb-2', Type: 'application', CreatedTime: new Date() };

    mockSend
      .mockResolvedValueOnce({ LoadBalancers: [lb1], NextMarker: 'marker-2' })
      .mockResolvedValueOnce({ LoadBalancers: [lb2] })
      .mockResolvedValueOnce(mockTgResponse([]))   // TG for lb1
      .mockResolvedValueOnce(mockTgResponse([]));  // TG for lb2

    const result = await adapter.findIdleLoadBalancers(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    const secondCallArgs = (DescribeLoadBalancersCommand as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.Marker).toBe('marker-2');
  });
});
