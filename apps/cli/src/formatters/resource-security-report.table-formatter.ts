// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySummary } from 'resource-security-domain';
import { resourceSecurityReportFormatter } from './resource-security-report.formatter';

export function formatResourceSecurityReportAsTable(summary: ResourceSecuritySummary): string {
  return resourceSecurityReportFormatter.toTable(summary);
}
