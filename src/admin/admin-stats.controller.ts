import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { AdminStatsService } from './admin-stats.service';

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminStatsController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform counters for the admin dashboard (admin only)' })
  async getStats() {
    return this.adminStatsService.getStats();
  }
}
