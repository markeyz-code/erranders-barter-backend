import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export enum ItemType { SELL = 'sell', SWAP = 'swap', SERVICE = 'service' }
export enum ItemStatus { ACTIVE = 'active', PENDING = 'pending', SOLD = 'sold', COMPLETED = 'completed' }

@Schema({ timestamps: true })
export class Item extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  sellerId: string;

  @Prop({ required: true })
  title: string;

  @Prop()
  description: string;

  @Prop()
  price: number;

  @Prop()
  swapPreference: string;

  @Prop({ type: String, enum: ItemType, default: ItemType.SELL })
  type: ItemType;

  @Prop({ type: String, enum: ItemStatus, default: ItemStatus.ACTIVE })
  status: ItemStatus;

  @Prop({ required: true })
  location: string;

  @Prop()
  category: string;

  @Prop([String])
  images: string[];

  @Prop([String])
  videos: string[];

  @Prop()
  video360?: string;

  @Prop([String])
  tags: string[];

  @Prop({ default: false })
  isPromoted: boolean;

  // Admin moderation switch. Deactivated listings are hidden from the public feed but
  // remain visible on the admin marketplace screen so they can be reactivated.
  @Prop({ default: true })
  isActive: boolean;

  // Reels & Social Engagement
  @Prop({ default: 0 })
  likesCount: number;

  @Prop({ type: [String], default: [] })
  likes: string[];

  @Prop({ default: 0 })
  repostsCount: number;

  @Prop({ type: [String], default: [] })
  reposts: string[];

  @Prop({
    type: [
      {
        userId: { type: String, required: true },
        userName: { type: String, required: true },
        userAvatar: { type: String },
        text: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  comments: Array<{
    userId: string;
    userName: string;
    userAvatar?: string;
    text: string;
    createdAt: Date;
  }>;

  // Declutter Batch & Automation fields
  @Prop()
  batchId?: string;

  @Prop({ default: 0 })
  bundleDiscountPercent?: number;

  @Prop({ default: false })
  autoPriceDrop?: boolean;

  @Prop()
  condition?: string;

  @Prop()
  groupName?: string;
}

export const ItemSchema = SchemaFactory.createForClass(Item);
ItemSchema.index({ title: 'text', description: 'text', tags: 'text' });
ItemSchema.index({ batchId: 1 });
ItemSchema.index({ createdAt: -1 });
ItemSchema.index({ status: 1 });