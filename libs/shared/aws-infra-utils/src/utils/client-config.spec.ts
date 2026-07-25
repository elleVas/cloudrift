// SPDX-License-Identifier: Apache-2.0
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createAwsClientConfig } from './client-config';

jest.mock('@smithy/node-http-handler');

describe('createAwsClientConfig', () => {
  it('enables retry with backoff', () => {
    expect(createAwsClientConfig().maxAttempts).toBe(3);
  });

  it('bounds every HTTP call so a hung connection cannot stall a scan forever', () => {
    createAwsClientConfig();
    const call = (NodeHttpHandler as jest.Mock).mock.calls.at(-1)[0];
    expect(call.connectionTimeout).toBe(10_000);
    expect(call.requestTimeout).toBe(30_000);
  });

  it('routes NodeHttpHandler diagnostics (e.g. socket-pool-at-capacity warnings) through a logger', () => {
    createAwsClientConfig();
    const call = (NodeHttpHandler as jest.Mock).mock.calls.at(-1)[0];
    expect(call.logger.warn).toBeInstanceOf(Function);
    expect(call.logger.debug).toBeInstanceOf(Function);
  });

  it('keeps HTTP keep-alive on by default', () => {
    createAwsClientConfig();
    const call = (NodeHttpHandler as jest.Mock).mock.calls.at(-1)[0];
    expect(call.httpsAgent).toEqual({ keepAlive: true });
  });

  it('builds a fresh NodeHttpHandler per call, so no two clients share a connection pool', () => {
    const before = (NodeHttpHandler as jest.Mock).mock.calls.length;
    const a = createAwsClientConfig();
    const b = createAwsClientConfig();

    expect(a.requestHandler).not.toBe(b.requestHandler);
    expect((NodeHttpHandler as jest.Mock).mock.calls.length).toBe(before + 2);
  });
});

describe('createAwsClientConfig with CLOUDRIFT_HTTP_KEEPALIVE=false', () => {
  const originalEnv = process.env.CLOUDRIFT_HTTP_KEEPALIVE;

  afterEach(() => {
    process.env.CLOUDRIFT_HTTP_KEEPALIVE = originalEnv;
  });

  it('disables keep-alive, for diagnosing stale-pooled-socket reuse', () => {
    process.env.CLOUDRIFT_HTTP_KEEPALIVE = 'false';
    jest.resetModules();
    const { createAwsClientConfig: reloadedFactory } = require('./client-config');
    reloadedFactory();
    const { NodeHttpHandler: ReloadedHandler } = require('@smithy/node-http-handler');
    const call = (ReloadedHandler as jest.Mock).mock.calls.at(-1)[0];
    expect(call.httpsAgent).toEqual({ keepAlive: false });
  });
});
