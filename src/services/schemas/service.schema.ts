import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export enum PriceType {
  FIXED = 'fixed',
  HOURLY = 'hourly',
  PER_MINUTE = 'per_minute',
  NEGOTIABLE = 'negotiable',
}

/**
 * A bookable offering. This is deliberately a separate collection from `Item`: items are
 * buy/sell/swap inventory, services have durations, buffers, availability and bookings.
 */
@Schema({ timestamps: true, collection: 'services' })
export class Service extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  providerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true })
  description: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Category', required: true, index: true })
  category: Types.ObjectId;

  @Prop({ type: String, enum: PriceType, default: PriceType.FIXED })
  priceType: PriceType;

  // Negotiable listings store 0; fixed/hourly listings are validated by the DTO/service.
  @Prop({ default: 0 })
  price: number;

  @Prop({ required: true, min: 1 })
  durationMinutes: number;

  @Prop({ default: 0, min: 0 })
  bufferMinutes: number;

  @Prop([String])
  images: string[];

  @Prop()
  location: string;

  @Prop({ default: false })
  isRemote: boolean;

  @Prop([String])
  tags: string[];

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  totalBookings: number;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);

// Public browse: active listings, newest first.
ServiceSchema.index({ isActive: 1, createdAt: -1 });
// Browsing by category and filtering by provider are the two hot paths.
ServiceSchema.index({ category: 1, isActive: 1 });
ServiceSchema.index({ providerId: 1, isActive: 1 });
// Kept for future relevance search; the API uses escaped regex matching so partial words work.
ServiceSchema.index({ title: 'text', description: 'text', tags: 'text' });
