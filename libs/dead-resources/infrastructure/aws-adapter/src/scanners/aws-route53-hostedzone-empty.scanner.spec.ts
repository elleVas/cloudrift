// SPDX-License-Identifier: Apache-2.0
import { Route53Client, ListHostedZonesCommand } from '@aws-sdk/client-route-53';
import { AwsRoute53HostedZoneEmptyScanner } from './aws-route53-hostedzone-empty.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-route-53');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (Route53Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsRoute53HostedZoneEmptyScanner();

describe('AwsRoute53HostedZoneEmptyScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('route53-hostedzone-empty');
    expect(scanner.scope).toBe('global');
  });

  it('flags a hosted zone with only the default NS/SOA records', async () => {
    mockSend.mockResolvedValueOnce({
      HostedZones: [{ Id: '/hostedzone/Z1', Name: 'empty.example.com.', ResourceRecordSetCount: 2 }],
      IsTruncated: false,
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((z) => z.id)).toEqual(['Z1']);
  });

  it('does not flag a hosted zone with real records', async () => {
    mockSend.mockResolvedValueOnce({
      HostedZones: [{ Id: '/hostedzone/Z2', Name: 'active.example.com.', ResourceRecordSetCount: 5 }],
      IsTruncated: false,
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListHostedZonesCommand', async () => {
    mockSend.mockResolvedValueOnce({ HostedZones: [], IsTruncated: false });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListHostedZonesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
