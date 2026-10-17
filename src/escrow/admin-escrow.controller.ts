import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
import { EscrowService } from './escrow.service';

@ApiTags('Admin — Escrow')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/escrows')
export class AdminEscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Get()
  @ApiOperation({ summary: 'List every escrow with buyer/seller/item summaries (admin only)' })
  async findAll(@Query() query: any) {
    return this.escrowService.findForAdmin(query);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Resolve a held/disputed escrow: release to seller or refund the buyer' })
  async resolve(
    @Param('id') id: string,
    @Body() body: { resolution?: 'release' | 'refund'; note?: string },
    @Req() req,
  ) {
    if (!body?.resolution) {
      throw new BadRequestException("resolution is required: 'release' or 'refund'");
    }
    return this.escrowService.resolveDispute(id, body.resolution, body.note, req.user.userId);
  }
}
