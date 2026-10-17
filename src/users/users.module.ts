import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User, UserSchema } from './schemas/user.schema';
import { Item, ItemSchema } from '../items/schemas/item.schema';
import { Transaction, TransactionSchema } from '../escrow/schemas/transaction.schema';
import { Offer, OfferSchema } from '../offers/schemas/offer.schema';
import { Chat, ChatSchema } from '../chat/schemas/chat.schema';
import { Message, MessageSchema } from '../chat/schemas/message.schema';
import { Withdrawal, WithdrawalSchema } from '../withdrawals/schemas/withdrawal.schema';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [
    PaymentsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Item.name, schema: ItemSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Chat.name, schema: ChatSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Withdrawal.name, schema: WithdrawalSchema },
    ])
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
