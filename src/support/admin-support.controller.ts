import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
import { SupportService } from './support.service';

/**
 * The moderation queue.
 *
 * Reports were being stored with no way to work them — a queue nobody can see is the same
 * as no reporting at all. This is the admin surface that makes the reports actionable.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('reports')
  @ApiOperation({ summary: 'Reports, filterable by status and reason' })
  async reports(@Query() query: any) {
    return this.support.listReports(query);
  }

  @Patch('reports/:id')
  @ApiOperation({ summary: 'Move a report to reviewing, resolved or dismissed' })
  async resolve(@Param('id') id: string, @Body() body: any) {
    return this.support.resolveReport(id, body);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Support tickets' })
  async tickets(@Query() query: any) {
    return this.support.listTickets(query);
  }

  @Patch('tickets/:id')
  @ApiOperation({ summary: 'Reply to or close a support ticket' })
  async reply(@Param('id') id: string, @Body() body: any) {
    return this.support.updateTicket(id, body);
  }
}
