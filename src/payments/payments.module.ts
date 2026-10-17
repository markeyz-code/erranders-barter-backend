import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BanksController } from './banks.controller';
import { PaystackService } from './paystack.service';
import {
  PaystackWebhookController,
  WithdrawalReconcileController,
} from './paystack-webhook.controller';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { WithdrawalSettlementService } from '../withdrawals/withdrawal-settlement.service';
import { ErrandersWebhookController } from '../withdrawals/erranders-webhook.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Withdrawal.name, schema: WithdrawalSchema }]),
  ],
  controllers: [
    BanksController,
    PaystackWebhookController,
    WithdrawalReconcileController,
    ErrandersWebhookController,
  ],
  providers: [PaystackService, WithdrawalSettlementService],
  exports: [PaystackService, WithdrawalSettlementService],
})
export class PaymentsModule {}
