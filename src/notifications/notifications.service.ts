import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification, NotificationType } from './schemas/notification.schema';
import { EmailService } from './email.service';

export interface CreateNotificationDto {
  userId: string | Types.ObjectId;
  actorId?: string | Types.ObjectId;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
  metadata?: Record<string, any>;
  emailNotification?: {
    toEmail: string;
    subject: string;
    htmlContent: string;
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name) private notificationModel: Model<Notification>,
    private readonly emailService: EmailService,
  ) {}

  async create(dto: CreateNotificationDto): Promise<Notification> {
    const notification = new this.notificationModel({
      userId: new Types.ObjectId(dto.userId.toString()),
      actorId: dto.actorId ? new Types.ObjectId(dto.actorId.toString()) : undefined,
      title: dto.title,
      message: dto.message,
      type: dto.type,
      link: dto.link || '',
      isRead: false,
      metadata: dto.metadata || {},
    });

    const saved = await notification.save();

    // If an email payload was supplied, dispatch it in background
    if (dto.emailNotification && dto.emailNotification.toEmail) {
      void this.emailService.sendEmail(
        dto.emailNotification.toEmail,
        dto.emailNotification.subject,
        dto.emailNotification.htmlContent,
      ).catch((err) => {
        this.logger.error(`Failed to send notification email: ${err.message}`);
      });
    }

    return saved;
  }

  async findForUser(userId: string, limit = 20): Promise<Notification[]> {
    return this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
  }

  async markAsRead(userId: string, id: string): Promise<Notification | null> {
    return this.notificationModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        { $set: { isRead: true } },
        { new: true },
      )
      .exec();
  }

  async markAllAsRead(userId: string): Promise<{ modifiedCount: number }> {
    const result = await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true } },
    );
    return { modifiedCount: result.modifiedCount };
  }

  // Helper expose email service
  getEmailService(): EmailService {
    return this.emailService;
  }
}
