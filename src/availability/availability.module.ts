import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import {
  ProviderAvailability,
  ProviderAvailabilitySchema,
} from './schemas/provider-availability.schema';
import {
  AvailabilityException,
  AvailabilityExceptionSchema,
} from './schemas/availability-exception.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { Booking, BookingSchema } from '../bookings/schemas/booking.schema';

// Service and Booking are registered here as schemas rather than importing their modules, so
// this module has no dependency on ServicesModule / BookingsModule (both of which need the
// slot computation themselves). This is the same pattern ItemsModule uses for Transaction.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProviderAvailability.name, schema: ProviderAvailabilitySchema },
      { name: AvailabilityException.name, schema: AvailabilityExceptionSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
