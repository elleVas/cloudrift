// SPDX-License-Identifier: Apache-2.0
import { InfrastructureError, createLogger } from 'shared-kernel';

const logger = createLogger('cloudrift:scanner');

/** Deliberate copy of `dead-resources-infrastructure-aws-adapter`'s own `AwsAdapterError` (ADR-0078). */
export class AwsAdapterError extends InfrastructureError {
  override readonly cause: Error;

  constructor(
    readonly service: string,
    cause: unknown,
  ) {
    const normalizedCause = cause instanceof Error ? cause : new Error(String(cause));
    super('AWS_ADAPTER_ERROR', `AWS ${service} adapter failed: ${normalizedCause.message}`);
    this.cause = normalizedCause;
    // Cast, not narrowed: the AWS SDK attaches `$metadata`/`code` to thrown
    // errors only at runtime — its public `Error` type doesn't declare them,
    // so there's no structural information to check for.
    const meta = normalizedCause as Error & { $metadata?: { attempts?: number }; code?: string };
    logger.debug(`${service} adapter error`, {
      name: normalizedCause.name,
      code: meta.code,
      attempts: meta.$metadata?.attempts,
    });
  }
}
