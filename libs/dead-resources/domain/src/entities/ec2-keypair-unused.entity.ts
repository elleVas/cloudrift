// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResource, DeadResourceSeverity } from '../dead-resource';

export interface Ec2KeyPairUnusedProps {
  keyPairId: string;
  keyName: string;
  region: AwsRegion;
  accountId: string;
  /** When the key pair was created (or imported) in EC2 — not always known, see the scanner. */
  createdAt: Date;
  detectedAt: Date;
  tags: Record<string, string>;
}

/**
 * EC2 key pair not referenced by any running/stopped instance's `KeyName`.
 * No AWS cost at all — a key pair is a free, standalone credential object —
 * so this is a pure hygiene flag: an unused key pair is dead weight that
 * widens the "who could still launch an instance with this" surface for no
 * benefit, but deleting it costs nothing to defer either.
 */
export class Ec2KeyPairUnused extends Entity<string> implements DeadResource {
  private readonly props: Readonly<Ec2KeyPairUnusedProps>;

  constructor(props: Ec2KeyPairUnusedProps) {
    super(props.keyPairId);
    this.props = this.deepFreeze({ ...props });
  }

  get keyName(): string {
    return this.props.keyName;
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

  get kind(): 'ec2-keypair-unused' {
    return 'ec2-keypair-unused';
  }

  get hygieneReason(): string {
    return 'not referenced by any running or stopped EC2 instance';
  }

  get severity(): DeadResourceSeverity {
    return 'info';
  }
}
