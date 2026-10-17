import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { Transaction, TransactionSchema } from '../escrow/schemas/transaction.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { AdminGuard } from './admin.guard';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

/**
 * Cross-cutting admin surface.
 *
 * Only the stats endpoint lives here (it aggregates users, items, escrows and
 * withdrawals). The per-domain admin controllers live in the modules that already own
 * their domain: admin-users in UsersModule, admin-items in ItemsModule and
 * admin-escrows in EscrowModule. This module is @Global solely so those controllers can
 * use AdminGuard without re-registering it in every module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
    ]),
  ],
  controllers: [AdminStatsController],
  providers: [AdminGuard, AdminStatsService],
  exports: [AdminGuard],
})
export class AdminModule {}
