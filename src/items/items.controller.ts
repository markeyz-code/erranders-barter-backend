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

  @Get('catch-up')
  @ApiOperation({ summary: 'Catch up: fetch listings and services added since user last visited' })
  async getCatchUp(@Query('since') since?: string) {
    return this.itemsService.getCatchUpListings(since);
  }

  @Get('reels')
  @ApiOperation({ summary: 'Instagram Reels feed for campus marketplace items and services' })
  async getReels(@Query('userId') userId?: string, @Query('filter') filter?: string) {
    return this.itemsService.getReelsFeed(userId, filter);
  }

  @Get('reels/feed')
  @ApiOperation({ summary: 'Instagram Reels feed alias' })
  async getReelsAlias(@Query('userId') userId?: string, @Query('filter') filter?: string) {
    return this.itemsService.getReelsFeed(userId, filter);
  }

  @Get('declutter-batch/:batchId')
  @ApiOperation({ summary: 'Get all items and bundle discount for a declutter batch' })
  async getDeclutterBatch(@Param('batchId') batchId: string) {
    return this.itemsService.findDeclutterBatch(batchId);
  }

  @Get('me/listings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List current user active listings' })
  async findMyListings(@Req() req) {
    return this.itemsService.findMyListings(req.user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single item by ID' })
  async findOne(@Param('id') id: string) {
    return this.itemsService.findOne(id);
  }

  @Post('declutter-batch')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish an automated batch of room declutter items' })
  async createDeclutterBatch(@Body() body: any, @Req() req) {
    return this.itemsService.createDeclutterBatch(body, req.user.userId);
  }

  @Post(':id/like')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle like on a reel item' })
  async toggleLike(@Param('id') id: string, @Req() req) {
    return this.itemsService.toggleLike(id, req.user.userId);
  }

  @Post(':id/comment')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a comment to a reel item' })
  async addComment(@Param('id') id: string, @Body('text') text: string, @Req() req) {
    return this.itemsService.addComment(id, req.user.userId, text);
  }

  @Post(':id/comments')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a comment to a reel item (alias)' })
  async addComments(@Param('id') id: string, @Body('text') text: string, @Req() req) {
    return this.itemsService.addComment(id, req.user.userId, text);
  }

  @Post(':id/repost')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Repost a reel item' })
  async repostItem(@Param('id') id: string, @Req() req) {
    return this.itemsService.repostItem(id, req.user.userId);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new listing' })
  async create(@Body() body: any, @Req() req) {
    return this.itemsService.create(body, req.user.userId);
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

