// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface SecretsManagerSecretPolicyPublicProps {
  secretArn: string;
  secretName: string;
  region: AwsRegion;
  accountId: string;
  detectedAt: Date;
  tags: Record<string, string>;
}

/** Secrets Manager secret with a resource policy that grants access to anyone (`Principal: "*"`, no restricting condition). */
export class SecretsManagerSecretPolicyPublic extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<SecretsManagerSecretPolicyPublicProps>;

  constructor(props: SecretsManagerSecretPolicyPublicProps) {
    super(props.secretArn);
    this.props = this.deepFreeze({ ...props });
  }

  get secretArn(): string {
    return this.props.secretArn;
  }

  get secretName(): string {
    return this.props.secretName;
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

  get kind(): 'secrets-manager-secret-policy-public' {
    return 'secrets-manager-secret-policy-public';
  }

  get riskReason(): string {
    return 'resource policy grants access to any AWS principal';
  }

  get severity(): ResourceSecuritySeverity {
    return 'critical';
  }
}
