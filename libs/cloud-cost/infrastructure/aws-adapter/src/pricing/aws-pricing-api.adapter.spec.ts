// SPDX-License-Identifier: Apache-2.0
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsPricingApiAdapter, extractOnDemandUsd } from './aws-pricing-api.adapter';

// Mock only the client; keep GetProductsCommand real so `cmd.input` is populated.
jest.mock('@aws-sdk/client-pricing', () => {
  const actual = jest.requireActual('@aws-sdk/client-pricing');
  return { ...actual, PricingClient: jest.fn() };
});

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (PricingClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const euWest1 = AwsRegion.create('eu-west-1');
const unknownRegion = AwsRegion.create('mx-central-1'); // not in REGION_TO_LOCATION

/** Builds a PriceList JSON string with a single OnDemand USD price. */
function priceListItem(usd: string): string {
  return JSON.stringify({
    terms: {
      OnDemand: {
        offer1: {
          priceDimensions: {
            dim1: { pricePerUnit: { USD: usd } },
          },
        },
      },
    },
  });
}

/** Like `priceListItem`, but with `product.attributes` for `matchAttributes` specs (e.g. MSK). */
function priceListItemWithAttrs(usd: string, attributes: Record<string, string>): string {
  return JSON.stringify({
    product: { attributes },
    terms: {
      OnDemand: {
        offer1: {
          priceDimensions: {
            dim1: { pricePerUnit: { USD: usd } },
          },
        },
      },
    },
  });
}

describe('extractOnDemandUsd', () => {
  it('extracts a positive USD price from a JSON string', () => {
    expect(extractOnDemandUsd(priceListItem('0.0880000000'))).toEqual([0.088]);
  });

  it('extracts from an already-parsed object', () => {
    expect(extractOnDemandUsd(JSON.parse(priceListItem('0.045')))).toEqual([0.045]);
  });

  it('ignores zero-priced dimensions (free tiers)', () => {
    expect(extractOnDemandUsd(priceListItem('0.0000000000'))).toEqual([]);
  });

  it('returns [] for malformed input', () => {
    expect(extractOnDemandUsd('{ not json')).toEqual([]);
    expect(extractOnDemandUsd({})).toEqual([]);
  });
});

describe('AwsPricingApiAdapter.warmUp', () => {
  it('builds a PriceTable from unambiguous prices and converts hourly to monthly', async () => {
    // Every GetProducts call returns one product; NAT (hourly) → ×730.
    mockSend.mockImplementation((cmd: GetProductsCommand) => {
      const filters = cmd.input.Filters ?? [];
      const isNat = filters.some((f) => f.Value === 'NAT Gateway');
      const usd = isNat ? '0.0450000000' : '0.0880000000';
      return Promise.resolve({ PriceList: [priceListItem(usd)] });
    });

    const adapter = new AwsPricingApiAdapter();
    const result = await adapter.warmUp([euWest1]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prices = result.value['eu-west-1'];
    expect(prices['ebs-gp3']).toBe(0.088);
    expect(prices['nat-gateway']).toBe(+(0.045 * 730).toFixed(4)); // 32.85
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('omits a key when the filter is ambiguous (multiple distinct prices)', async () => {
    mockSend.mockResolvedValue({
      PriceList: [priceListItem('0.10'), priceListItem('0.20')],
    });

    const adapter = new AwsPricingApiAdapter();
    const result = await adapter.warmUp([euWest1]);

    expect(result.ok).toBe(true);
    // Every spec is ambiguous → no prices resolved → region omitted entirely.
    if (result.ok) expect(result.value['eu-west-1']).toBeUndefined();
  });

  it('skips regions with no known location mapping', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.08')] });

    const adapter = new AwsPricingApiAdapter();
    const result = await adapter.warmUp([unknownRegion]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns Result.fail (so the caller falls back to static) on SDK error', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied: pricing:GetProducts'));

    const adapter = new AwsPricingApiAdapter();
    const result = await adapter.warmUp([euWest1]);

    expect(result.ok).toBe(false);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});

describe('AwsPricingApiAdapter.getRdsInstancePricePerMonth', () => {
  it('resolves an unambiguous hourly price to monthly for a known engine', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.0960000000')] });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getRdsInstancePricePerMonth(euWest1, 'db.t3.medium', 'postgres', false);

    expect(price).toBe(+(0.096 * 730).toFixed(4));
    const filters = (mockSend.mock.calls[0][0] as GetProductsCommand).input.Filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'db.t3.medium' },
        { Type: 'TERM_MATCH', Field: 'databaseEngine', Value: 'PostgreSQL' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
      ]),
    );
  });

  it('returns undefined for an engine with no Pricing API mapping (e.g. Aurora)', async () => {
    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getRdsInstancePricePerMonth(euWest1, 'db.r5.large', 'aurora-postgresql', false);

    expect(price).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('returns undefined for a region with no known location mapping', async () => {
    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getRdsInstancePricePerMonth(unknownRegion, 'db.t3.medium', 'postgres', false);

    expect(price).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('AwsPricingApiAdapter.getElastiCacheNodePricePerMonth', () => {
  it('resolves an unambiguous hourly price to monthly for a known node type', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.0340000000')] });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getElastiCacheNodePricePerMonth(euWest1, 'cache.t3.medium');

    expect(price).toBe(+(0.034 * 730).toFixed(4));
    const filters = (mockSend.mock.calls[0][0] as GetProductsCommand).input.Filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'cache.t3.medium' },
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Cache Instance' },
      ]),
    );
  });

  it('returns undefined for a region with no known location mapping', async () => {
    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getElastiCacheNodePricePerMonth(unknownRegion, 'cache.t3.medium');

    expect(price).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('AwsPricingApiAdapter.getOpenSearchInstancePricePerMonth', () => {
  it('filters on the current "Amazon OpenSearch Service Instance" productFamily (renamed from the old "ES Instance")', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.0420000000')] });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getOpenSearchInstancePricePerMonth(euWest1, 't3.small.search');

    expect(price).toBe(+(0.042 * 730).toFixed(4));
    const filters = (mockSend.mock.calls[0][0] as GetProductsCommand).input.Filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 't3.small.search' },
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Amazon OpenSearch Service Instance' },
      ]),
    );
  });
});

