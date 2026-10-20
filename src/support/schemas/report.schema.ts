import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

/** What is being reported. */
export enum ReportTargetType {
  ITEM = 'item',
  USER = 'user',
  BUSINESS = 'business',
  MESSAGE = 'message',
}

/** Why. Kept closed so the admin queue can be triaged by category. */
export enum ReportReason {
  SCAM = 'scam',
  MISREPRESENTED = 'misrepresented',
  PROHIBITED = 'prohibited',
  NO_RESPONSE = 'no_response',
  ABUSIVE = 'abusive',
  COUNTERFEIT = 'counterfeit',
  OTHER = 'other',
}

export enum ReportStatus {
  OPEN = 'open',
  REVIEWING = 'reviewing',
  RESOLVED = 'resolved',
  DISMISSED = 'dismissed',
}

/**
 * A report filed by a user against a listing, a person or a business.
 *
 * Reports are deliberately cheap to file and impossible to file anonymously — the
 * reporter's id is recorded so repeat false reports can be seen — but the target is
 * never told who reported them.
 */
@Schema({ timestamps: true, collection: 'reports' })
export class Report extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: ReportTargetType, required: true })
  targetType: ReportTargetType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  targetId: Types.ObjectId;

  /** What the reporter saw at the time, so the queue is readable without a join. */
  @Prop({ default: '' })
  targetLabel: string;

  @Prop({ type: String, enum: ReportReason, required: true })
  reason: ReportReason;

  @Prop({ required: true, maxlength: 2000 })
  details: string;

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.OPEN, index: true })
  status: ReportStatus;

  @Prop({ default: '' })
  adminNote: string;
}

export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index({ targetType: 1, targetId: 1, reporterId: 1 }, { unique: true });
ReportSchema.index({ status: 1, createdAt: -1 });
