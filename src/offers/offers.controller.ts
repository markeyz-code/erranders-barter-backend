import { Controller, Post, Get, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { OfferStatus } from './schemas/offer.schema';

@Controller('offers')
@UseGuards(AuthGuard('jwt'))
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Post()
  createOffer(@Request() req, @Body() dto: CreateOfferDto) {
    return this.offersService.createOffer(req.user.userId, dto);
  }

  @Get('my-offers')
  getMyOffers(@Request() req) {
    return this.offersService.getMyOffers(req.user.userId);
  }

  @Get('received')
  getReceivedOffers(@Request() req) {
    return this.offersService.getReceivedOffers(req.user.userId);
  }

  @Patch(':id/status')
  updateOfferStatus(
    @Param('id') id: string,
    @Request() req,
    @Body() body: { status: OfferStatus; receiverSwapDetails?: string; receiverHandoverNotes?: string }
  ) {
    return this.offersService.updateOfferStatus(id, req.user.userId, body.status, body);
  }
}
