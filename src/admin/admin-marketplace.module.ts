import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminMarketplaceController } from './admin-marketplace.controller';
import { AdminMarketplaceService } from './admin-marketplace.service';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { User, UserSchema } from '../users/schemas/user.schema';

/**
 * Admin routes for the services vertical. Kept in its own module (rather than the global
 * AdminModule, which owns dashboard stats and the AdminGuard) so the marketplace workstream
 * does not have to touch shared files. AdminGuard is available because AdminModule is
 * @Global and exports it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Service.name, schema: ServiceSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [AdminMarketplaceController],
  providers: [AdminMarketplaceService],
})
export class AdminMarketplaceModule {}
