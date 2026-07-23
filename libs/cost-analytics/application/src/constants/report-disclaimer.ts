// SPDX-License-Identifier: Apache-2.0
// Deliberately separate text from `cloud-cost-application`'s
// `REPORT_DISCLAIMER` (waste estimates) and `dead-resources-application`'s
// `DEAD_RESOURCES_REPORT_DISCLAIMER` (hygiene findings): `cost`/`trend` pull
// real billing data straight from AWS Cost Explorer, no cloudrift-side
// estimate to caveat, just AWS's own finalization lag.
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
