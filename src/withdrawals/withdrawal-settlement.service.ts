import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Withdrawal, WithdrawalStatus } from '../withdrawals/schemas/withdrawal.schema';

export interface SettleResult {
  received: boolean;
  status?: WithdrawalStatus;
  ignored?: string;
  unchanged?: boolean | string;
}

/**
 * Applies a settled transfer outcome to a withdrawal, and refunds the wallet if
 * the money never reached the bank.
 *
 * Shared by both inbound paths:
 *   • `POST /webhooks/paystack`   — direct, when Barter has its own Paystack account
 *   • `POST /webhooks/erranders`  — forwarded from Erranders, which is where the
 *                                   shared Paystack account's webhook actually lands
 *
 * Keeping it in one place matters: the refund rule is the part that must never
 * diverge between the two entry points.
 */
@Injectable()
export class WithdrawalSettlementService {
  private readonly logger = new Logger(WithdrawalSettlementService.name);

  constructor(
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
  ) {}

  /**
   * @param reference the Paystack transfer reference
   * @param outcome   'success' | 'failed' | 'reversed'
   * @param reason    Paystack's failure reason, when there is one
   */
  async settle(
    reference: string,
    outcome: 'success' | 'failed' | 'reversed',
    reason?: string,
    transferCode?: string,
  ): Promise<SettleResult> {
    if (!reference) return { received: true, ignored: 'no reference' };

    const withdrawal = await this.withdrawalModel.findOne({ reference });
    if (!withdrawal) {
      // Could be an Erranders payout sharing the same Paystack account, or a stale
      // reference. Acknowledge so the caller stops retrying — this is not an error.
      return { received: true, ignored: 'unknown reference' };
    }

    const nextStatus =
      outcome === 'success' ? WithdrawalStatus.COMPLETED : WithdrawalStatus.FAILED;

    // Idempotent: webhooks are retried, and a second refund would create money.
    if (withdrawal.status === nextStatus) return { received: true, unchanged: true };
    if (withdrawal.status === WithdrawalStatus.COMPLETED) {
      return { received: true, unchanged: 'already completed' };
    }

    withdrawal.status = nextStatus;
    if (nextStatus === WithdrawalStatus.FAILED) {
      withdrawal.failureReason = reason || `Paystack reported ${outcome}`;
    }
    if (transferCode && !withdrawal.transferCode) {
      withdrawal.transferCode = transferCode;
    }
    await withdrawal.save();

    if (nextStatus === WithdrawalStatus.FAILED) {
      await this.refund(withdrawal);
    }

    return { received: true, status: nextStatus };
  }

  /** Return the debited amount to the wallet after a failed payout. */
  private async refund(withdrawal: Withdrawal): Promise<void> {
    try {
      await this.withdrawalModel.db.collection('users').updateOne(
        { _id: new Types.ObjectId(String(withdrawal.userId)) },
        [
          {
            $set: {
              walletBalance: {
                $add: [{ $ifNull: ['$walletBalance', 0] }, withdrawal.amount],
              },
            },
          },
        ],
      );
      this.logger.warn(
        `Refunded ₦${withdrawal.amount} for failed withdrawal ${withdrawal.reference}`,
      );
    } catch (err: any) {
      // Money must not vanish silently — this needs a human.
      this.logger.error(
        `CRITICAL: could not refund failed withdrawal ${withdrawal.reference} ` +
          `(₦${withdrawal.amount}, user ${withdrawal.userId}): ${err?.message}`,
      );
    }
  }
}
