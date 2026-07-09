// SPDX-License-Identifier: Apache-2.0
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchIdleScanner } from './cloudwatch-idle.scanner';
import { sumMetric, type MetricWindow } from '../utils/cloudwatch-metrics';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { AwsRegion, WastePolicy, type WasteVerdict, type WastedResource } from 'cloud-cost-domain';

jest.mock('@aws-sdk/client-cloudwatch');

const mockCwSend = jest.fn();
const mockCwDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CloudWatchClient as jest.Mock).mockImplementation(() => ({
    send: mockCwSend,
    destroy: mockCwDestroy,
  }));
});

interface FakeResource {
  id: string;
  type: string;
}

interface FakeEntity extends WastedResource {
  activity: number;
  price: number;
}

class FakePrimaryClient {
  destroy = jest.fn();
  list: FakeResource[];
  constructor(list: FakeResource[]) {
    this.list = list;
  }
}

class AlwaysWastePolicy extends WastePolicy<FakeEntity> {
  protected judge(): WasteVerdict {
    return { isWaste: true, reason: 'always' };
  }
}

class FakeScanner extends CloudWatchIdleScanner<FakePrimaryClient, FakeResource, number, FakeEntity> {
  readonly kind = 'ebs-idle' as const;
  protected readonly serviceLabel = 'Fake';
  createdClients: FakePrimaryClient[] = [];

  constructor(
    private readonly resources: FakeResource[],
    private readonly prices: Map<string, number> = new Map(),
    policy: WastePolicy<FakeEntity> = new AlwaysWastePolicy(),
    windowHours = 48,
  ) {
    super(policy, windowHours);
  }

  protected createPrimaryClient(): FakePrimaryClient {
    const client = new FakePrimaryClient(this.resources);
    this.createdClients.push(client);
    return client;
  }

  protected destroyPrimaryClient(client: FakePrimaryClient): void {
    client.destroy();
  }

  protected async listResources(client: FakePrimaryClient): Promise<FakeResource[]> {
    return client.list;
  }

  protected async fetchMetric(
    cw: CloudWatchClient,
    region: AwsRegion,
    resource: FakeResource,
    window: MetricWindow,
  ): Promise<number> {
    return sumMetric(cw, 'Fake/Namespace', 'FakeMetric', [{ Name: 'Id', Value: resource.id }], window);
  }

  protected async resolvePrices(): Promise<Map<string, number>> {
    return this.prices;
  }

  protected toEntity(resource: FakeResource, metric: number, prices: Map<string, number>): FakeEntity {
    return {
      id: resource.id,
      kind: 'ebs-idle',
      region: AwsRegion.create('us-east-1'),
      tags: {},
      costEstimate: { monthlyCostUsd: prices.get(resource.type) ?? 0, estimated: false },
      wasteReason: 'fake',
      activity: metric,
      price: prices.get(resource.type) ?? 0,
    };
  }
}

const region = AwsRegion.create('us-east-1');

describe('CloudWatchIdleScanner', () => {
  it('returns Result.ok([]) and skips CloudWatch entirely when there are no resources', async () => {
    const scanner = new FakeScanner([]);
    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual([]);
    expect(mockCwSend).not.toHaveBeenCalled();
  });

  it('fetches metrics and prices in parallel and builds entities from both', async () => {
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 7 }] });
    const scanner = new FakeScanner(
      [{ id: 'r-1', type: 'small' }],
      new Map([['small', 12.5]]),
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect((result.value[0] as FakeEntity).activity).toBe(7);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBe(12.5);
  });

  it('filters out entities the policy rejects', async () => {
    mockCwSend.mockResolvedValue({ Datapoints: [{ Sum: 0 }] });
    class NeverWastePolicy extends WastePolicy<FakeEntity> {
      protected judge(): WasteVerdict {
        return { isWaste: false, reason: 'never' };
      }
    }
    const scanner = new FakeScanner([{ id: 'r-1', type: 'small' }], new Map(), new NeverWastePolicy());

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('wraps a thrown error in Result.fail(AwsAdapterError) and still destroys both clients', async () => {
    class ThrowingScanner extends FakeScanner {
      protected async listResources(): Promise<FakeResource[]> {
        throw new Error('boom');
      }
    }
    const scanner = new ThrowingScanner([{ id: 'r-1', type: 'small' }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(AwsAdapterError);
      expect((result.error as AwsAdapterError).service).toBe('Fake');
    }
    expect(scanner.createdClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(mockCwDestroy).toHaveBeenCalledTimes(1);
  });
});
