import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*' }
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers['authorization'];
      if (!token) return socket.disconnect();
      
      const payload = this.jwtService.verify(token.replace('Bearer ', ''), {
        secret: this.configService.get<string>('JWT_SECRET') || 'dev-secret-key'
      });
      const userIdStr = String(payload.sub);
      socket.data.userId = userIdStr;
      socket.join(userIdStr); // Join a personal room for direct user notifications
    } catch (err) {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket) {}

  @SubscribeMessage('joinChat')
  async handleJoinChat(@MessageBody() data: { chatId: string }, @ConnectedSocket() socket: Socket) {
    // Socket rooms were completely open: any connected client could join any
    // chatId and receive its live messages. Membership is now required, and a
    // refusal is reported to the caller rather than silently ignored.
    const userId = socket.data.userId;
    if (!userId) return;
    try {
      await this.chatService.assertParticipant(data.chatId, userId);
      socket.join(data.chatId);
    } catch {
      socket.emit('chatError', { chatId: data.chatId, message: 'You are not a participant in this chat' });
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() data: { chatId: string; content: string; type?: string; assetUrl?: string; replyTo?: string },
    @ConnectedSocket() socket: Socket
  ) {
    const userId = socket.data.userId;
    if (!userId) return;

    // Without this, any authenticated socket could post into any conversation.
    try {
      await this.chatService.assertParticipant(data.chatId, userId);
    } catch {
      socket.emit('chatError', { chatId: data.chatId, message: 'You are not a participant in this chat' });
      return;
    }

    const message = await this.chatService.saveMessage(
      data.chatId,
      userId,
      data.content,
      data.type,
      data.assetUrl,
      data.replyTo
    );

    // Broadcast to everyone in the chat (for the specific chat window)
    this.server.to(data.chatId).emit('newMessage', message);

    // Also broadcast a global notification to each participant's personal room
    const chat = await this.chatService.getChatById(data.chatId);
    if (chat && chat.participants) {
      chat.participants.forEach((participant) => {
        if (participant.toString() !== userId) {
          this.server.to(participant.toString()).emit('chatNotification', {
            chatId: data.chatId,
            message: message
          });
        }
      });
    }
  }

  @SubscribeMessage('call-offer')
  async handleCallOffer(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId ? String(socket.data.userId) : '';
    const chatId = String(data?.chatId || '');
    if (chatId) {
      socket.to(chatId).emit('call-offer', { ...data, chatId, callerId: userId });
    }

    try {
      if (chatId) {
        const chat = await this.chatService.getChatById(chatId);
        if (chat && chat.participants) {
          chat.participants.forEach((participant: any) => {
            const pId = String(participant?._id || participant);
            if (pId !== userId) {
              this.server.to(pId).emit('incoming-call', {
                ...data,
                chatId,
                callerId: userId,
              });
            }
          });
        }
      }
    } catch (err) {}
  }

  @SubscribeMessage('call-answer')
  async handleCallAnswer(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId ? String(socket.data.userId) : '';
    const chatId = String(data?.chatId || '');
    if (chatId) {
      socket.to(chatId).emit('call-answer', data);
      try {
        const chat = await this.chatService.getChatById(chatId);
        if (chat && chat.participants) {
          chat.participants.forEach((participant: any) => {
            const pId = String(participant?._id || participant);
            if (pId !== userId) {
              this.server.to(pId).emit('call-answer', data);
            }
          });
        }
      } catch (err) {}
    }
  }

  @SubscribeMessage('call-ice-candidate')
  async handleCallIceCandidate(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId ? String(socket.data.userId) : '';
    const chatId = String(data?.chatId || '');
    if (chatId) {
      socket.to(chatId).emit('call-ice-candidate', data);
      try {
        const chat = await this.chatService.getChatById(chatId);
        if (chat && chat.participants) {
          chat.participants.forEach((participant: any) => {
            const pId = String(participant?._id || participant);
            if (pId !== userId) {
              this.server.to(pId).emit('call-ice-candidate', data);
            }
          });
        }
      } catch (err) {}
    }
  }

  @SubscribeMessage('call-end')
  async handleCallEnd(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const chatId = String(data?.chatId || '');

    // 1. Broadcast call-end to the chat room
    if (chatId) {
      this.server.to(chatId).emit('call-end', { chatId });
    }

    // 2. Broadcast call-end to all participants' individual user rooms so all devices & tabs silence immediately
    try {
      if (chatId) {
        const chat = await this.chatService.getChatById(chatId);
        if (chat && chat.participants) {
          chat.participants.forEach((participant: any) => {
            const pId = String(participant?._id || participant);
            this.server.to(pId).emit('call-end', { chatId });
          });
        }
      }
    } catch (err) {}
  }

  @SubscribeMessage('typing')
  handleTyping(
    @MessageBody() data: { chatId: string; isTyping?: boolean },
    @ConnectedSocket() socket: Socket
  ) {
    const userId = socket.data.userId;
    const isTyping = data?.isTyping !== false;
    socket.to(data.chatId).emit('user-typing', {
      chatId: data.chatId,
      userId,
      isTyping
    });
    socket.to(data.chatId).emit(isTyping ? 'typing' : 'stopTyping', {
      chatId: data.chatId,
      userId
    });
  }

  @SubscribeMessage('stopTyping')
  handleStopTyping(
    @MessageBody() data: { chatId: string },
    @ConnectedSocket() socket: Socket
  ) {
    const userId = socket.data.userId;
    socket.to(data.chatId).emit('user-typing', {
      chatId: data.chatId,
      userId,
      isTyping: false
    });
    socket.to(data.chatId).emit('stopTyping', {
      chatId: data.chatId,
      userId
    });
  }

  @SubscribeMessage('media-uploading')
  handleMediaUploading(
    @MessageBody() data: { chatId: string; isUploading: boolean; assetType?: string; filename?: string },
    @ConnectedSocket() socket: Socket
  ) {
    const userId = socket.data.userId;
    socket.to(data.chatId).emit('media-uploading', {
      chatId: data.chatId,
      userId,
      isUploading: data.isUploading,
      assetType: data.assetType || 'file',
      filename: data.filename
    });
  }
}
