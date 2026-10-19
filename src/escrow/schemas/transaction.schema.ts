import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export enum TransactionStatus {
  HELD_IN_ESCROW = 'held_in_escrow',
  RELEASED = 'released',
  DISPUTED = 'disputed',
  REFUNDED = 'refunded',
}

@Schema({ timestamps: true })
export class Transaction extends Document {
  @Prop({ required: true }) buyerId: string;
  @Prop({ required: true }) sellerId: string;
  @Prop({ required: true }) itemId: string;
  @Prop({ required: true }) amount: number; // total amount paid
  @Prop({ default: 0 }) itemPrice: number;
  @Prop({ default: 0 }) deliveryFee: number;
  @Prop({ default: 0 }) escrowFee: number;
  @Prop() deliveryMethod: string;
  @Prop() deliveryAddress: string;
  @Prop() erranderId: string;
  @Prop() erranderOrderId: string;
  @Prop() erranderBidId: string;
  @Prop() moverId: string;
  @Prop() moverScheduleSlot: string;
  @Prop() proposedDeliveryFee: number;
  @Prop() paymentReference: string;
  @Prop({ type: String, enum: TransactionStatus, default: TransactionStatus.HELD_IN_ESCROW }) status: TransactionStatus;

  // Admin dispute resolution audit trail. Only written by PATCH /admin/escrows/:id/resolve.
  @Prop({ type: String, enum: ['release', 'refund'] }) resolution: 'release' | 'refund';
  @Prop() resolutionNote: string;
  @Prop() resolvedBy: string;
  @Prop() resolvedAt: Date;

  // Exactly what was credited when the transaction was resolved, stored so platform
  // revenue can be reported from real ledger values rather than recomputed estimates.
  @Prop() sellerPayout: number;
  @Prop() sellerCommission: number;
  @Prop() refundAmount: number;
}
export const TransactionSchema = SchemaFactory.createForClass(Transaction);