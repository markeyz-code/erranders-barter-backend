import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LogisticsService } from './logistics.service';
import { LogisticsController } from './logistics.controller';
import { Dispatch, DispatchSchema } from './schemas/dispatch.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { Transaction, TransactionSchema } from '../escrow/schemas/transaction.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Dispatch.name, schema: DispatchSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [LogisticsController],
  providers: [LogisticsService],
  exports: [LogisticsService],
})
export class LogisticsModule {}
