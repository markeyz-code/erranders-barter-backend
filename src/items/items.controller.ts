import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ItemsService } from './items.service';

@ApiTags('Items')
@Controller('items')
export class ItemsController {
  constructor(private itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active items (with optional search/filter)' })
  async findAll(@Query() query: any) {
    return this.itemsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single item by ID' })
  async findOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new listing' })
  async create(@Body() body: any, @Req() req) {
    return this.itemsService.create(body, req.user.userId);
  }

  @Get('me/listings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user active listings' })
  async findMyListings(@Req() req) {
    return this.itemsService.findMyListings(req.user.userId);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update your own listing' })
  async update(@Param('id') id: string, @Body() body: any, @Req() req) {
    return this.itemsService.update(id, req.user.userId, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete your own listing (blocked while it is in an active trade)' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.itemsService.remove(id, req.user.userId);
  }
}
