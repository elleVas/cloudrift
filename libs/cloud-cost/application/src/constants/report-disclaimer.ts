// SPDX-License-Identifier: Apache-2.0
export const REPORT_DISCLAIMER =
  'cloudrift is a read-only analysis tool: it reports estimated waste and recommendations ' +
  'only — it never deletes, modifies, or stops any AWS resource. All findings should be ' +
  'validated by your infrastructure team before taking action. The maintainers assume no ' +
  'liability for actions taken based on this report.';

// `cost`/`trend` pull real billing data straight from AWS Cost Explorer —
// there's no cloudrift-side pricing estimate to caveat, just AWS's own
// finalization lag, so this disclaimer is deliberately different from
// REPORT_DISCLAIMER above (which is about cloudrift's own waste estimates).
export const COST_REPORT_DISCLAIMER =
  'Figures come directly from the AWS Cost Explorer API for this account. AWS may still ' +
  'finalize/adjust the most recent 24-48h of billing data, and the current period always ' +
  'includes an estimate for the still-open day. Treat totals as directional until the ' +
  'billing period closes.';

export const REPORT_CONTACT = {
  email: 'raffaelevasini@gmail.com',
  github: 'https://github.com/elleVas',
  linkedin: 'https://www.linkedin.com/in/raffaele-vasini-87937470/',
} as const;
