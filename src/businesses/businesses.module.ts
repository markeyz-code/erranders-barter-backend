import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BusinessesController } from './businesses.controller';
import { AdminBusinessesController } from './admin-businesses.controller';
import { BusinessesService } from './businesses.service';
import { BusinessOperationsService } from './business-operations.service';
import { BusinessOperationsController } from './business-operations.controller';
import { PublicApplicationsController } from './public-applications.controller';
import { Business, BusinessSchema } from './schemas/business.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';

/**
 * Business vendor accounts: profile, staff, recruitment and the commission ledger.
 *
 * AdminGuard comes from the @Global AdminModule, so this module never imports it directly —
 * the admin controller can still use it. Booking/Service/User are registered so the ledger
 * can populate the provider, customer and service on each payout row. SettingsModule supplies
 * the admin-controlled default commission a new business starts with.
 */
@Module({
  imports: [
    SettingsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Business.name, schema: BusinessSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BusinessesController, AdminBusinessesController, BusinessOperationsController, PublicApplicationsController],
  providers: [BusinessesService, BusinessOperationsService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
