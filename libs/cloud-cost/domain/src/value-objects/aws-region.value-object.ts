import { ValueObject } from 'shared-kernel';

interface AwsRegionProps {
  code: string;
}

const VALID_AWS_REGIONS = new Set([
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
]);

export class AwsRegion extends ValueObject<AwsRegionProps> {
  static create(code: string): AwsRegion {
    if (!VALID_AWS_REGIONS.has(code)) {
      throw new Error(
        `Invalid AWS region: "${code}". Must be a recognized AWS region code (e.g. us-east-1, eu-west-1).`,
      );
    }
    return new AwsRegion({ code });
  }

  get code(): string {
    return this.props.code;
  }

  override toString(): string {
    return this.props.code;
  }
}
