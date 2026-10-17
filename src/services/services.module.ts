import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { Service, ServiceSchema } from './schemas/service.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Category, CategorySchema } from '../categories/category.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';
import { AvailabilityModule } from '../availability/availability.module';

@Module({
  imports: [
    AvailabilityModule,
    MongooseModule.forFeature([
      { name: Service.name, schema: ServiceSchema },
      { name: User.name, schema: UserSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
