import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { WebhooksController } from './webhooks.controller';
import { EmailService } from './email.service';
import { WhatsAppService } from './whatsapp.service';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController, WebhooksController],
  providers: [NotificationsService, EmailService, WhatsAppService],
  exports: [NotificationsService, EmailService, WhatsAppService],
})
export class NotificationsModule {}
