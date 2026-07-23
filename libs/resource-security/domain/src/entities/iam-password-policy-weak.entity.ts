// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { SecurityFinding, ResourceSecuritySeverity } from '../resource-security';

export interface IamPasswordPolicyWeakProps {
  accountId: string;
  /** False when `iam:GetAccountPasswordPolicy` returns `NoSuchEntityException` — no policy configured at all. */
  exists: boolean;
  minimumPasswordLength?: number;
  requireSymbols?: boolean;
  requireNumbers?: boolean;
  requireUppercaseCharacters?: boolean;
  requireLowercaseCharacters?: boolean;
  /** 0/undefined means "no maximum" — passwords never expire. */
  maxPasswordAge?: number;
  passwordReusePrevention?: number;
  detectedAt: Date;
  tags: Record<string, string>;
}

const MIN_LENGTH_BASELINE = 14;
const MAX_AGE_BASELINE_DAYS = 90;
const REUSE_PREVENTION_BASELINE = 24;

/**
 * Account-wide finding: the account password policy is missing, or falls
 * short of the CIS AWS Foundations Benchmark baseline (1.8/1.9: minimum
 * length 14, all four character classes required, max age <= 90 days,
 * reuse prevention >= 24).
 */
export class IamPasswordPolicyWeak extends Entity<string> implements SecurityFinding {
  private readonly props: Readonly<IamPasswordPolicyWeakProps>;

  constructor(props: IamPasswordPolicyWeakProps) {
    super(props.accountId);
    this.props = this.deepFreeze({ ...props });
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get exists(): boolean {
    return this.props.exists;
  }

  get detectedAt(): Date {
    return this.props.detectedAt;
  }

  get tags(): Record<string, string> {
    return this.props.tags;
  }

  get kind(): 'iam-password-policy-weak' {
    return 'iam-password-policy-weak';
  }

  private get weaknesses(): string[] {
    if (!this.props.exists) return [];
    const reasons: string[] = [];
    if ((this.props.minimumPasswordLength ?? 0) < MIN_LENGTH_BASELINE) reasons.push(`minimum length below ${MIN_LENGTH_BASELINE}`);
    if (!this.props.requireSymbols) reasons.push('symbols not required');
    if (!this.props.requireNumbers) reasons.push('numbers not required');
    if (!this.props.requireUppercaseCharacters) reasons.push('uppercase characters not required');
    if (!this.props.requireLowercaseCharacters) reasons.push('lowercase characters not required');
    if (!this.props.maxPasswordAge || this.props.maxPasswordAge > MAX_AGE_BASELINE_DAYS) {
      reasons.push(`max password age not set to <= ${MAX_AGE_BASELINE_DAYS} days`);
    }
    if ((this.props.passwordReusePrevention ?? 0) < REUSE_PREVENTION_BASELINE) {
      reasons.push(`password reuse prevention below ${REUSE_PREVENTION_BASELINE}`);
    }
    return reasons;
  }

  get isWeak(): boolean {
    return !this.props.exists || this.weaknesses.length > 0;
  }

  get riskReason(): string {
    if (!this.props.exists) return 'no account password policy configured';
    return this.weaknesses.length > 0 ? `weak password policy: ${this.weaknesses.join(', ')}` : 'password policy meets CIS baseline';
  }

  get severity(): ResourceSecuritySeverity {
    return 'warning';
  }
}
