import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Service, ServiceSchema } from '../services/schemas/service.schema';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [
    ServicesModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Service.name, schema: ServiceSchema },
    ]),
  ],
  controllers: [ProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
