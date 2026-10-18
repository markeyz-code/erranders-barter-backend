import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ItemsService } from '../items/items.service';

@ApiTags('Reels')
@Controller('reels')
export class ReelsController {
  constructor(private itemsService: ItemsService) {}

  @Get()
  @ApiOperation({ summary: 'Instagram Reels media feed (all items and services)' })
  async getReels(@Query('userId') userId?: string, @Query('filter') filter?: string) {
    return this.itemsService.getReelsFeed(userId, filter);
  }

  @Get('feed')
  @ApiOperation({ summary: 'Instagram Reels media feed alias' })
  async getReelsFeed(@Query('userId') userId?: string, @Query('filter') filter?: string) {
    return this.itemsService.getReelsFeed(userId, filter);
  }
}
