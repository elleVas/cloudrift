// SPDX-License-Identifier: Apache-2.0
import { DomainError, Result, ValueObject } from 'shared-kernel';

interface AwsRegionProps {
  code: string;
}

/** Every recognized AWS region code — the authoritative list `AwsRegion.parse` validates against, and the one source consumers (e.g. the CLI's interactive region picker) build their own options from instead of duplicating it. */
export const AWS_REGION_CODES: readonly string[] = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ca-central-1', 'ca-west-1',
  'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3',
  'eu-north-1', 'eu-south-1', 'eu-south-2',
  'ap-east-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4', 'ap-southeast-5',
  'ap-south-1', 'ap-south-2',
  'me-south-1', 'me-central-1',
  'af-south-1',
  'sa-east-1',
  'us-gov-east-1', 'us-gov-west-1',
  'cn-north-1', 'cn-northwest-1',
  'il-central-1',
  'mx-central-1',
];

const VALID_AWS_REGIONS = new Set(AWS_REGION_CODES);

export class InvalidAwsRegionError extends DomainError {
  constructor(code: string) {
    super(
      'INVALID_AWS_REGION',
      `Invalid AWS region: "${code}". Must be a recognized AWS region code (e.g. us-east-1, eu-west-1).`,
    );
  }
}

export class AwsRegion extends ValueObject<AwsRegionProps> {
  /** Result-based factory: use for external input (CLI, API). */
  static parse(code: string): Result<AwsRegion, InvalidAwsRegionError> {
    if (!VALID_AWS_REGIONS.has(code)) {
      return Result.fail(new InvalidAwsRegionError(code));
    }
    return Result.ok(new AwsRegion({ code }));
  }

  /** Throwing factory: use only for codes known at compile time (tests, fixtures). */
  static create(code: string): AwsRegion {
    const result = AwsRegion.parse(code);
    if (!result.ok) throw result.error;
    return result.value;
  }

  get code(): string {
    return this.props.code;
  }

  override toString(): string {
    return this.props.code;
  }
}
