// SPDX-License-Identifier: Apache-2.0
import { sendEmailNotification } from './email.notifier';
import type { SmtpConfig } from './email.notifier';
import type { NotificationSummary } from './types';

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));

jest.mock('nodemailer', () => ({
  createTransport: (...args: unknown[]) => mockCreateTransport(...args),
}));

const config: SmtpConfig = { host: 'smtp.example.com', port: 587, user: 'bot@example.com', password: 'secret', from: 'cloudrift@example.com' };

const summary: NotificationSummary = {
  title: 'cloudrift dead-resources — 5 findings',
  domain: 'dead-resources',
  accountId: '123456789012',
  generatedAt: new Date('2026-07-31'),
  countBySeverity: { critical: 0, warning: 5, info: 0 },
  lines: ['Unused IAM role "S3ReadOnly"'],
};

describe('sendEmailNotification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends a plain-text email built from the summary', async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: 'abc' });

    const result = await sendEmailNotification(config, 'team@example.com', summary);

    expect(result.ok).toBe(true);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587, auth: { user: 'bot@example.com', pass: 'secret' } }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'cloudrift@example.com',
        to: 'team@example.com',
        subject: summary.title,
      }),
    );
    const { text } = mockSendMail.mock.calls[0][0];
    expect(text).toContain('0 critical, 5 warning, 0 info');
    expect(text).toContain('Unused IAM role "S3ReadOnly"');
  });

  it('uses secure:true for port 465', async () => {
    mockSendMail.mockResolvedValueOnce({});

    await sendEmailNotification({ ...config, port: 465 }, 'team@example.com', summary);

    expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true }));
  });

  it('returns Result.fail instead of throwing when sendMail rejects', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('SMTP auth failed'));

    const result = await sendEmailNotification(config, 'team@example.com', summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('SMTP auth failed');
  });
});
