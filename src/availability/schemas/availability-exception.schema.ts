import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * A date-specific override.
 *
 * - `isBlocked: true` with no times = the whole day is off (a range override).
 * - `isBlocked: true` with times = only that part of the day is blocked (a lunch break, a
 *   one-off appointment).
 * - `isBlocked: false` with times = an extra working window that only exists on that date.
 */
@Schema({ timestamps: true, collection: 'availabilityexceptions' })
export class AvailabilityException extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  providerId: Types.ObjectId;

  @Prop({ required: true })
  date: string; // YYYY-MM-DD

  @Prop({ default: false })
  isBlocked: boolean;

  @Prop()
  startTime: string; // "HH:mm", optional for a whole-day block

  @Prop()
  endTime: string; // "HH:mm", optional for a whole-day block

  @Prop()
  note: string;
}

export const AvailabilityExceptionSchema = SchemaFactory.createForClass(AvailabilityException);

// Every slot computation loads the exceptions for one provider + date.
AvailabilityExceptionSchema.index({ providerId: 1, date: 1 });
