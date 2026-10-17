import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

/**
 * One recurring weekly working window. `dayOfWeek` uses the JS convention (0 = Sunday) and
 * times are wall-clock "HH:mm" strings, not dates — a window does not know about timezones.
 */
@Schema({ timestamps: true, collection: 'provideravailabilities' })
export class ProviderAvailability extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  providerId: Types.ObjectId;

  @Prop({ required: true, min: 0, max: 6 })
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday

  @Prop({ required: true })
  startTime: string; // "09:00"

  @Prop({ required: true })
  endTime: string; // "17:00"

  @Prop({ default: true })
  isActive: boolean;
}

export const ProviderAvailabilitySchema = SchemaFactory.createForClass(ProviderAvailability);

// The slot endpoint asks for one provider + one weekday at a time.
ProviderAvailabilitySchema.index({ providerId: 1, dayOfWeek: 1, isActive: 1 });
