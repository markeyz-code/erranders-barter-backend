import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post('evolution')
  @ApiOperation({ summary: 'Evolution API WhatsApp Inbound & Delivery Webhook Endpoint' })
  async handleEvolutionWebhook(
    @Body() body: any,
    @Headers() headers?: any,
  ) {
    return this.whatsAppService.handleEvolutionWebhook(body, headers);
  }

  @Post('whatsapp')
  @ApiOperation({ summary: 'Generic WhatsApp Inbound Webhook Endpoint' })
  async handleWhatsAppWebhook(
    @Body() body: any,
    @Headers() headers?: any,
  ) {
    return this.whatsAppService.handleEvolutionWebhook(body, headers);
  }
}
