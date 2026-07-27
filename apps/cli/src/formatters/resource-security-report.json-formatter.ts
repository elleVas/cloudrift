// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySummary } from 'resource-security-domain';
import { toResourceSecurityReportDto, type ResourceSecurityReportMeta } from 'resource-security-application';
import { buildConsoleUrl } from '../aws-console-link';

// `consoleUrl` is added here (CLI layer), not in the DTO itself — a link
// into the AWS web console is a presentation concern, not something the
// application layer's data contract should know about.
export function formatResourceSecurityReportAsJson(
  summary: ResourceSecuritySummary,
  meta: ResourceSecurityReportMeta,
): string {
  const dto = toResourceSecurityReportDto(summary, meta);
  return JSON.stringify(
    {
      ...dto,
      findings: dto.findings.map((finding) => ({
        ...finding,
        consoleUrl: buildConsoleUrl({ ...finding, region: finding.region ?? undefined }),
      })),
    },
    null,
    2,
  );
}
