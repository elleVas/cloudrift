// SPDX-License-Identifier: Apache-2.0
import { ConfigServiceClient, DescribeConfigurationRecorderStatusCommand } from '@aws-sdk/client-config-service';
import { AwsConfigNotEnabledScanner } from './aws-config-not-enabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-config-service');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ConfigServiceClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsConfigNotEnabledScanner();

describe('AwsConfigNotEnabledScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('config-not-enabled');
  });

  it('flags a region with no recording recorder', async () => {
    mockSend.mockResolvedValueOnce({ ConfigurationRecordersStatus: [{ name: 'default', recording: false }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('flags a region with no recorder at all', async () => {
    mockSend.mockResolvedValueOnce({ ConfigurationRecordersStatus: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a region with an actively recording recorder', async () => {
    mockSend.mockResolvedValueOnce({ ConfigurationRecordersStatus: [{ name: 'default', recording: true }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeConfigurationRecorderStatusCommand', async () => {
    mockSend.mockResolvedValueOnce({ ConfigurationRecordersStatus: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeConfigurationRecorderStatusCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
