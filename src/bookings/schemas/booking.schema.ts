import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  DECLINED = 'declined',
  NO_SHOW = 'no_show',
}

/**
 * Statuses that still occupy the provider's calendar are tracked by `blocksSlot`: `pending`,
 * `confirmed`, `completed` and `no_show` keep it true; `cancelled` and `declined` set it to
 * false, which releases the slot without deleting the booking history.
 */

@Schema({ timestamps: true, collection: 'bookings' })
export class Booking extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Service', required: true, index: true })
  serviceId: Types.ObjectId;

  // Denormalised so "my calendar" and the overlap checks do not need a join through Service.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  providerId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  customerId: Types.ObjectId;

  @Prop({ required: true })
  date: string; // YYYY-MM-DD

  @Prop({ required: true })
  startTime: string; // HH:mm

  @Prop({ required: true })
  endTime: string; // HH:mm

  // Snapshots taken when the booking is created / rescheduled. A later edit to the service
  // must not silently move or reprice an existing booking.
  @Prop({ required: true })
  durationMinutes: number;

  @Prop({ default: 0 })
  bufferMinutes: number;

  @Prop({ required: true, default: 0 })
  amount: number;

  @Prop({ required: true, default: 0 })
  commitmentFee: number;

  @Prop({ required: true, default: 0 })
  remainingBalance: number;

  // Student Client Booking Facilitation Fee (3.0%, min ₦150)
  @Prop({ default: 150 })
  serviceFee: number;

  // Provider Platform Commission (5.0%)
  @Prop({ default: 0 })
  providerCommission: number;

  // Net earnings credited to provider wallet upon completion
  @Prop({ default: 0 })
  providerPayout: number;

  @Prop({ default: false })
  commitmentFeePaid: boolean;

  @Prop({ default: false })
  remainingBalancePaid: boolean;

  @Prop({ type: String, enum: ['unpaid', 'commitment_paid', 'fully_paid'], default: 'unpaid' })
  paymentStatus: string;

  @Prop()
  paymentReference?: string;

  @Prop({ default: false })
  payoutReleased: boolean;

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING, index: true })
  status: BookingStatus;

  @Prop()
  notes: string;

  @Prop()
  meetingUrl: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Chat' })
  chatId: Types.ObjectId;

  @Prop()
  cancelledBy: string;

  @Prop()
  cancellationReason: string;

  /**
   * Internal double-booking guard; not part of the public API shape.
   *
   * `blocksSlot` lets the unique indexes below be *partial*: only bookings that still hold a
   * slot are indexed, so cancelling or declining frees the time without deleting history.
   * `slotKeys` holds one key per occupied minute (including the buffer) and makes overlapping
   * bookings — not just identical start times — impossible under concurrency.
   */
  @Prop({ default: true })
  blocksSlot: boolean;

  @Prop({ type: [String], default: undefined, select: false })
  slotKeys: string[];
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Provider calendar, customer history, and the "upcoming booking for this service" delete guard.
BookingSchema.index({ providerId: 1, date: 1 });
BookingSchema.index({ customerId: 1, createdAt: -1 });
BookingSchema.index({ serviceId: 1, status: 1, date: 1 });

// Exact-slot guard. A simultaneous second insert for the same provider/date/start fails with
// E11000, which the service turns into a 409 — there is no read-then-write window.
BookingSchema.index(
  { providerId: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { blocksSlot: true } },
);

// Overlap guard for differing start times (e.g. 09:00-10:00 vs 09:30-10:30): MongoDB's unique
// multikey constraint rejects a document that shares any occupied minute with another one.
BookingSchema.index(
  { slotKeys: 1 },
  { unique: true, partialFilterExpression: { blocksSlot: true } },
);
