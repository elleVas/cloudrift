// SPDX-License-Identifier: Apache-2.0

/**
 * Whether every `CLOUDRIFT_SMTP_*` env var email sending needs is already
 * set. Slack/webhook notifications are deliberately CI/script-only (see
 * `dispatchNotifications`) and never prompted for here — a human running the
 * interactive wizard is already looking at the report on their own screen;
 * emailing it to someone else is the one channel worth offering in the
 * moment, and only when SMTP is already configured (this wizard never walks
 * anyone through setting it up).
 */
function isSmtpConfigured(): boolean {
  return !!(
    process.env.CLOUDRIFT_SMTP_HOST &&
    process.env.CLOUDRIFT_SMTP_PORT &&
    process.env.CLOUDRIFT_SMTP_USER &&
    process.env.CLOUDRIFT_SMTP_PASSWORD &&
    process.env.CLOUDRIFT_SMTP_FROM
  );
}

/**
 * Offers to email the report summary, only when SMTP is already configured.
 * Returns the recipient address, or `undefined` if SMTP isn't configured,
 * the user declines, or they cancel — none of which should abort the scan
 * itself, unlike cancelling the regions/scanner/output prompts earlier in
 * the same flow.
 */
export async function promptEmailNotification(): Promise<string | undefined> {
  if (!isSmtpConfigured()) return undefined;

  const { confirm, text, isCancel } = await import('@clack/prompts');

  const wantsEmail = await confirm({ message: 'Email this report to someone?', initialValue: false });
  if (isCancel(wantsEmail) || !wantsEmail) return undefined;

  const address = await text({
    message: 'Recipient email address:',
    validate: (value) => (value?.includes('@') ? undefined : 'Enter a valid email address.'),
  });
  if (isCancel(address)) return undefined;

  return address;
}
