// SPDX-License-Identifier: Apache-2.0
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { createLogger } from 'shared-kernel';

const httpLog = createLogger('cloudrift:http');

const smithyLogger = {
  trace: (...args: unknown[]) => httpLog.debug('trace', { args }),
  debug: (...args: unknown[]) => httpLog.debug('debug', { args }),
  info: (...args: unknown[]) => httpLog.debug('info', { args }),
  warn: (...args: unknown[]) => httpLog.debug('warn', { args }),
  error: (...args: unknown[]) => httpLog.debug('error', { args }),
};

const keepAlive = process.env.CLOUDRIFT_HTTP_KEEPALIVE !== 'false';

/**
 * Default options spread into every AWS SDK v3 client created by scanners
 * in this lib. Deliberate copy of `cloud-cost-infrastructure-aws-adapter`'s
 * own `createAwsClientConfig` (ADR-0078), not a shared import — keeps this
 * infrastructure lib decoupled from that one. The one-`NodeHttpHandler`-
 * per-client shape is not optional: see ADR-0064 for the production bug
 * (a shared handler destroyed mid-flight by a concurrent job's `finally`)
 * this specifically prevents. Revisit (move to `shared-kernel`) if a third
 * AWS-touching infra lib ever needs this too.
 *
 * Usage:
 * ```ts
 * const ec2 = new EC2Client({ ...createAwsClientConfig(), region: region.code });
 * ```
 */
export function createAwsClientConfig() {
  return {
    maxAttempts: 3,
    requestHandler: new NodeHttpHandler({
      connectionTimeout: 5_000,
      requestTimeout: 30_000,
      logger: smithyLogger,
      httpsAgent: { keepAlive },
    }),
  } as const;
}
