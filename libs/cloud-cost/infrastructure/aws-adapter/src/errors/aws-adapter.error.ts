// SPDX-License-Identifier: Apache-2.0
import { InfrastructureError, createLogger } from 'shared-kernel';

const logger = createLogger('cloudrift:scanner');

export class AwsAdapterError extends InfrastructureError {
  constructor(
    readonly service: string,
    override readonly cause: Error,
  ) {
    super(
      'AWS_ADAPTER_ERROR',
      `AWS ${service} adapter failed: ${cause.message}`,
    );
    // Diagnostic for the concurrency=12 "socket hang up" investigation
    // (ADR-0063): $metadata.attempts shows whether the SDK's own retries
    // (maxAttempts: 3) were exhausted before surfacing, which distinguishes
    // a transient blip from a sustained connection-level problem.
    const meta = cause as Error & { $metadata?: { attempts?: number }; code?: string };
    logger.debug(`${service} adapter error`, {
      name: cause.name,
      code: meta.code,
      attempts: meta.$metadata?.attempts,
    });
  }
}
