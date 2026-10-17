import { Controller, Get, Param, Post, Body, UseGuards, Req, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ChatService } from './chat.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('chats')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get()
  async getMyChats(@Req() req) {
    return this.chatService.getChatsForUser(req.user.userId);
  }

  @Get(':chatId/messages')
  async getMessages(@Param('chatId') chatId: string, @Req() req) {
    if (!Types.ObjectId.isValid(chatId)) throw new BadRequestException('Invalid chatId');
    await this.chatService.assertParticipant(chatId, req.user.userId);
    return this.chatService.getMessages(chatId);
  }

  @Post(':chatId/messages')
  async sendMessage(
    @Param('chatId') chatId: string,
    @Req() req,
    @Body() body: { content: string; type?: string; assetUrl?: string; replyTo?: string }
  ) {
    if (!Types.ObjectId.isValid(chatId)) throw new BadRequestException('Invalid chatId');
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!content && !body?.assetUrl) {
      throw new BadRequestException('A message needs content or an attachment');
    }
    // Same tenancy rule as the read path — you can only post into your own chats.
    await this.chatService.assertParticipant(chatId, req.user.userId);
    return this.chatService.saveMessage(
      chatId,
      req.user.userId,
      content,
      body?.type || 'text',
      body?.assetUrl || '',
      body?.replyTo
    );
  }

  @Post('init')
  async initChat(@Req() req, @Body() body: { participantId: string; itemId?: string }) {
    if (!body?.participantId) throw new BadRequestException('participantId is required');
    if (body.participantId === req.user.userId) throw new BadRequestException('Cannot start a chat with yourself');
    return this.chatService.findOrCreateChat([req.user.userId, body.participantId], body.itemId);
  }
}
