// SPDX-License-Identifier: Apache-2.0
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchNotifications, topFindingLines } from './notifications';
import type { NotificationSummary } from 'shared-notifications';
import * as notifiers from 'shared-notifications';

jest.mock('shared-notifications', () => ({
  sendSlackNotification: jest.fn(),
  sendWebhookNotification: jest.fn(),
  sendEmailNotification: jest.fn(),
  sendGithubPrComment: jest.fn(),
}));

const summary: NotificationSummary = {
  title: 'cloudrift resource-security — 1 critical finding',
  domain: 'resource-security',
  accountId: '123456789012',
  generatedAt: new Date('2026-07-31'),
  countBySeverity: { critical: 1, warning: 0, info: 0 },
  lines: ['S3 bucket "my-bucket" is public'],
};

const ENV_KEYS = [
  'SLACK_WEBHOOK_URL',
  'CLOUDRIFT_WEBHOOK_URL',
  'CLOUDRIFT_SMTP_HOST',
  'CLOUDRIFT_SMTP_PORT',
  'CLOUDRIFT_SMTP_USER',
  'CLOUDRIFT_SMTP_PASSWORD',
  'CLOUDRIFT_SMTP_FROM',
  'GITHUB_TOKEN',
  'GITHUB_REPOSITORY',
  'GITHUB_EVENT_PATH',
];

function writePullRequestEvent(prNumber: number): string {
  const path = join(mkdtempSync(join(tmpdir(), 'cloudrift-notify-')), 'event.json');
  writeFileSync(path, JSON.stringify({ pull_request: { number: prNumber } }));
  return path;
}

