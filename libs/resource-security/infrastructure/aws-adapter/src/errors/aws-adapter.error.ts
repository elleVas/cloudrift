// SPDX-License-Identifier: Apache-2.0
import { InfrastructureError, createLogger } from 'shared-kernel';

const logger = createLogger('cloudrift:scanner');

/** Deliberate copy of `dead-resources-infrastructure-aws-adapter`'s own `AwsAdapterError` (ADR-0078). */
export class AwsAdapterError extends InfrastructureError {
  constructor(
    readonly service: string,
    override readonly cause: Error,
  ) {
    super('AWS_ADAPTER_ERROR', `AWS ${service} adapter failed: ${cause.message}`);
    const meta = cause as Error & { $metadata?: { attempts?: number }; code?: string };
    logger.debug(`${service} adapter error`, {
      name: cause.name,
      code: meta.code,
      attempts: meta.$metadata?.attempts,
    });
  }
}
