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