describe('dispatchNotifications', () => {
  let info: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    info = jest.fn();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it('does nothing when no flags are set', async () => {
    await dispatchNotifications({}, summary, info);

    expect(notifiers.sendSlackNotification).not.toHaveBeenCalled();
    expect(notifiers.sendWebhookNotification).not.toHaveBeenCalled();
    expect(notifiers.sendEmailNotification).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('sends Slack when --notify-slack is set and SLACK_WEBHOOK_URL is present', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x';
    (notifiers.sendSlackNotification as jest.Mock).mockResolvedValueOnce({ ok: true, value: undefined });

    await dispatchNotifications({ notifySlack: true }, summary, info);

    expect(notifiers.sendSlackNotification).toHaveBeenCalledWith('https://hooks.slack.com/x', summary);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('sent'));
  });

  it('warns and skips Slack when --notify-slack is set but SLACK_WEBHOOK_URL is missing', async () => {
    await dispatchNotifications({ notifySlack: true }, summary, info);

    expect(notifiers.sendSlackNotification).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('SLACK_WEBHOOK_URL'));
  });

  it('warns when the Slack send itself fails', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x';
    (notifiers.sendSlackNotification as jest.Mock).mockResolvedValueOnce({ ok: false, error: new Error('boom') });

    await dispatchNotifications({ notifySlack: true }, summary, info);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('failed: boom'));
  });

  it('sends the generic webhook when --notify-webhook is set and CLOUDRIFT_WEBHOOK_URL is present', async () => {
    process.env.CLOUDRIFT_WEBHOOK_URL = 'https://example.com/hook';
    (notifiers.sendWebhookNotification as jest.Mock).mockResolvedValueOnce({ ok: true, value: undefined });

    await dispatchNotifications({ notifyWebhook: true }, summary, info);

    expect(notifiers.sendWebhookNotification).toHaveBeenCalledWith('https://example.com/hook', summary);
  });

  it('warns and skips the webhook when CLOUDRIFT_WEBHOOK_URL is missing', async () => {
    await dispatchNotifications({ notifyWebhook: true }, summary, info);

    expect(notifiers.sendWebhookNotification).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('CLOUDRIFT_WEBHOOK_URL'));
  });

  it('sends email when --notify-email is set and every CLOUDRIFT_SMTP_* var is present', async () => {
    process.env.CLOUDRIFT_SMTP_HOST = 'smtp.example.com';
    process.env.CLOUDRIFT_SMTP_PORT = '587';
    process.env.CLOUDRIFT_SMTP_USER = 'bot@example.com';
    process.env.CLOUDRIFT_SMTP_PASSWORD = 'secret';
    process.env.CLOUDRIFT_SMTP_FROM = 'cloudrift@example.com';
    (notifiers.sendEmailNotification as jest.Mock).mockResolvedValueOnce({ ok: true, value: undefined });

    await dispatchNotifications({ notifyEmail: 'team@example.com' }, summary, info);

    expect(notifiers.sendEmailNotification).toHaveBeenCalledWith(
      { host: 'smtp.example.com', port: 587, user: 'bot@example.com', password: 'secret', from: 'cloudrift@example.com' },
      'team@example.com',
      summary,
    );
  });

  it('warns and skips email when any CLOUDRIFT_SMTP_* var is missing', async () => {
    process.env.CLOUDRIFT_SMTP_HOST = 'smtp.example.com';
    // port/user/password/from deliberately left unset

    await dispatchNotifications({ notifyEmail: 'team@example.com' }, summary, info);

    expect(notifiers.sendEmailNotification).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('CLOUDRIFT_SMTP_HOST/PORT/USER/PASSWORD/FROM'));
  });

  it('posts a GitHub PR comment when --notify-github-comment is set and the event is a pull_request', async () => {
    process.env.GITHUB_TOKEN = 'ghs_x';
    process.env.GITHUB_REPOSITORY = 'elleVas/cloudrift';
    process.env.GITHUB_EVENT_PATH = writePullRequestEvent(42);
    (notifiers.sendGithubPrComment as jest.Mock).mockResolvedValueOnce({ ok: true, value: undefined });

    await dispatchNotifications({ notifyGithubComment: true }, summary, info);

    expect(notifiers.sendGithubPrComment).toHaveBeenCalledWith({ token: 'ghs_x', owner: 'elleVas', repo: 'cloudrift', prNumber: 42 }, summary);
    expect(info).toHaveBeenCalledWith(expect.stringContaining('posted'));
  });

  it('warns and skips the PR comment when GITHUB_TOKEN/GITHUB_REPOSITORY/GITHUB_EVENT_PATH are missing', async () => {
    await dispatchNotifications({ notifyGithubComment: true }, summary, info);

    expect(notifiers.sendGithubPrComment).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('GITHUB_TOKEN'));
  });

  it('warns and skips the PR comment when the triggering event has no pull_request (e.g. a push/cron run)', async () => {
    process.env.GITHUB_TOKEN = 'ghs_x';
    process.env.GITHUB_REPOSITORY = 'elleVas/cloudrift';
    const path = join(mkdtempSync(join(tmpdir(), 'cloudrift-notify-')), 'event.json');
    writeFileSync(path, JSON.stringify({ ref: 'refs/heads/main' }));
    process.env.GITHUB_EVENT_PATH = path;

    await dispatchNotifications({ notifyGithubComment: true }, summary, info);

    expect(notifiers.sendGithubPrComment).not.toHaveBeenCalled();
  });

  it('warns when the PR comment send itself fails', async () => {
    process.env.GITHUB_TOKEN = 'ghs_x';
    process.env.GITHUB_REPOSITORY = 'elleVas/cloudrift';
    process.env.GITHUB_EVENT_PATH = writePullRequestEvent(42);
    (notifiers.sendGithubPrComment as jest.Mock).mockResolvedValueOnce({ ok: false, error: new Error('boom') });

    await dispatchNotifications({ notifyGithubComment: true }, summary, info);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('failed: boom'));
  });

  it('fans out to multiple channels at once', async () => {
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/x';
    process.env.CLOUDRIFT_WEBHOOK_URL = 'https://example.com/hook';
    (notifiers.sendSlackNotification as jest.Mock).mockResolvedValueOnce({ ok: true, value: undefined });
    (notifiers.sendWebhookNotification as jest.Mock).mockResolvedValueOnce({ ok: true, value: undefined });

    await dispatchNotifications({ notifySlack: true, notifyWebhook: true }, summary, info);

    expect(notifiers.sendSlackNotification).toHaveBeenCalledTimes(1);
    expect(notifiers.sendWebhookNotification).toHaveBeenCalledTimes(1);
  });
});

describe('topFindingLines', () => {
  const findings = [
    { kind: 's3-bucket-public', severity: 'info', reason: 'no policy' },
    { kind: 'iam-root-mfa-disabled', severity: 'critical', reason: 'no MFA' },
    { kind: 'ec2-security-group-open-ingress', severity: 'warning', reason: 'port 22 open' },
  ];

  it('sorts critical first, then warning, then info', () => {
    const lines = topFindingLines(findings, (f) => f.reason);

    expect(lines[0]).toContain('iam-root-mfa-disabled');
    expect(lines[1]).toContain('ec2-security-group-open-ingress');
    expect(lines[2]).toContain('s3-bucket-public');
  });

  it('includes the kind, reason, and severity in each line', () => {
    const lines = topFindingLines(findings, (f) => f.reason);

    expect(lines[0]).toBe('iam-root-mfa-disabled: no MFA (critical)');
  });

  it('caps the number of lines to the given limit', () => {
    const lines = topFindingLines(findings, (f) => f.reason, 2);

    expect(lines).toHaveLength(2);
  });

  it('does not mutate the input array', () => {
    const copy = [...findings];
    topFindingLines(findings, (f) => f.reason);

    expect(findings).toEqual(copy);
  });
});
