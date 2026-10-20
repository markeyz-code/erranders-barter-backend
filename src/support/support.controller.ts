import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Post('reports')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report a listing, person or business' })
  async report(@Req() req, @Body() body: any) {
    return this.support.createReport(req.user.userId, body);
  }

  @Get('reports/mine')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reports I have filed' })
  async mine(@Req() req) {
    return this.support.myReports(req.user.userId);
  }

  /**
   * Contact support. Optional auth: a visitor without an account can still write in,
   * because requiring one to report a problem is a good way to never hear about problems.
   */
  @Post('tickets')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Send a message to support; returns a real reference' })
  async ticket(@Req() req, @Body() body: any) {
    return this.support.createTicket(req.user?.userId ?? null, body);
  }
}
