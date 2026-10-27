/** One message ready to send. Email today; the channel is explicit so WhatsApp can join later. */
export interface NotificationMessage {
  channel: 'EMAIL';
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface NotificationResult {
  delivered: boolean;
  /** The provider's id for the message, when it gives one. */
  providerMessageId?: string;
  /** Why it was not delivered; never contains the message body. */
  error?: string;
}

/**
 * How a message leaves the system. Each provider (a log for development, SMTP
 * for email, WhatsApp later) implements this, so the rest of the application
 * only ever asks for a template to be sent.
 */
export interface NotificationProvider {
  readonly name: string;
  send(message: NotificationMessage): Promise<NotificationResult>;
}

/** The token the active provider is registered under. */
export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
