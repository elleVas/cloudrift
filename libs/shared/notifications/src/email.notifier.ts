// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { NotificationSummary } from './types';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

function buildEmailBody(summary: NotificationSummary): string {
  const lines = [summary.title, ''];
  if (summary.countBySeverity) {
    const { critical, warning, info } = summary.countBySeverity;
    lines.push(`${critical} critical, ${warning} warning, ${info} info — account ${summary.accountId}`, '');
  } else {
    lines.push(`Account: ${summary.accountId}`, '');
  }
  lines.push(...summary.lines.map((line) => `- ${line}`));
  return lines.join('\n');
}

/**
 * Sends a plain-text summary email via SMTP (`nodemailer`). Same
 * never-throws, best-effort contract as the other notifiers — a broken SMTP
 * config shouldn't fail the scan it's reporting on.
 */
export async function sendEmailNotification(config: SmtpConfig, to: string, summary: NotificationSummary): Promise<Result<void>> {
  try {
    const { createTransport } = await import('nodemailer');
    const transport = createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });
    await transport.sendMail({
      from: config.from,
      to,
      subject: summary.title,
      text: buildEmailBody(summary),
    });
    return Result.ok(undefined);
  } catch (err) {
    return Result.fail(err instanceof Error ? err : new Error(String(err)));
  }
}
