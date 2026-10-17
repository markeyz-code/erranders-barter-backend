import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export type ChatDocument = Chat & Document;

@Schema({ timestamps: true })
export class Chat {
  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'User' }], required: true })
  participants: Types.ObjectId[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item' })
  item: Types.ObjectId; // Optional link to an item being traded

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Message' })
  lastMessage: Types.ObjectId;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
// GET /chats filters on participants and sorts by updatedAt.
ChatSchema.index({ participants: 1, updatedAt: -1 });
