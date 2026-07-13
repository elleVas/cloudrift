// SPDX-License-Identifier: Apache-2.0
describe('AwsAdapterError', () => {
  const originalDebug = process.env.DEBUG;
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.resetModules();
    writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env.DEBUG = originalDebug;
    writeSpy.mockRestore();
  });

  it('wraps the cause with a service-prefixed message', () => {
    delete process.env.DEBUG;
    const { AwsAdapterError } = require('./aws-adapter.error');
    const err = new AwsAdapterError('EC2', new Error('boom'));

    expect(err.service).toBe('EC2');
    expect(err.message).toBe('AWS EC2 adapter failed: boom');
    expect(err.cause.message).toBe('boom');
  });

  it('is silent when DEBUG is unset', () => {
    delete process.env.DEBUG;
    const { AwsAdapterError } = require('./aws-adapter.error');
    new AwsAdapterError('EC2', new Error('boom'));

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('logs the cause name and retry metadata when DEBUG=cloudrift:*', () => {
    process.env.DEBUG = 'cloudrift:*';
    const { AwsAdapterError } = require('./aws-adapter.error');
    const cause = Object.assign(new Error('socket hang up'), {
      name: 'Error',
      code: 'ECONNRESET',
      $metadata: { attempts: 3 },
    });

    new AwsAdapterError('RDS', cause);

    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('"code":"ECONNRESET"'),
    );
    expect(writeSpy).toHaveBeenCalledWith(
      expect.stringContaining('"attempts":3'),
    );
  });
});