describe('AwsPricingApiAdapter.getDocDbInstancePricePerMonth', () => {
  it('disambiguates the Standard vs I/O-Optimized storage tier via storageType', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.0920000000')] });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getDocDbInstancePricePerMonth(euWest1, 'db.t3.medium');

    expect(price).toBe(+(0.092 * 730).toFixed(4));
    const filters = (mockSend.mock.calls[0][0] as GetProductsCommand).input.Filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'db.t3.medium' },
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Database Instance' },
        { Type: 'TERM_MATCH', Field: 'storageType', Value: 'Standard' },
      ]),
    );
  });
});

describe('AwsPricingApiAdapter.getNeptuneInstancePricePerMonth', () => {
  it('disambiguates the Standard vs I/O Optimized storage tier via volumeType', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.1150000000')] });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getNeptuneInstancePricePerMonth(euWest1, 'db.t3.medium');

    expect(price).toBe(+(0.115 * 730).toFixed(4));
    const filters = (mockSend.mock.calls[0][0] as GetProductsCommand).input.Filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 'db.t3.medium' },
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Database Instance' },
        { Type: 'TERM_MATCH', Field: 'volumeType', Value: 'Standard' },
      ]),
    );
  });
});

describe('AwsPricingApiAdapter.getMqBrokerPricePerMonth', () => {
  it('strips the "mq." prefix and filters on the current "Broker Instances" productFamily (plural)', async () => {
    mockSend.mockResolvedValue({ PriceList: [priceListItem('0.0312000000')] });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getMqBrokerPricePerMonth(euWest1, 'mq.t3.micro', 'Single-AZ', 'ActiveMQ');

    expect(price).toBe(+(0.0312 * 730).toFixed(4));
    const filters = (mockSend.mock.calls[0][0] as GetProductsCommand).input.Filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { Type: 'TERM_MATCH', Field: 'instanceType', Value: 't3.micro' },
        { Type: 'TERM_MATCH', Field: 'productFamily', Value: 'Broker Instances' },
        { Type: 'TERM_MATCH', Field: 'deploymentOption', Value: 'Single-AZ' },
        { Type: 'TERM_MATCH', Field: 'brokerEngine', Value: 'ActiveMQ' },
      ]),
    );
  });
});

describe('AwsPricingApiAdapter.getMskBrokerPricePerMonth', () => {
  it('matches the broker instance type client-side via usagetype, since the Pricing API exposes no instanceType attribute for MSK', async () => {
    mockSend.mockResolvedValue({
      PriceList: [
        priceListItemWithAttrs('0.0526000000', { usagetype: 'EUC1-Kafka.t3.small' }),
        // Different instance type in the same response — must be excluded, not counted as ambiguity.
        priceListItemWithAttrs('0.1900000000', { usagetype: 'EUC1-Kafka.m5.large' }),
      ],
    });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getMskBrokerPricePerMonth(euWest1, 'kafka.t3.small');

    expect(price).toBe(+(0.0526 * 730).toFixed(4));
  });

  it('is case-insensitive when matching usagetype against the broker instance type', async () => {
    mockSend.mockResolvedValue({
      PriceList: [priceListItemWithAttrs('0.0526000000', { usagetype: 'EUC1-KAFKA.T3.SMALL' })],
    });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getMskBrokerPricePerMonth(euWest1, 'kafka.t3.small');

    expect(price).toBe(+(0.0526 * 730).toFixed(4));
  });

  it('returns undefined when the matching entries still disagree on price (genuine ambiguity)', async () => {
    mockSend.mockResolvedValue({
      PriceList: [
        priceListItemWithAttrs('0.0526000000', { usagetype: 'EUC1-Kafka.t3.small' }),
        priceListItemWithAttrs('0.0600000000', { usagetype: 'USE1-Kafka.t3.small' }),
      ],
    });

    const adapter = new AwsPricingApiAdapter();
    const price = await adapter.getMskBrokerPricePerMonth(euWest1, 'kafka.t3.small');

    expect(price).toBeUndefined();
  });
});
