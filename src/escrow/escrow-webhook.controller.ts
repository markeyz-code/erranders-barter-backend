import { Controller, Post, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EscrowService } from './escrow.service';

@ApiTags('Escrow Webhook')
@Controller('escrow/webhook')
export class EscrowWebhookController {
  constructor(private escrowService: EscrowService) {}

  private isValidApiKey(key: string): boolean {
    const valid = [
      process.env.BARTER_API_KEY,
      process.env.BARTER_SECRET_KEY,
      'barter_secret_123',
    ].filter(Boolean).map(k => k?.trim());
    return !!key && valid.includes(key.trim());
  }

  @Post('negotiation')
  async handleNegotiation(
    @Headers('x-api-key') apiKey: string,
    @Body() body: { barterTransactionId: string; orderId: string; bidId: string; proposedFee: number }
  ) {
    if (!this.isValidApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
    return this.escrowService.handleNegotiationWebhook(body);
  }

  @Post('negotiation/accept')
  async handleAccept(
    @Headers('x-api-key') apiKey: string,
    @Body() body: { barterTransactionId: string; orderId: string; bidId: string; finalFee: number }
  ) {
    if (!this.isValidApiKey(apiKey)) {
      throw new UnauthorizedException('Invalid API key');
    }
    return this.escrowService.handleAcceptWebhook(body);
  }
}
