import { ConfigService } from '@nestjs/config';
import { envSchema } from '../../config/env.schema';
import {
  escapeHtml,
  renderTemplate,
  TemplateKey,
} from './notification-templates';
import { NotificationsService } from './notifications.service';
import { createNotificationProvider } from './notifications.module';
import { LogNotificationProvider } from './providers/log-notification.provider';
import { SmtpNotificationProvider } from './providers/smtp-notification.provider';

const sendMail = jest.fn();
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail })),
}));

describe('notification templates', () => {
  it('writes the password reset with the link, the expiry and a note for someone who did not ask', () => {
    const message = renderTemplate('PASSWORD_RESET', {
      name: 'Ayesha',
      resetUrl: 'https://nexus.example/reset-password?token=abc',
      expiresInMinutes: 30,
      institutionName: 'Greenfield School',
    });

    expect(message.subject).toBe('Reset your Nexus password');
    expect(message.text).toContain('Hello Ayesha,');
    expect(message.text).toContain('at Greenfield School');
    expect(message.text).toContain('30 minutes');
    expect(message.text).toContain(
      'Choose a new password: https://nexus.example/reset-password?token=abc',
    );
    expect(message.text).toContain('you can ignore this message');
    expect(message.html).toContain(
      'href="https://nexus.example/reset-password?token=abc"',
    );
  });

  it('leaves out the school when there is none, such as for a platform administrator', () => {
    const message = renderTemplate('PASSWORD_RESET', {
      name: 'Root',
      resetUrl: 'https://nexus.example/r',
      expiresInMinutes: 30,
      institutionName: null,
    });

    expect(message.text).toContain('for your account. This link works');
  });

  it('puts a name containing markup into the HTML as text, never as tags', () => {
    const message = renderTemplate('ABSENCE_ALERT', {
      guardianName: '<b>Dad</b>',
      studentName: 'Tom & "Jerry"',
      date: '25 Oct 2026',
      institutionName: 'School',
    });

    expect(message.html).not.toContain('<b>Dad</b>');
    expect(message.html).toContain('&lt;b&gt;Dad&lt;/b&gt;');
    expect(message.html).toContain('Tom &amp; &quot;Jerry&quot;');
  });

  it('does not make a button from a link that is not a web address', () => {
    const message = renderTemplate('PASSWORD_RESET', {
      name: 'A',
      resetUrl: 'javascript:alert(1)',
      expiresInMinutes: 30,
      institutionName: null,
    });

    expect(message.html).not.toContain('javascript:');
    expect(message.text).not.toContain('javascript:');
  });

  it.each<[TemplateKey, string]>([
    ['VOUCHER_ISSUED', 'due by 10 Nov 2026'],
    ['VOUCHER_OVERDUE', 'still unpaid'],
    ['RESULT_PUBLISHED', 'published the results of Term 1'],
    ['ABSENCE_ALERT', 'marked absent'],
    ['TRIAL_EXPIRING', 'in 1 day.'],
  ])('writes the %s message', (key, phrase) => {
    const data = {
      guardianName: 'Mr Khan',
      studentName: 'Ayesha',
      monthLabel: 'Oct 2026',
      amount: 'PKR 5000.00',
      amountDue: 'PKR 5000.00',
      dueDate: '10 Nov 2026',
      examName: 'Term 1',
      institutionName: 'Greenfield',
      adminName: 'Admin',
      daysLeft: 1,
      endsOn: '26 Oct 2026',
      date: '25 Oct 2026',
    };

    const message = renderTemplate(key, data as never);

    expect(message.text).toContain(phrase);
    expect(message.subject.length).toBeGreaterThan(5);
    expect(message.html).toContain('<p');
  });

  it('says days in the plural except for one', () => {
    const many = renderTemplate('TRIAL_EXPIRING', {
      adminName: 'A',
      institutionName: 'S',
      daysLeft: 3,
      endsOn: '28 Oct 2026',
    });

    expect(many.text).toContain('in 3 days.');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
  });
});

