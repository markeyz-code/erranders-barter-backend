import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ItemsService } from './items.service';
import { ItemsController } from './items.controller';
import { AdminItemsController } from './admin-items.controller';
import { Item, ItemSchema } from './schemas/item.schema';
import { Transaction, TransactionSchema } from '../escrow/schemas/transaction.schema';
import { Offer, OfferSchema } from '../offers/schemas/offer.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Setting, SettingSchema } from '../settings/schemas/setting.schema';
import { UploadModule } from '../upload/upload.module';

import { ReelsController } from '../reels/reels.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Item.name, schema: ItemSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: User.name, schema: UserSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Setting.name, schema: SettingSchema },
    ]),
    UploadModule,
  ],
  controllers: [ItemsController, ReelsController, AdminItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
