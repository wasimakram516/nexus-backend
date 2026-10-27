import { Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import {
  NotificationMessage,
  NotificationProvider,
  NotificationResult,
} from '../notification.types';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

/** Sends email through an SMTP server chosen by the environment. */
export class SmtpNotificationProvider implements NotificationProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger(SmtpNotificationProvider.name);
  private readonly transport: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(private readonly settings: SmtpSettings) {
    this.transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth:
        settings.user && settings.password
          ? { user: settings.user, pass: settings.password }
          : undefined,
    });
  }

  async send(message: NotificationMessage): Promise<NotificationResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { delivered: true, providerMessageId: info.messageId };
    } catch (error) {
      // The server's reason helps an operator; the message itself is never logged.
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Email to ${message.to} was not sent: ${reason}`);
      return { delivered: false, error: reason };
    }
  }
}
