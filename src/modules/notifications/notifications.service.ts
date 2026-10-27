import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_PROVIDER,
  NotificationProvider,
  NotificationResult,
} from './notification.types';
import {
  renderTemplate,
  TemplateData,
  TemplateKey,
} from './notification-templates';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The one way the application sends a message: name a template, say who to
 * and give the data. It never throws for a delivery problem, so a failed
 * email can never undo the action that asked for it; the caller gets the
 * result and decides.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(NOTIFICATION_PROVIDER)
    private readonly provider: NotificationProvider,
  ) {}

  /**
   * @param {TemplateKey} key - Which message to send.
   * @param {string} to - The recipient's email address.
   * @param {TemplateData[K]} data - What the template needs.
   * @returns {Promise<NotificationResult>} Whether it was handed to the provider.
   */
  async sendEmail<K extends TemplateKey>(
    key: K,
    to: string,
    data: TemplateData[K],
  ): Promise<NotificationResult> {
    if (!EMAIL.test(to)) {
      return {
        delivered: false,
        error: 'The recipient has no valid email address.',
      };
    }
    try {
      const message = renderTemplate(key, data);
      return await this.provider.send({ channel: 'EMAIL', to, ...message });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Could not send ${key}: ${reason}`);
      return { delivered: false, error: reason };
    }
  }
}
