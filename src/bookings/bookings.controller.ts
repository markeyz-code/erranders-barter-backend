import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { RescheduleBookingDto } from './dto/reschedule-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { DeclineBookingDto } from './dto/decline-booking.dto';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Request a booking for an available service slot' })
  async create(@Req() req, @Body() body: CreateBookingDto) {
    return this.bookingsService.create(body, req.user.userId);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Bookings you made as a customer' })
  async findMine(@Req() req) {
    return this.bookingsService.findMine(req.user.userId);
  }

  @Get('received')
  @ApiOperation({ summary: 'Bookings you received as a provider' })
  async findReceived(@Req() req) {
    return this.bookingsService.findReceived(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Booking detail (participants only)' })
  async findOne(@Param('id') id: string, @Req() req) {
    return this.bookingsService.findOne(id, req.user.userId);
  }

  @Patch(':id/accept')
  @ApiOperation({ summary: 'Provider accepts: confirms, opens chat, mints video link when remote' })
  async accept(@Param('id') id: string, @Req() req) {
    return this.bookingsService.accept(id, req.user.userId);
  }

  @Patch(':id/decline')
  @ApiOperation({ summary: 'Provider declines a pending booking' })
  async decline(@Param('id') id: string, @Req() req, @Body() body: DeclineBookingDto) {
    return this.bookingsService.decline(id, req.user.userId, body?.reason);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Either party cancels a pending or confirmed booking' })
  async cancel(@Param('id') id: string, @Req() req, @Body() body: CancelBookingDto) {
    return this.bookingsService.cancel(id, req.user.userId, body?.reason);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Provider marks a confirmed booking as completed' })
  async complete(@Param('id') id: string, @Req() req) {
    return this.bookingsService.complete(id, req.user.userId);
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Either party moves a booking to another validated slot' })
  async reschedule(@Param('id') id: string, @Req() req, @Body() body: RescheduleBookingDto) {
    return this.bookingsService.reschedule(id, req.user.userId, body);
  }
}
