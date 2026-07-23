// SPDX-License-Identifier: Apache-2.0
import { ACMClient, ListCertificatesCommand, type CertificateSummary } from '@aws-sdk/client-acm';
import { Result } from 'shared-kernel';
import type { AwsRegion, DeadResourceScannerPort, DeadResource } from 'dead-resources-domain';
import { AcmCertificateUnused, AcmCertificateUnusedPolicy } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';

type CertificateSummaryWithId = CertificateSummary & { CertificateArn: string; DomainName: string; CreatedAt: Date };

/**
 * Detects ACM certificates not attached to any AWS resource. `InUse` is
 * computed by AWS itself and returned inline on `ListCertificates`'s
 * summaries — no need to cross-reference load balancers/CloudFront/API
 * Gateway/etc. individually. `ListCertificates` doesn't return tags inline,
 * so `tags` is always `{}`.
 */
export class AwsAcmCertificateUnusedScanner implements DeadResourceScannerPort {
  readonly kind = 'acm-certificate-unused' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy = new AcmCertificateUnusedPolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<DeadResource[]>> {
    const client = new ACMClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawCerts = await paginate<CertificateSummary>(async (cursor) => {
        const r = await client.send(new ListCertificatesCommand({ NextToken: cursor }));
        return { items: r.CertificateSummaryList ?? [], cursor: r.NextToken };
      });

      const now = new Date();
      const validCerts = rawCerts.filter(
        (c): c is CertificateSummaryWithId => !!c.CertificateArn && !!c.DomainName && !!c.CreatedAt,
      );

      const results = validCerts
        .filter((c) => c.InUse === false)
        .map(
          (c) =>
            new AcmCertificateUnused({
              certificateArn: c.CertificateArn,
              domainName: c.DomainName,
              region,
              accountId: this.accountId,
              createdAt: c.CreatedAt,
              detectedAt: now,
              tags: {},
            }),
        )
        .filter((c) => this.policy.evaluate(c, now).flagged);

      return Result.ok(results);
    } catch (err) {
      return Result.fail(new AwsAdapterError('ACM', err as Error));
    } finally {
      client.destroy();
    }
  }
}
