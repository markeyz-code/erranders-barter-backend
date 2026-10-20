import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum TicketStatus {
  OPEN = 'open',
  ANSWERED = 'answered',
  CLOSED = 'closed',
}

/**
 * A message to support.
 *
 * The old contact form showed a success toast and sent nothing, which is worse than
 * having no form at all. This stores the message so it actually exists, and the
 * reference returned to the user is a real ticket they can quote.
 */
@Schema({ timestamps: true, collection: 'supporttickets' })
export class SupportTicket extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  userId?: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true, maxlength: 200 })
  subject: string;

  @Prop({ required: true, maxlength: 4000 })
  message: string;

  @Prop({ type: String, enum: TicketStatus, default: TicketStatus.OPEN, index: true })
  status: TicketStatus;

  /** Short human-quotable reference, e.g. DC-7F3K2A. */
  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ default: '' })
  reply: string;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);
SupportTicketSchema.index({ status: 1, createdAt: -1 });
