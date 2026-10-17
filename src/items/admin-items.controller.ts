import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
import { ItemsService } from './items.service';

@ApiTags('Admin — Items')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/items')
export class AdminItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'List every listing, including inactive ones (admin only)' })
  async findAll(@Query() query: any) {
    return this.itemsService.findAllForAdmin(query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Moderate a listing: status, isActive, isFeatured/isPromoted' })
  async update(@Param('id') id: string, @Body() body: any) {
    return this.itemsService.moderate(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove any listing (blocked while it is in an active trade)' })
  async remove(@Param('id') id: string) {
    return this.itemsService.removeAsAdmin(id);
  }
}
