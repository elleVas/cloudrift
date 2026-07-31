// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface LambdaFunctionPolicyPublicProps {
  functionName: string;
  functionArn: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** Lambda function with a resource-based policy that grants invoke/access to anyone (`Principal: "*"`, no restricting condition). */
export class LambdaFunctionPolicyPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<LambdaFunctionPolicyPublicProps>;

  constructor(props: LambdaFunctionPolicyPublicProps) {
    super(props.functionArn);
    this.props = this.deepFreeze({ ...props });
  }

  get functionName(): string {
    return this.props.functionName;
  }

  get functionArn(): string {
    return this.props.functionArn;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'lambda-function-policy-public' {
    return 'lambda-function-policy-public';
  }

  get riskReason(): string {
    return 'resource policy grants access to any AWS principal';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
