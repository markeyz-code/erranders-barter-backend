import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { AdminMarketplaceService } from './admin-marketplace.service';
import { ModerateServiceDto } from './dto/moderate-service.dto';

/**
 * Admin surface for the services vertical.
 *
 * Uses the platform AdminGuard (isAdmin on the account, or an ADMIN_EMAILS allowlist entry)
 * rather than a role claim, matching the rest of the /admin/* surface.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminMarketplaceController {
  constructor(private readonly adminService: AdminMarketplaceService) {}

  @Get('services')
  @ApiOperation({ summary: 'All services (active or not), filterable and paginated' })
  async listServices(@Query() query: any) {
    return this.adminService.listServices(query);
  }

  @Patch('services/:id')
  @ApiOperation({ summary: 'Deactivate or reactivate a service' })
  async moderateService(@Param('id') id: string, @Body() body: ModerateServiceDto) {
    return this.adminService.moderateService(id, body);
  }

  @Delete('services/:id')
  @ApiOperation({ summary: 'Delete a service completely from marketplace' })
  async deleteService(@Param('id') id: string) {
    return this.adminService.deleteService(id);
  }

  @Get('bookings')
  @ApiOperation({ summary: 'All bookings, filterable by status/date/participant' })
  async listBookings(@Query() query: any) {
    return this.adminService.listBookings(query);
  }

  @Patch('bookings/:id/status')
  @ApiOperation({ summary: 'Moderate or cancel a booking (admin action)' })
  async updateBookingStatus(
    @Param('id') id: string,
    @Body() body: { status: string; reason?: string },
  ) {
    return this.adminService.updateBookingStatus(id, body);
  }

  @Get('providers')
  @ApiOperation({ summary: 'All providers with service and booking counts' })
  async listProviders(@Query() query: any) {
    return this.adminService.listProviders(query);
  }

  @Patch('providers/:id')
  @ApiOperation({ summary: 'Update provider status (accepting bookings / verified)' })
  async updateProvider(
    @Param('id') id: string,
    @Body() body: { isAcceptingBookings?: boolean; isServiceProvider?: boolean },
  ) {
    return this.adminService.updateProvider(id, body);
  }
}
