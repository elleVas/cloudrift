// SPDX-License-Identifier: Apache-2.0
import { RESOURCE_SECURITY_KINDS, RESOURCE_SECURITY_KIND_META, groupByKind } from 'resource-security-domain';
import type { ResourceSecurityKind, SecurityFinding, ResourceSecurityKindMap } from 'resource-security-domain';
import { RESOURCE_SECURITY_REPORT_DISCLAIMER } from 'resource-security-application';
import { presenterFor, rowFor, recommendFor } from './resource-security-presenters';
import { SeverityReportFormatter } from './severity-report.formatter';

class ResourceSecurityReportFormatter extends SeverityReportFormatter<
  ResourceSecurityKind,
  SecurityFinding,
  ResourceSecurityKindMap[ResourceSecurityKind]
> {
  protected readonly kinds = RESOURCE_SECURITY_KINDS;
  protected readonly reportTitle = 'AWS Resource Security Report';
  protected readonly noFindingsMessage = 'No security-posture risks found.';
  protected readonly disclaimer = RESOURCE_SECURITY_REPORT_DISCLAIMER;

  protected kindLabel(kind: ResourceSecurityKind): string {
    return RESOURCE_SECURITY_KIND_META[kind].label;
  }

  protected groupByKind(findings: SecurityFinding[]) {
    return groupByKind(findings);
  }

  protected presenterFor(kind: ResourceSecurityKind) {
    return presenterFor(kind);
  }

  protected rowFor(finding: ResourceSecurityKindMap[ResourceSecurityKind]): string[] {
    return rowFor(finding);
  }

  protected recommendFor(finding: ResourceSecurityKindMap[ResourceSecurityKind]): string {
    return recommendFor(finding);
  }
}

export const resourceSecurityReportFormatter = new ResourceSecurityReportFormatter();
