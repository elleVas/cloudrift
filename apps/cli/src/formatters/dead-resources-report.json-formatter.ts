// SPDX-License-Identifier: Apache-2.0
import type { DeadResourcesSummary } from 'dead-resources-domain';
import { toDeadResourceReportDto, type DeadResourcesReportMeta } from 'dead-resources-application';
import { buildConsoleUrl } from '../aws-console-link';

// `consoleUrl` is added here (CLI layer), not in the DTO itself — a link
// into the AWS web console is a presentation concern, not something the
// application layer's data contract should know about.
export function formatDeadResourcesReportAsJson(summary: DeadResourcesSummary, meta: DeadResourcesReportMeta): string {
  const dto = toDeadResourceReportDto(summary, meta);
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
