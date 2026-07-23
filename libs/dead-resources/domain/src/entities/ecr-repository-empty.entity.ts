// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface EcrRepositoryEmptyProps {
  repositoryArn: string;
  repositoryName: string;
  region: AwsRegion;
  accountId: string;
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * ECR repository with zero images — genuinely $0 cost (storage is billed
 * per image, so no images means no charge), unlike `ecr-image-untagged`
 * (cost-waste domain: a dangling image still occupies billed storage).
 * `DescribeRepositories` doesn't return tags inline, so `tags` is always
 * `{}`.
 */
export class EcrRepositoryEmpty extends Entity<string> implements DeadResource {
  private readonly props: Readonly<EcrRepositoryEmptyProps>;

  constructor(props: EcrRepositoryEmptyProps) {
    super(props.repositoryArn);
    this.props = this.deepFreeze({ ...props });
  }

  get repositoryName(): string {
    return this.props.repositoryName;
  }

  get region(): AwsRegion {
    return this.props.region;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'ecr-repository-empty' {
    return 'ecr-repository-empty';
  }

  get hygieneReason(): string {
    return 'contains no images';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
