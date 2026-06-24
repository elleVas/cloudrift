// SPDX-License-Identifier: Apache-2.0
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { AwsLoadBalancerScanner } from './aws-load-balancer.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

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

const region = AwsRegion.create('us-east-1');
const scanner = new AwsLoadBalancerScanner(mockPricing);
const OLD_DATE = new Date('2025-01-01');

function mockBySendCommand(handlers: {
  loadBalancers?: unknown;
  targetGroups?: unknown;
  targetHealth?: unknown;
}) {
  mockSend.mockImplementation((command: unknown) => {
    if (command instanceof DescribeLoadBalancersCommand) {
      return Promise.resolve(handlers.loadBalancers ?? { LoadBalancers: [] });
    }
    if (command instanceof DescribeTargetGroupsCommand) {
      return Promise.resolve(handlers.targetGroups ?? { TargetGroups: [] });
    }
    if (command instanceof DescribeTargetHealthCommand) {
      return Promise.resolve(handlers.targetHealth ?? { TargetHealthDescriptions: [] });
    }
    return Promise.reject(new Error('unexpected command'));
  });
}

describe('AwsLoadBalancerScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('load-balancer');
  });

  it('reports an old LB whose target groups have no registered targets', async () => {
    mockBySendCommand({
      loadBalancers: {
        LoadBalancers: [
          { LoadBalancerArn: 'arn:lb-idle', LoadBalancerName: 'idle', Type: 'application', CreatedTime: OLD_DATE },
        ],
      },
      targetGroups: { TargetGroups: [{ TargetGroupArn: 'arn:tg-1' }] },
      targetHealth: { TargetHealthDescriptions: [] },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].id).toBe('arn:lb-idle');
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(16.2, 2);
  });

  it('does not report an LB with registered targets', async () => {
    mockBySendCommand({
      loadBalancers: {
        LoadBalancers: [
          { LoadBalancerArn: 'arn:lb-busy', LoadBalancerName: 'busy', Type: 'application', CreatedTime: OLD_DATE },
        ],
      },
      targetGroups: { TargetGroups: [{ TargetGroupArn: 'arn:tg-1' }] },
      targetHealth: { TargetHealthDescriptions: [{ Target: { Id: 'i-1' } }] },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a freshly created idle LB (grace period)', async () => {
    mockBySendCommand({
      loadBalancers: {
        LoadBalancers: [
          { LoadBalancerArn: 'arn:lb-new', LoadBalancerName: 'new', Type: 'application', CreatedTime: new Date() },
        ],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores gateway load balancers', async () => {
    mockBySendCommand({
      loadBalancers: {
        LoadBalancers: [
          { LoadBalancerArn: 'arn:lb-gw', LoadBalancerName: 'gw', Type: 'gateway', CreatedTime: OLD_DATE },
        ],
      },
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    // Nessuna chiamata ai target group per i tipi esclusi.
    expect(
      mockSend.mock.calls.filter(([c]) => c instanceof DescribeTargetGroupsCommand),
    ).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('ELB');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
