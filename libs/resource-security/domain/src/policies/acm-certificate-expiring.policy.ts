// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, notFlagged, type RiskVerdict } from './resource-security-policy';
import type { AcmCertificateExpiring } from '../entities/acm-certificate-expiring.entity';

/** Warn this many days before an issued certificate's `NotAfter` date. */
export const DEFAULT_CERT_EXPIRY_WARNING_DAYS = 30;

export class AcmCertificateExpiringPolicy extends ResourceSecurityPolicy<AcmCertificateExpiring> {
  constructor(
    options = {},
    private readonly warningDays = DEFAULT_CERT_EXPIRY_WARNING_DAYS,
  ) {
    super(options);
  }

  protected judge(resource: AcmCertificateExpiring, now: Date): RiskVerdict {
    const daysUntilExpiry = this.ageInDays(now, resource.notAfter);
    if (daysUntilExpiry > this.warningDays) {
      return notFlagged(`expires in ${Math.ceil(daysUntilExpiry)}d, outside the ${this.warningDays}d warning window`);
    }
    return flagged(resource.riskReason);
  }
}
