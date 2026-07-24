// SPDX-License-Identifier: Apache-2.0
import type { DeadResourcesSummary } from 'dead-resources-domain';
import { toDeadResourceReportDto, type DeadResourcesReportMeta } from 'dead-resources-application';

export function formatDeadResourcesReportAsJson(summary: DeadResourcesSummary, meta: DeadResourcesReportMeta): string {
  return JSON.stringify(toDeadResourceReportDto(summary, meta), null, 2);
}
