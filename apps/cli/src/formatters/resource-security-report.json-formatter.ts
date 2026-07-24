// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySummary } from 'resource-security-domain';
import { toResourceSecurityReportDto, type ResourceSecurityReportMeta } from 'resource-security-application';

export function formatResourceSecurityReportAsJson(
  summary: ResourceSecuritySummary,
  meta: ResourceSecurityReportMeta,
): string {
  return JSON.stringify(toResourceSecurityReportDto(summary, meta), null, 2);
}
