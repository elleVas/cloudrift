// SPDX-License-Identifier: Apache-2.0
import { InfrastructureError } from 'shared-kernel';

export class AssumeRoleError extends InfrastructureError {
  override readonly cause: Error;

  constructor(
    readonly roleArn: string,
    cause: unknown,
  ) {
    const normalizedCause = cause instanceof Error ? cause : new Error(String(cause));
    super('ASSUME_ROLE_ERROR', `Failed to assume role ${roleArn}: ${normalizedCause.message}`);
    this.cause = normalizedCause;
  }
}
