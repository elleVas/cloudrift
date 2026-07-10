// SPDX-License-Identifier: Apache-2.0
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { AWS_CLIENT_DEFAULTS } from './client-config';

jest.mock('@smithy/node-http-handler');

describe('AWS_CLIENT_DEFAULTS', () => {
  it('enables retry with backoff', () => {
    expect(AWS_CLIENT_DEFAULTS.maxAttempts).toBe(3);
  });

  it('bounds every HTTP call so a hung connection cannot stall a scan forever', () => {
    expect(NodeHttpHandler).toHaveBeenCalledWith({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
    });
  });
});
