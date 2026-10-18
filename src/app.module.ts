import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ItemsModule } from './items/items.module';
import { EscrowModule } from './escrow/escrow.module';
import { UploadModule } from './upload/upload.module';
import { SettingsModule } from './settings/settings.module';
import { CategoriesModule } from './categories/categories.module';
import { ChatModule } from './chat/chat.module';
import { OffersModule } from './offers/offers.module';
import { LogisticsModule } from './logistics/logistics.module';
import { PaymentsModule } from './payments/payments.module';
import { AdminModule } from './admin/admin.module';
import { ProvidersModule } from './providers/providers.module';
import { ServicesModule } from './services/services.module';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { AdminMarketplaceModule } from './admin/admin-marketplace.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(process.env.MONGODB_URI || 'mongodb://localhost:27017/barter-dev'),
    NotificationsModule,
    AuthModule,
    UsersModule,
    ItemsModule,
    EscrowModule,
    UploadModule,
    SettingsModule,
    CategoriesModule,
    ChatModule,
    OffersModule,
    LogisticsModule,
    PaymentsModule,
    AdminModule,
    // Services / skills marketplace.
    ProvidersModule,
    ServicesModule,
    AvailabilityModule,
    BookingsModule,
    AdminMarketplaceModule,
  ],
})
export class AppModule {}