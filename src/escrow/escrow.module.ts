import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { EscrowWebhookController } from './escrow-webhook.controller';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { Item, ItemSchema } from '../items/schemas/item.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Item.name, schema: ItemSchema }
    ]),
    SettingsModule,
    UsersModule,
    LogisticsModule
  ],
  controllers: [EscrowController, EscrowWebhookController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
