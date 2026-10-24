import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, Schema as MongooseSchema } from 'mongoose';

export enum OfferStatus {
  PENDING = 'pending',
  ACCEPTED_BY_RECEIVER = 'accepted_by_receiver',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
  COUNTERED = 'countered',
  COMPLETED = 'completed',
}

@Schema({ timestamps: true })
export class Offer extends Document {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  proposerId: string | Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  receiverId: string | Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', required: true })
  targetItemId: string | Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Item', required: true })
  offeredItemId: string | Types.ObjectId;

  // Positive means proposer pays receiver. Negative means receiver pays proposer.
  @Prop({ required: true, default: 0 })
  cashTopUp: number;

  @Prop({ required: true, enum: OfferStatus, default: OfferStatus.PENDING })
  status: OfferStatus;

  // Details provided by receiver when accepting the swap offer
  @Prop()
  receiverSwapDetails?: string;

  @Prop()
  receiverHandoverNotes?: string;

  @Prop({ type: Date })
  receiverAcceptedAt?: Date;

  @Prop({ type: Date })
  initiatorConfirmedAt?: Date;

  // Student Swap Facilitation & Verification Fee (flat ₦250 per party)
  @Prop({ default: 250 })
  swapServiceFee: number;

  @Prop({ default: false })
  proposerFeePaid: boolean;

  @Prop({ default: false })
  receiverFeePaid: boolean;

  // If this offer is a counter to a previous offer, keep track of the chain
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Offer' })
  parentOfferId?: string | Types.ObjectId;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
