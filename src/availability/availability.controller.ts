import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { CreateAvailabilityExceptionDto } from './dto/create-availability-exception.dto';

@ApiTags('Availability')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get your weekly working windows and date overrides' })
  async getMine(@Req() req) {
    return this.availabilityService.getMine(req.user.userId);
  }

  @Put('me')
  @ApiOperation({ summary: 'Replace your weekly windows (send the array)' })
  async replaceWeekly(@Req() req, @Body() body: any) {
    return this.availabilityService.replaceWeekly(req.user.userId, body);
  }

  @Post('me/exceptions')
  @ApiOperation({ summary: 'Block a whole day, block a time range, or open an ad-hoc window' })
  async addException(@Req() req, @Body() body: CreateAvailabilityExceptionDto) {
    return this.availabilityService.addException(req.user.userId, body);
  }

  @Delete('me/exceptions/:id')
  @ApiOperation({ summary: 'Remove one of your date overrides' })
  async removeException(@Req() req, @Param('id') id: string) {
    return this.availabilityService.removeException(req.user.userId, id);
  }
}
