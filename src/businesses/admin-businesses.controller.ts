import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
import { BusinessesService } from './businesses.service';
import { AdminUpdateBusinessDto } from './dto/admin-update-business.dto';

/**
 * Admin surface for business vendors: the place the owner asked for, where Erranders sets
 * the commission a business pays. Uses the platform AdminGuard (isAdmin or ADMIN_EMAILS),
 * not a role claim, matching every other /admin/* route.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminBusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Get('businesses')
  @ApiOperation({ summary: 'All businesses with staff, openings and earnings counts' })
  async list(@Query() query: any) {
    return this.businessesService.listForAdmin(query);
  }

  @Patch('businesses/:id')
  @ApiOperation({ summary: 'Set commission rate, verification or paused status' })
  async update(@Param('id') id: string, @Body() body: AdminUpdateBusinessDto) {
    return this.businessesService.adminUpdate(id, body);
  }
}
