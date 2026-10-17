import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum WithdrawalStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Audit trail for every payout attempt. A row is written before any money moves and is kept
 * (with a failureReason) even when the Paystack call fails, so a withdrawal can never
 * disappear without a trace.
 */
@Schema({ timestamps: true })
export class Withdrawal extends Document {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  amount: number; // amount debited from the wallet, in naira

  @Prop({ default: 0 })
  fee: number; // processing fee retained by the platform, in naira

  @Prop({ required: true })
  netAmount: number; // amount actually sent to the bank, in naira

  @Prop({ required: true, unique: true })
  reference: string;

  @Prop({ type: String, enum: WithdrawalStatus, default: WithdrawalStatus.PENDING, index: true })
  status: WithdrawalStatus;

  @Prop({ required: true })
  bankCode: string;

  @Prop({ required: true })
  bankName: string;

  @Prop({ required: true })
  accountNumber: string;

  @Prop({ required: true })
  accountName: string;

  @Prop()
  paystackRecipientCode?: string;

  @Prop()
  transferCode?: string;

  @Prop()
  failureReason?: string;
}

export const WithdrawalSchema = SchemaFactory.createForClass(Withdrawal);
