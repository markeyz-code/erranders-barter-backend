import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import { ApiTags } from '@nestjs/swagger';

import { WithdrawalSettlementService } from './withdrawal-settlement.service';

/**
 * Inbound payout outcomes forwarded from Erranders.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Paystack account has exactly ONE webhook URL, and Barter shares Erranders'
 * account. That URL is already Erranders'
 * `POST /api/v1/payments/paystack/webhook`, so Paystack will never call this
 * service directly for a shared-account transfer. Erranders receives every
 * `transfer.*` event and forwards it here, authenticated with the shared
 * `BARTER_API_KEY` — the same scheme the escrow webhooks already use.
 *
 * Barter's own `POST /webhooks/paystack` is kept for the day Barter has its own
 * Paystack account; both paths funnel into the same settlement service so the
 * refund rule cannot drift between them.
 */
@ApiTags('Erranders Webhook')
@Controller('webhooks/erranders')
export class ErrandersWebhookController {
  private readonly logger = new Logger(ErrandersWebhookController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly settlement: WithdrawalSettlementService,
    // Resolved at call time: adding EscrowService to the module graph here crashed boot with an unresolved
    // dependency, and this controller only needs it for the charge branch.
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * POST /webhooks/erranders
   *
   * Body: `{ event: 'transfer.success'|'transfer.failed'|'transfer.reversed',
   *          data: { reference, status?, reason?, transfer_code? } }`
   * Header: `x-api-key: <BARTER_API_KEY>`
   */
  @Post()
  async handle(
    @Headers('x-api-key') apiKey: string,
    @Body()
    body: {
      event?: string;
      data?: { reference?: string; status?: string; reason?: string; transfer_code?: string };
    },
  ) {
    const expected = this.config.get<string>('BARTER_API_KEY');
    if (!expected) {
      // Never accept an unauthenticated webhook just because config is missing.
      throw new UnauthorizedException('BARTER_API_KEY is not configured');
    }
    if (!this.safeEqual(expected, apiKey || '')) {
      this.logger.warn('Rejected an Erranders webhook with an invalid API key');
      throw new UnauthorizedException('Invalid API key');
    }

    const event = body?.event || '';
    const reference = body?.data?.reference || '';
    if (!reference) throw new BadRequestException('data.reference is required');

    /*
     * A Declutter escrow payment settles here too.
     *
     * Paystack allows one webhook per account, and it points at the Erranders backend, so charge events for this
     * marketplace are forwarded from there. The reference decides: escrow references start with ESC-.
     */
    if (event === 'charge.success' && reference.startsWith('ESC-')) {
      try {
        const { EscrowService } = require('../escrow/escrow.service');
        const escrow = this.moduleRef.get(EscrowService, { strict: false });
        const settled = await escrow.settleByPaystackReference(reference);
        return { received: true, settled };
      } catch (e: any) {
        this.logger.warn(`Charge webhook for ${reference} could not settle: ${e?.message || e}`);
        return { received: true, settled: false, reason: e?.message };
      }
    }

    // Accept either Paystack's event name or a bare outcome.
    const normalised = event.replace(/^transfer\./, '');
    if (normalised !== 'success' && normalised !== 'failed' && normalised !== 'reversed') {
      return { received: true, ignored: event || 'unsupported event' };
    }

    const result = await this.settlement.settle(
      reference,
      normalised,
      body?.data?.reason,
      body?.data?.transfer_code,
    );

    this.logger.log(`Erranders forward ${event} ${reference} → ${JSON.stringify(result)}`);
    return result;
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
