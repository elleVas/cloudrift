// SPDX-License-Identifier: Apache-2.0
import { createLogger } from './logger';

describe('createLogger', () => {
  const originalDebug = process.env.DEBUG;
  let writeSpy: jest.SpyInstance;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env.DEBUG = originalDebug;
    writeSpy.mockRestore();
  });

  it('is silent when DEBUG is unset', () => {
    delete process.env.DEBUG;
    createLogger('cloudrift:scanner').debug('hello');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('is silent when DEBUG does not match the namespace', () => {
    process.env.DEBUG = 'other:*';
    createLogger('cloudrift:scanner').debug('hello');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('logs when DEBUG has an exact namespace match', () => {
    process.env.DEBUG = 'cloudrift:scanner';
    createLogger('cloudrift:scanner').debug('hello');
    expect(writeSpy).toHaveBeenCalledWith('cloudrift:scanner hello\n');
  });

  it('logs when DEBUG has a wildcard match', () => {
    process.env.DEBUG = 'cloudrift:*';
    createLogger('cloudrift:scanner:ebs-volume').debug('hello');
    expect(writeSpy).toHaveBeenCalledWith('cloudrift:scanner:ebs-volume hello\n');
  });

  it('logs when DEBUG is the bare wildcard', () => {
    process.env.DEBUG = '*';
    createLogger('anything').debug('hello');
    expect(writeSpy).toHaveBeenCalledWith('anything hello\n');
  });

  it('supports multiple comma-separated patterns', () => {
    process.env.DEBUG = 'other:*,cloudrift:*';
    createLogger('cloudrift:scanner').debug('hello');
    expect(writeSpy).toHaveBeenCalledWith('cloudrift:scanner hello\n');
  });

  it('serializes meta as JSON after the message', () => {
    process.env.DEBUG = '*';
    createLogger('cloudrift:scanner').debug('scan done', { durationMs: 42, region: 'us-east-1' });
    expect(writeSpy).toHaveBeenCalledWith('cloudrift:scanner scan done {"durationMs":42,"region":"us-east-1"}\n');
  });
});
