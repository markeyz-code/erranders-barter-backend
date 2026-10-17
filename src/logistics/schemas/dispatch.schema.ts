import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum DispatchStatus {
  PENDING = 'pending',        // Record created, not yet accepted by the logistics provider
  DISPATCHED = 'dispatched',  // Provider accepted the errand, rider not sourced yet
  ASSIGNED = 'assigned',      // A rider has been assigned to the delivery
  IN_TRANSIT = 'in_transit',  // Rider is moving between pickup and dropoff
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
  FAILED = 'failed',          // Provider rejected/unreachable, or the dispatch is misconfigured
}

// "Active" means the delivery still needs to reach a terminal state and should stay on the
// admin logistics board.
export const ACTIVE_DISPATCH_STATUSES = [
  DispatchStatus.PENDING,
  DispatchStatus.DISPATCHED,
  DispatchStatus.ASSIGNED,
  DispatchStatus.IN_TRANSIT,
];

@Schema({ timestamps: true })
export class Dispatch extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Transaction' })
  transactionId: Types.ObjectId; // Optional link to the escrow transaction being delivered

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item' })
  itemId: Types.ObjectId; // Optional link to the barter item being delivered

  @Prop()
  itemTitle: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  sellerId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  buyerId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId; // User who triggered the dispatch

  @Prop({ required: true })
  pickupLocation: string;

  @Prop({ required: true })
  dropoffLocation: string;

  @Prop({ type: String, enum: DispatchStatus, default: DispatchStatus.PENDING })
  status: DispatchStatus;

  @Prop({ default: 'erranders' })
  provider: string;

  @Prop()
  providerOrderId: string; // Order ID returned by the Erranders logistics API

  @Prop()
  trackingUrl: string;

  @Prop()
  riderName: string;

  @Prop()
  riderPhone: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  riderId: Types.ObjectId; // Set when the rider is an Erranders user we can reference

  @Prop({ default: 0 })
  fee: number;

  @Prop({ default: 'normal' })
  priority: string;

  @Prop()
  notes: string;

  @Prop()
  lastError: string; // Populated whenever a provider call fails, so ops can see why

  @Prop({ type: Object })
  providerResponse: any; // Raw provider payload, kept for debugging failures

  @Prop()
  dispatchedAt: Date;

  @Prop()
  deliveredAt: Date;

  @Prop()
  cancelledAt: Date;
}

export const DispatchSchema = SchemaFactory.createForClass(Dispatch);
DispatchSchema.index({ status: 1, createdAt: -1 });
DispatchSchema.index({ transactionId: 1 });
