import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Chat', required: true })
  chatId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ required: true })
  content: string;

  @Prop({ enum: ['text', 'image', 'voice', 'video', 'file'], default: 'text' })
  type: string;

  @Prop({ type: String })
  assetUrl: string; // Used for images or voice notes

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Message' })
  replyTo: Types.ObjectId; // For tagging messages
}

export const MessageSchema = SchemaFactory.createForClass(Message);
// GET /chats/:chatId/messages filters by chatId and sorts by createdAt.
MessageSchema.index({ chatId: 1, createdAt: 1 });
