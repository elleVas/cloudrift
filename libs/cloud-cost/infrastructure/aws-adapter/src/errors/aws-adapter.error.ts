import { DomainError } from 'shared-kernel';

export class AwsAdapterError extends DomainError {
  constructor(
    readonly service: string,
    override readonly cause: Error,
  ) {
    super(
      'AWS_ADAPTER_ERROR',
      `AWS ${service} adapter failed: ${cause.message}`,
    );
  }
}
