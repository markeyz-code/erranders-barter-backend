import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EscrowService } from './escrow.service';
import { EscrowController } from './escrow.controller';
import { EscrowWebhookController } from './escrow-webhook.controller';
import { AdminEscrowController } from './admin-escrow.controller';
import { Transaction, TransactionSchema } from './schemas/transaction.schema';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Item.name, schema: ItemSchema },
      { name: User.name, schema: UserSchema },
    ]),
    SettingsModule,
    UsersModule,
    LogisticsModule
  ],
  controllers: [EscrowController, EscrowWebhookController, AdminEscrowController],
  providers: [EscrowService],
  exports: [EscrowService],
})
export class EscrowModule {}
