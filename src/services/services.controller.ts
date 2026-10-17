import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@ApiTags('Services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @ApiOperation({
    summary: 'Browse active services (category, search, minPrice, maxPrice, isRemote, page, limit)',
  })
  async findAll(@Query() query: any) {
    return this.servicesService.browse(query);
  }

  // Declared before `:id` so "me" is never parsed as a service id.
  @Get('me/listings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: "The caller's own services, including paused ones" })
  async findMyListings(@Req() req) {
    return this.servicesService.findMyListings(req.user.userId);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Computed bookable slots for a service on a date (?date=YYYY-MM-DD)' })
  async getAvailability(@Param('id') id: string, @Query('date') date: string) {
    return this.servicesService.getAvailability(id, date);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public service detail with category and provider summary' })
  async findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a service listing (providers only)' })
  async create(@Body() body: CreateServiceDto, @Req() req) {
    return this.servicesService.create(body, req.user.userId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own service listing' })
  async update(@Param('id') id: string, @Body() body: UpdateServiceDto, @Req() req) {
    return this.servicesService.update(id, req.user.userId, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete your own service listing (blocked by an upcoming confirmed booking)' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.servicesService.remove(id, req.user.userId);
  }
}
