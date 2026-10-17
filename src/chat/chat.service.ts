import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Chat, ChatDocument } from './schemas/chat.schema';
import { Message, MessageDocument } from './schemas/message.schema';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Chat.name) private chatModel: Model<ChatDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>
  ) {}

  async findOrCreateChat(participantIds: string[], itemId?: string) {
    // Check if chat exists
    const query: any = { participants: { $all: participantIds, $size: participantIds.length } };
    if (itemId) query.item = itemId;
    
    let chat = await this.chatModel.findOne(query).exec();
    if (!chat) {
      chat = await new this.chatModel({
        participants: participantIds,
        item: itemId
      }).save();
    }
    return chat;
  }

  async getChatById(chatId: string) {
    return this.chatModel.findById(chatId).exec();
  }

  async getChatsForUser(userId: string) {
    return this.chatModel.find({ participants: userId })
      .populate('participants', 'firstName lastName email')
      .populate('lastMessage')
      .sort({ updatedAt: -1 })
      .exec();
  }

  /**
   * Is `userId` one of this chat's participants?
   *
   * Chat had NO authorisation at all: any authenticated user could read any
   * conversation by id, and the socket gateway let them join any room and post
   * into it. Every read and write now goes through this.
   */
  async assertParticipant(chatId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(chatId)) {
      // Callers validate first, but never let a malformed id reach the query.
      throw new ForbiddenException('You are not a participant in this chat');
    }
    const isParticipant = await this.chatModel
      .exists({ _id: chatId, participants: userId })
      .exec();
    if (!isParticipant) {
      // Deliberately the same message whether the chat is missing or simply not
      // theirs, so the response cannot be used to enumerate chat ids.
      throw new ForbiddenException('You are not a participant in this chat');
    }
  }

  async getMessages(chatId: string) {
    return this.messageModel.find({ chatId })
      .populate('sender', 'firstName lastName email')
      .populate('replyTo')
      .sort({ createdAt: 1 })
      .exec();
  }

  async saveMessage(chatId: string, senderId: string, content: string, type: string = 'text', assetUrl: string = '', replyTo?: string) {
    const msg = await new this.messageModel({
      chatId,
      sender: senderId,
      content,
      type,
      assetUrl,
      replyTo
    }).save();

    await this.chatModel.findByIdAndUpdate(chatId, {
      lastMessage: msg._id,
      updatedAt: new Date()
    });

    return msg.populate('sender', 'firstName lastName email');
  }
}
