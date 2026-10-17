import {
  Controller,
  Post,
  Param,
  Req,
  Headers,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';

import { Withdrawal, WithdrawalStatus } from '../withdrawals/schemas/withdrawal.schema';
import { PaystackService } from './paystack.service';
import { WithdrawalSettlementService } from '../withdrawals/withdrawal-settlement.service';

/**
 * Paystack payout reconciliation.
 *
 * Paystack settles a transfer asynchronously: `POST /users/me/withdraw` can only
 * honestly report `processing`, because the money has left the wallet but has not
 * reached the bank yet. Without something to receive the outcome, a withdrawal
 * row would sit at `processing` forever — which is both wrong for the user and
 * useless for support.
 *
 * Two ways to close the loop, and they are complementary:
 *   • the webhook, which Paystack calls when the transfer settles, and
 *   • a manual verify endpoint, so a user (or support) can force a re-check when
 *     a webhook was missed.
 *
 * A settled-to-`failed` transfer refunds the wallet, because the money never
 * left Barter's Paystack balance and the user is owed it back.
 */
@ApiTags('Payments Webhook')
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  private readonly logger = new Logger(PaystackWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
    private readonly settlement: WithdrawalSettlementService,
  ) {}

  /**
   * POST /webhooks/paystack
   *
   * Paystack signs the RAW request body with HMAC-SHA512 using the secret key and
   * sends it in `x-paystack-signature`. Verifying over `rawBody` (enabled in
   * main.ts) is essential — re-serialising the parsed JSON would change byte
   * order and never match.
   */
  @Post()
  async handle(
    @Req() req: any,
    @Headers('x-paystack-signature') signature: string,
  ) {
    const secret = this.config.get<string>('PAYSTACK_SECRET_KEY');
    if (!secret) {
      // Never acknowledge a webhook we cannot authenticate.
      throw new UnauthorizedException('Paystack is not configured');
    }

    const raw = req.rawBody;
    if (!raw) {
      throw new BadRequestException('Raw body unavailable — cannot verify the signature');
    }

    const expected = createHmac('sha512', secret).update(raw).digest('hex');
    if (!this.safeEqual(expected, signature || '')) {
      this.logger.warn('Rejected a Paystack webhook with an invalid signature');
      throw new UnauthorizedException('Invalid signature');
    }

    const event: string = req.body?.event || '';
    const data = req.body?.data || {};
    const reference: string = data.reference || '';

    if (!reference) {
      // A verified but irrelevant event — acknowledge so Paystack stops retrying.
      return { received: true, ignored: 'no reference' };
    }

    const withdrawal = await this.withdrawalModel.findOne({ reference });
    if (!withdrawal) {
      // Not one of ours (could be an Erranders charge sharing the account).
      return { received: true, ignored: 'unknown reference' };
    }

    // Paystack's transfer lifecycle — delegated so the refund rule lives in ONE place.
    const outcome = event.replace(/^transfer\./, '');
    if (outcome === 'success' || outcome === 'failed' || outcome === 'reversed') {
      return this.settlement.settle(
        reference,
        outcome,
        data.reason || data.message,
        data.transfer_code,
      );
    }

    return { received: true, ignored: event || 'unhandled event' };
  }

  /**
   * Constant-time compare so the signature check leaks no timing information.
   * (It lives in each controller rather than a shared util because the two guard
   * different things — an HMAC hex digest and a plain API key.)
   */
  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }

}

/**
 * Manual reconciliation, for when a webhook is missed or a transfer is stuck.
 * JWT-guarded — a user may only re-check their OWN withdrawal.
 */
@ApiTags('Withdrawals')
@Controller('users/me/withdrawals')
export class WithdrawalReconcileController {
  private readonly logger = new Logger(WithdrawalReconcileController.name);

  constructor(
    private readonly paystack: PaystackService,
    @InjectModel(Withdrawal.name) private readonly withdrawalModel: Model<Withdrawal>,
  ) {}

  @Post(':id/verify')
  @UseGuards(AuthGuard('jwt'))
  async verify(@Param('id') id: string, @Req() req: any) {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Withdrawal not found');

    const withdrawal = await this.withdrawalModel.findById(id);
    if (!withdrawal) throw new NotFoundException('Withdrawal not found');
    if (String(withdrawal.userId) !== String(req.user.userId)) {
      throw new ForbiddenException('This withdrawal is not yours');
    }

    // Nothing to reconcile once it has settled.
    if (
      withdrawal.status === WithdrawalStatus.COMPLETED ||
      withdrawal.status === WithdrawalStatus.FAILED
    ) {
      return withdrawal;
    }

    const result: any = await this.paystack.verifyTransfer(withdrawal.reference);
    const transfer = result?.data ?? result;
    const paystackStatus = String(transfer?.status || '').toLowerCase();

    if (paystackStatus === 'success') {
      withdrawal.status = WithdrawalStatus.COMPLETED;
    } else if (paystackStatus === 'failed' || paystackStatus === 'reversed') {
      withdrawal.status = WithdrawalStatus.FAILED;
      withdrawal.failureReason = transfer?.reason || `Paystack reported ${paystackStatus}`;
    } else {
      // still pending/otp/processing — leave it alone and say so truthfully.
      return withdrawal;
    }

    await withdrawal.save();

    if (withdrawal.status === WithdrawalStatus.FAILED) {
      try {
        await this.withdrawalModel.db
          .collection('users')
          .updateOne({ _id: new Types.ObjectId(String(withdrawal.userId)) }, [
            {
              $set: {
                walletBalance: { $add: [{ $ifNull: ['$walletBalance', 0] }, withdrawal.amount] },
              },
            },
          ]);
      } catch (err: any) {
        this.logger.error(
          `CRITICAL: could not refund withdrawal ${withdrawal.reference}: ${err?.message}`,
        );
      }
    }

    return withdrawal;
  }
}
