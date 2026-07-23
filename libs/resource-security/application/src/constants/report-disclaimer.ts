// SPDX-License-Identifier: Apache-2.0
// Deliberately separate text from `dead-resources-application`'s
// `DEAD_RESOURCES_REPORT_DISCLAIMER`: this domain reports security-posture
// risk findings, not hygiene/cost findings.
export const RESOURCE_SECURITY_REPORT_DISCLAIMER =
  'cloudrift is a read-only analysis tool: it reports security-posture findings and recommendations ' +
  'only — it never deletes, modifies, or stops any AWS resource, and does not perform any exploitation ' +
  'or active testing. All findings should be validated by your infrastructure/security team before ' +
  'taking action. The maintainers assume no liability for actions taken based on this report.';
