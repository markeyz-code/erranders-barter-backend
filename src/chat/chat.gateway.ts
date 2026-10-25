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

  private activeCalls = new Map<string, { callerId: string; calleeId?: string; chatId: string; candidates: Array<{ candidate: any; fromUserId: string }> }>();

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
    if (!chatId) return;

    // Track active call session and prepare candidate buffer
    this.activeCalls.set(chatId, {
      callerId: userId,
      chatId,
      candidates: []
    });

    const payload = { ...data, chatId, callerId: userId };
    socket.to(chatId).emit('call-offer', payload);

    try {
      const chat = await this.chatService.getChatById(chatId);
      if (chat && chat.participants) {
        chat.participants.forEach((participant: any) => {
          const pId = String(participant?._id || participant);
          if (pId !== userId) {
            this.server.to(pId).emit('incoming-call', payload);
            this.server.to(pId).emit('call-offer', payload);
          }
        });
      }
    } catch (err) {}
  }

  @SubscribeMessage('call-answer')
  async handleCallAnswer(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId ? String(socket.data.userId) : '';
    const chatId = String(data?.chatId || '');
    if (!chatId) return;

    const call = this.activeCalls.get(chatId);
    if (call) {
      call.calleeId = userId;
    }

    // 1. Direct delivery to the caller's personal socket room
    if (call?.callerId) {
      this.server.to(call.callerId).emit('call-answer', { ...data, chatId });
    }

    // 2. Broadcast to chat room
    socket.to(chatId).emit('call-answer', { ...data, chatId });

    // 3. Flush any ICE candidates buffered during ringing to the callee
    if (call && call.candidates.length > 0) {
      call.candidates.forEach((item) => {
        if (item.fromUserId !== userId) {
          socket.emit('call-ice-candidate', { chatId, candidate: item.candidate });
        } else if (call.callerId) {
          this.server.to(call.callerId).emit('call-ice-candidate', { chatId, candidate: item.candidate });
        }
      });
    }

    // 4. Fallback delivery to all other participants
    try {
      const chat = await this.chatService.getChatById(chatId);
      if (chat && chat.participants) {
        chat.participants.forEach((participant: any) => {
          const pId = String(participant?._id || participant);
          if (pId !== userId && (!call || pId !== call.callerId)) {
            this.server.to(pId).emit('call-answer', { ...data, chatId });
          }
        });
      }
    } catch (err) {}
  }

  @SubscribeMessage('call-ice-candidate')
  async handleCallIceCandidate(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const userId = socket.data?.userId ? String(socket.data.userId) : '';
    const chatId = String(data?.chatId || '');
    if (!chatId) return;

    // Buffer candidate in active call
    const call = this.activeCalls.get(chatId);
    if (call && data?.candidate) {
      call.candidates.push({ candidate: data.candidate, fromUserId: userId });
    }

    // Direct routing to the counterparty if known
    if (call) {
      const counterpartyId = userId === call.callerId ? call.calleeId : call.callerId;
      if (counterpartyId) {
        this.server.to(counterpartyId).emit('call-ice-candidate', data);
      }
    }

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

  @SubscribeMessage('call-end')
  async handleCallEnd(@MessageBody() data: any, @ConnectedSocket() socket: Socket) {
    const chatId = String(data?.chatId || '');

    // Cleanup active call state
    const call = this.activeCalls.get(chatId);
    this.activeCalls.delete(chatId);

    // 1. Direct delivery to known participants
    if (call) {
      if (call.callerId) this.server.to(call.callerId).emit('call-end', { chatId });
      if (call.calleeId) this.server.to(call.calleeId).emit('call-end', { chatId });
    }

    // 2. Broadcast call-end to the chat room
    if (chatId) {
      this.server.to(chatId).emit('call-end', { chatId });
    }

    // 3. Broadcast call-end to all participants' individual user rooms so all devices & tabs silence immediately
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
