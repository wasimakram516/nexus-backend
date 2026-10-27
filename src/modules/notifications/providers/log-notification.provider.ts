import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationMessage,
  NotificationProvider,
  NotificationResult,
} from '../notification.types';

/**
 * The default provider: nothing leaves the machine. It records that a message
 * would have been sent (to whom and with what subject, never the body, which
 * can hold a reset link), so development and tests never email real people.
 */
@Injectable()
export class LogNotificationProvider implements NotificationProvider {
  readonly name = 'log';
  private readonly logger = new Logger(LogNotificationProvider.name);

  send(message: NotificationMessage): Promise<NotificationResult> {
    this.logger.log(
      `Not sent (log provider): ${message.channel} to ${message.to}, subject "${message.subject}"`,
    );
    return Promise.resolve({ delivered: true, providerMessageId: 'log' });
  }
}
