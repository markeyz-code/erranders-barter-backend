import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { Transaction, TransactionSchema } from '../escrow/schemas/transaction.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { AdminGuard } from './admin.guard';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsService } from './admin-stats.service';

/**
 * Cross-cutting admin surface.
 *
 * Provides stats aggregation across users, items, escrows, withdrawals,
 * services and bookings, as well as the global AdminGuard.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [AdminStatsController],
  providers: [AdminGuard, AdminStatsService],
  exports: [AdminGuard],
})
export class AdminModule {}
