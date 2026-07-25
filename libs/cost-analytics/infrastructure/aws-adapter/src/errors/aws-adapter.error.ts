// SPDX-License-Identifier: Apache-2.0
import { InfrastructureError, createLogger } from 'shared-kernel';

const logger = createLogger('cloudrift:scanner');

export class AwsAdapterError extends InfrastructureError {
  override readonly cause: Error;

  constructor(
    readonly service: string,
    cause: unknown,
  ) {
    const normalizedCause = cause instanceof Error ? cause : new Error(String(cause));
    super(
      'AWS_ADAPTER_ERROR',
      `AWS ${service} adapter failed: ${normalizedCause.message}`,
    );
    this.cause = normalizedCause;
    // Diagnostic for the concurrency=12 "socket hang up" investigation
    // (ADR-0063): $metadata.attempts shows whether the SDK's own retries
    // (maxAttempts: 3) were exhausted before surfacing, which distinguishes
    // a transient blip from a sustained connection-level problem.
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
