// SPDX-License-Identifier: Apache-2.0
import { toWasteReportDto } from 'cloud-cost-application';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { WastedResourcesSummary } from 'cloud-cost-domain';
import { buildConsoleUrl } from '../aws-console-link';

/**
 * Projects the summary into the serializable WasteReportDto: the same data
 * contract a future frontend or HTTP endpoint would expose. `consoleUrl` is
 * added here rather than in `toWasteReportDto` itself: it's a CLI/console
 * presentation concern (a link into the AWS web console), not something the
 * application layer's DTO contract should know about.
 */
export function formatWasteReportAsJson(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
): string {
  const dto = toWasteReportDto(summary, meta);
  return JSON.stringify(
    {
      ...dto,
      findings: dto.findings.map((finding) => ({
        ...finding,
        consoleUrl: buildConsoleUrl(finding),
      })),
    },
    null,
    2,
  );
}
