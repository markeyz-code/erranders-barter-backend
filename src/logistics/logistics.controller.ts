import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { LogisticsService, CreateDispatchInput, UpdateDispatchInput } from './logistics.service';

@ApiTags('Logistics')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('logistics')
export class LogisticsController {
  constructor(private logisticsService: LogisticsService) {}

  @Get('deliveries')
  @ApiOperation({ summary: 'List delivery dispatches (optional status/search + pagination)' })
  async findAll(@Query() query: any) {
    return this.logisticsService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Dispatch counters for the admin logistics board' })
  async getStats() {
    return this.logisticsService.getStats();
  }

  @Get('deliveries/:id')
  @ApiOperation({ summary: 'Get a single delivery dispatch' })
  async findOne(@Param('id') id: string) {
    return this.logisticsService.findOne(id);
  }

  @Post('deliveries')
  @ApiOperation({ summary: 'Create a barter delivery dispatch and hand it to Erranders' })
  async create(@Body() body: CreateDispatchInput, @Req() req) {
    return this.logisticsService.createDispatch(body, req.user.userId);
  }

  @Patch('deliveries/:id')
  @ApiOperation({ summary: 'Assign a rider or update a dispatch status' })
  async update(@Param('id') id: string, @Body() body: UpdateDispatchInput) {
    return this.logisticsService.update(id, body);
  }

  @Post('deliveries/:id/retry')
  @ApiOperation({ summary: 'Retry a pending or failed dispatch against the Erranders API' })
  async retry(@Param('id') id: string) {
    return this.logisticsService.retryDispatch(id);
  }
}
