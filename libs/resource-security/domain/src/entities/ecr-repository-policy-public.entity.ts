// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface EcrRepositoryPolicyPublicProps {
  repositoryName: string;
  repositoryArn: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** ECR repository with a repository policy that grants pull/push to anyone (`Principal: "*"`, no restricting condition). */
export class EcrRepositoryPolicyPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<EcrRepositoryPolicyPublicProps>;

  constructor(props: EcrRepositoryPolicyPublicProps) {
    super(props.repositoryArn);
    this.props = this.deepFreeze({ ...props });
  }

  get repositoryName(): string {
    return this.props.repositoryName;
  }

  get repositoryArn(): string {
    return this.props.repositoryArn;
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

  get kind(): 'ecr-repository-policy-public' {
    return 'ecr-repository-policy-public';
  }

  get riskReason(): string {
    return 'repository policy grants access to any AWS principal';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