describe('NotificationsService', () => {
  const provider = { name: 'fake', send: jest.fn() };
  const service = new NotificationsService(provider);
  const data = {
    name: 'Ayesha',
    resetUrl: 'https://nexus.example/r',
    expiresInMinutes: 30,
    institutionName: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    provider.send.mockResolvedValue({
      delivered: true,
      providerMessageId: 'm1',
    });
  });

  it('renders the template and hands it to the provider as an email', async () => {
    const result = await service.sendEmail('PASSWORD_RESET', 'a@b.co', data);

    expect(result).toEqual({ delivered: true, providerMessageId: 'm1' });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'EMAIL',
        to: 'a@b.co',
        subject: 'Reset your Nexus password',
      }),
    );
  });

  it('does not try to send to an address that is not an email', async () => {
    const result = await service.sendEmail(
      'PASSWORD_RESET',
      'not an email',
      data,
    );

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('no valid email');
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('reports a delivery failure instead of throwing, so the action that asked is not undone', async () => {
    provider.send.mockRejectedValue(new Error('connection refused'));

    await expect(
      service.sendEmail('PASSWORD_RESET', 'a@b.co', data),
    ).resolves.toEqual({ delivered: false, error: 'connection refused' });
  });

  it('passes on a failure the provider itself reports', async () => {
    provider.send.mockResolvedValue({
      delivered: false,
      error: 'mailbox full',
    });

    await expect(
      service.sendEmail('PASSWORD_RESET', 'a@b.co', data),
    ).resolves.toEqual({ delivered: false, error: 'mailbox full' });
  });
});

describe('providers', () => {
  const config = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as Pick<ConfigService, 'get'>;

  it('sends nothing by default: the log provider only says it would have', async () => {
    const provider = createNotificationProvider(config({}));

    expect(provider).toBeInstanceOf(LogNotificationProvider);
    await expect(
      provider.send({
        channel: 'EMAIL',
        to: 'a@b.co',
        subject: 's',
        text: 't',
        html: 'h',
      }),
    ).resolves.toEqual({ delivered: true, providerMessageId: 'log' });
  });

  it('uses SMTP when the environment says so, and reports the provider message id', async () => {
    sendMail.mockResolvedValue({ messageId: '<id@host>' });
    const provider = createNotificationProvider(
      config({
        NOTIFICATIONS_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 465,
        SMTP_SECURE: true,
        SMTP_USER: 'u',
        SMTP_PASSWORD: 'p',
        NOTIFICATIONS_FROM: 'Nexus <no-reply@example.com>',
      }),
    );

    expect(provider).toBeInstanceOf(SmtpNotificationProvider);
    const result = await provider.send({
      channel: 'EMAIL',
      to: 'a@b.co',
      subject: 's',
      text: 't',
      html: 'h',
    });

    expect(result).toEqual({ delivered: true, providerMessageId: '<id@host>' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Nexus <no-reply@example.com>',
      to: 'a@b.co',
      subject: 's',
      text: 't',
      html: 'h',
    });
  });

  it('reports why SMTP failed without throwing', async () => {
    sendMail.mockRejectedValue(new Error('535 bad credentials'));
    const provider = createNotificationProvider(
      config({
        NOTIFICATIONS_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        NOTIFICATIONS_FROM: 'no-reply@example.com',
      }),
    );

    await expect(
      provider.send({
        channel: 'EMAIL',
        to: 'a@b.co',
        subject: 's',
        text: 't',
        html: 'h',
      }),
    ).resolves.toEqual({ delivered: false, error: '535 bad credentials' });
  });
});

describe('notification environment', () => {
  const base = {
    DATABASE_URL: 'postgresql://x',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  it('defaults to sending nothing, with the web app on localhost', () => {
    const config = envSchema.parse(base);

    expect(config.NOTIFICATIONS_PROVIDER).toBe('log');
    expect(config.APP_URL).toBe('http://localhost:3000');
    expect(config.SMTP_SECURE).toBe(false);
  });

  it('refuses SMTP without a host and a sender', () => {
    expect(() =>
      envSchema.parse({ ...base, NOTIFICATIONS_PROVIDER: 'smtp' }),
    ).toThrow(/SMTP_HOST is required/);
    expect(() =>
      envSchema.parse({
        ...base,
        NOTIFICATIONS_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
      }),
    ).toThrow(/NOTIFICATIONS_FROM is required/);
  });

  it('accepts a complete SMTP setup, and requires the user and password together', () => {
    const config = envSchema.parse({
      ...base,
      NOTIFICATIONS_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example.com',
      NOTIFICATIONS_FROM: 'no-reply@example.com',
      SMTP_SECURE: 'true',
      SMTP_USER: 'u',
      SMTP_PASSWORD: 'p',
    });
    expect(config.SMTP_SECURE).toBe(true);

    expect(() => envSchema.parse({ ...base, SMTP_USER: 'u' })).toThrow(
      /SMTP_USER and SMTP_PASSWORD must be provided together/,
    );
  });

  it('refuses a provider it does not know and a web address that is not one', () => {
    expect(() =>
      envSchema.parse({ ...base, NOTIFICATIONS_PROVIDER: 'carrier-pigeon' }),
    ).toThrow();
    expect(() => envSchema.parse({ ...base, APP_URL: 'nexus' })).toThrow();
  });
});
