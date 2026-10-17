import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProvidersService } from './providers.service';
import { ApplyProviderDto } from './dto/apply-provider.dto';
import { UpdateProviderProfileDto } from './dto/update-provider-profile.dto';

@ApiTags('Providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Post('apply')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Become a service provider (or update the public profile)' })
  async apply(@Req() req, @Body() body: ApplyProviderDto) {
    return this.providersService.apply(req.user.userId, body);
  }

  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your provider profile or pause bookings' })
  async updateMe(@Req() req, @Body() body: UpdateProviderProfileDto) {
    return this.providersService.updateProfile(req.user.userId, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public provider card plus their active services' })
  async findOne(@Param('id') id: string) {
    return this.providersService.getPublicProvider(id);
  }

  @Get(':id/services')
  @ApiOperation({ summary: 'Public, paginated active services for a provider' })
  async findServices(@Param('id') id: string, @Query() query: any) {
    return this.providersService.getPublicServices(id, query);
  }
}
