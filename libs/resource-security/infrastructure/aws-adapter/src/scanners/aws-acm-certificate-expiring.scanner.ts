// SPDX-License-Identifier: Apache-2.0
import { ACMClient, ListCertificatesCommand, DescribeCertificateCommand, type CertificateSummary } from '@aws-sdk/client-acm';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, ResourceSecurityScannerPort, SecurityFinding } from 'resource-security-domain';
import { AcmCertificateExpiring, AcmCertificateExpiringPolicy } from 'resource-security-domain';
import { AwsAdapterError, paginate, mapWithConcurrency, createAwsClientConfig } from 'shared-aws-infra-utils';

const logger = createLogger('cloudrift:scanner');
/** Per-certificate `DescribeCertificate` calls in flight at once. */
const CERT_CHECK_CONCURRENCY = 8;

type CertWithArn = CertificateSummary & { CertificateArn: string };

/** Detects issued ACM certificates approaching (or past) their expiry date. */
export class AwsAcmCertificateExpiringScanner implements ResourceSecurityScannerPort {
  readonly kind = 'acm-certificate-expiring' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly credentials?: AwsCredentialIdentityProvider,
    private readonly policy = new AcmCertificateExpiringPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<SecurityFinding[]>> {
    const client = new ACMClient({ ...createAwsClientConfig(this.credentials), region: region.code });
    try {
      const rawCerts = await paginate<CertificateSummary>(async (cursor) => {
        const r = await client.send(new ListCertificatesCommand({ NextToken: cursor }));
        return { items: r.CertificateSummaryList ?? [], cursor: r.NextToken };
      });
      const validCerts = rawCerts.filter((c): c is CertWithArn => !!c.CertificateArn);
      const now = new Date();

      const candidates = await mapWithConcurrency(validCerts, CERT_CHECK_CONCURRENCY, async (cert) => {
        try {
          const { Certificate } = await client.send(new DescribeCertificateCommand({ CertificateArn: cert.CertificateArn }));
          if (Certificate?.Status !== 'ISSUED' || !Certificate.NotAfter) return undefined;

          return new AcmCertificateExpiring({
            certificateArn: cert.CertificateArn,
            domainName: Certificate.DomainName ?? cert.DomainName ?? cert.CertificateArn,
            notAfter: Certificate.NotAfter,
            region,
            accountId: this.accountId,
            detectedAt: now,
            tags: {},
          });
        } catch (err) {
          logger.debug('acm-certificate-expiring: skipping certificate after error', { certificateArn: cert.CertificateArn, error: err instanceof Error ? err.message : String(err) });
          return undefined;
        }
      });

      const results = candidates
        .filter((c): c is AcmCertificateExpiring => c !== undefined)
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ACM', err));
    } finally {
      client.destroy();
    }
  }
}
