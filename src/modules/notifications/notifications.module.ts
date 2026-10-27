import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATION_PROVIDER,
  NotificationProvider,
} from './notification.types';
import { NotificationsService } from './notifications.service';
import { LogNotificationProvider } from './providers/log-notification.provider';
import { SmtpNotificationProvider } from './providers/smtp-notification.provider';

/**
 * Picks the provider from the environment: `log` (the default, sends nothing)
 * or `smtp`. The environment check at startup guarantees SMTP has what it needs.
 */
export function createNotificationProvider(
  config: Pick<ConfigService, 'get'>,
): NotificationProvider {
  if (config.get<string>('NOTIFICATIONS_PROVIDER') !== 'smtp') {
    return new LogNotificationProvider();
  }
  return new SmtpNotificationProvider({
    host: config.get<string>('SMTP_HOST') as string,
    port: Number(config.get('SMTP_PORT') ?? 587),
    secure: config.get('SMTP_SECURE') === true,
    user: config.get<string>('SMTP_USER'),
    password: config.get<string>('SMTP_PASSWORD'),
    from: config.get<string>('NOTIFICATIONS_FROM') as string,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [ConfigService],
      useFactory: createNotificationProvider,
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
