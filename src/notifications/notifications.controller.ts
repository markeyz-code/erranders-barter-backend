import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user notifications and unread count' })
  async getMyNotifications(@Req() req, @Query('limit') limit?: string) {
    const userId = req.user.userId;
    const [items, unreadCount] = await Promise.all([
      this.notificationsService.findForUser(userId, limit ? parseInt(limit, 10) : 20),
      this.notificationsService.getUnreadCount(userId),
    ]);
    return { data: items, unreadCount };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  async markAllRead(@Req() req) {
    return this.notificationsService.markAllAsRead(req.user.userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async markRead(@Req() req, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.userId, id);
  }
}
