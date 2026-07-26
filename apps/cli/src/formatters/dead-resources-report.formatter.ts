// SPDX-License-Identifier: Apache-2.0
import { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META, groupByKind } from 'dead-resources-domain';
import type { DeadResourceKind, DeadResource, DeadResourceKindMap } from 'dead-resources-domain';
import { DEAD_RESOURCES_REPORT_DISCLAIMER } from 'dead-resources-application';
import { presenterFor, rowFor, recommendFor } from './dead-resource-presenters';
import { SeverityReportFormatter } from './severity-report.formatter';

class DeadResourcesReportFormatter extends SeverityReportFormatter<
  DeadResourceKind,
  DeadResource,
  DeadResourceKindMap[DeadResourceKind]
> {
  protected readonly kinds = DEAD_RESOURCE_KINDS;
  protected readonly reportTitle = 'AWS Dead/Unused Resources Report';
  protected readonly noFindingsMessage = 'No dead/unused resources found.';
  protected readonly disclaimer = DEAD_RESOURCES_REPORT_DISCLAIMER;

  protected kindLabel(kind: DeadResourceKind): string {
    return DEAD_RESOURCE_KIND_META[kind].label;
  }

  protected groupByKind(findings: DeadResource[]) {
    return groupByKind(findings);
  }

  protected presenterFor(kind: DeadResourceKind) {
    return presenterFor(kind);
  }

  protected rowFor(finding: DeadResourceKindMap[DeadResourceKind]): string[] {
    return rowFor(finding);
  }

  protected recommendFor(finding: DeadResourceKindMap[DeadResourceKind]): string {
    return recommendFor(finding);
  }
}

export const deadResourcesReportFormatter = new DeadResourcesReportFormatter();
