import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ChatDocument = Chat & Document;

@Schema({ timestamps: true })
export class Chat {
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], required: true })
  participants: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'Item' })
  item: Types.ObjectId; // Optional link to an item being traded

  @Prop({ type: Types.ObjectId, ref: 'Message' })
  lastMessage: Types.ObjectId;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
// GET /chats filters on participants and sorts by updatedAt.
ChatSchema.index({ participants: 1, updatedAt: -1 });
