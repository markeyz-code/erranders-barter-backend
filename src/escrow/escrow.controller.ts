import { Controller, Post, Patch, Get, Body, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { EscrowService } from './escrow.service';

@ApiTags('Escrow')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('escrow')
export class EscrowController {
  constructor(private escrowService: EscrowService) {}

  @Post('initiate')
  @ApiOperation({ summary: 'Initiate an escrow transaction' })
  async initiate(@Body() body: { sellerId: string; itemId: string; amount: number, deliveryMethod?: string, deliveryAddress?: string, paymentReference?: string, deliveryFee?: number, batchId?: string, moverId?: string, moverScheduleSlot?: string }, @Req() req) {
    return this.escrowService.initiate({ ...body, buyerId: req.user.userId });
  }

  @Patch(':id/release')
  @ApiOperation({ summary: 'Buyer releases funds to seller' })
  async release(@Param('id') id: string, @Req() req) {
    return this.escrowService.release(id, req.user.userId);
  }

  @Patch(':id/dispute')
  @ApiOperation({ summary: 'Raise a dispute on a transaction' })
  async dispute(@Param('id') id: string, @Req() req) {
    return this.escrowService.dispute(id, req.user.userId);
  }

  @Get('my-transactions')
  @ApiOperation({ summary: 'List all transactions for the current user' })
  async myTransactions(@Req() req) {
    return this.escrowService.findByUser(req.user.userId);
  }

  @Get('admin/all')
  @ApiOperation({ summary: 'List all transactions (Admin)' })
  async allTransactions() {
    return this.escrowService.findAll();
  }

  @Patch(':id/accept-negotiation')
  @ApiOperation({ summary: 'Accept a delivery negotiation from an Errander' })
  async acceptNegotiation(@Param('id') id: string, @Req() req) {
    return this.escrowService.acceptNegotiation(id, req.user.userId);
  }

  @Patch(':id/counter-negotiation')
  @ApiOperation({ summary: 'Counter a delivery negotiation from an Errander' })
  async counterNegotiation(@Param('id') id: string, @Body() body: { amount: number }, @Req() req) {
    return this.escrowService.counterNegotiation(id, req.user.userId, body.amount);
  }
}
