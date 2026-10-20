import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BusinessesService } from './businesses.service';
import { ApplyBusinessDto } from './dto/apply-business.dto';
import { UpdateBusinessDto } from './dto/update-business.dto';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { CreateOpeningDto } from './dto/create-opening.dto';
import { UpdateOpeningDto } from './dto/update-opening.dto';

/**
 * The business owner's mini-admin API.
 *
 * Every `me` route resolves the business *from* the token's userId (BusinessesService
 * .getOwnedBusiness) rather than from a path id, so one owner can never address another
 * owner's business. Staff and opening ids are then matched inside that business only.
 *
 * All `me` routes are declared before `:slug` so the public lookup never swallows them.
 */
@ApiTags('Businesses')
@Controller('businesses')
export class BusinessesController {
  constructor(private readonly businessesService: BusinessesService) {}

  @Post('apply')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Apply as a business; the caller becomes its owner' })
  async apply(@Req() req, @Body() body: ApplyBusinessDto) {
    return this.businessesService.apply(req.user.userId, body);
  }

  @Get()
  @ApiOperation({ summary: 'Public directory of active businesses (optionally by category)' })
  async listPublic(@Query() query: any) {
    return this.businessesService.listPublic(query);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: "The caller's business, its staff and its openings (404 if none)" })
  async getMine(@Req() req) {
    return this.businessesService.getMine(req.user.userId);
  }

  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Update your business profile (commissionRate/isVerified are admin-only)',
  })
  async updateMine(@Req() req, @Body() body: UpdateBusinessDto) {
    return this.businessesService.updateMine(req.user.userId, body);
  }

  @Get('me/staff')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List your staff' })
  async listStaff(@Req() req) {
    return this.businessesService.listStaff(req.user.userId);
  }

  @Post('me/staff')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a staff member' })
  async addStaff(@Req() req, @Body() body: CreateStaffDto) {
    return this.businessesService.addStaff(req.user.userId, body);
  }

  @Patch('me/staff/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a staff member (role, phone, active)' })
  async updateStaff(@Req() req, @Param('id') id: string, @Body() body: UpdateStaffDto) {
    return this.businessesService.updateStaff(req.user.userId, id, body);
  }

  @Delete('me/staff/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a staff member' })
  async removeStaff(@Req() req, @Param('id') id: string) {
    return this.businessesService.removeStaff(req.user.userId, id);
  }

  @Get('me/openings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List your recruitment openings' })
  async listOpenings(@Req() req) {
    return this.businessesService.listOpenings(req.user.userId);
  }

  @Post('me/openings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Post a recruitment opening' })
  async addOpening(@Req() req, @Body() body: CreateOpeningDto) {
    return this.businessesService.addOpening(req.user.userId, body);
  }

  @Patch('me/openings/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an opening (open/closed, copy, pay)' })
  async updateOpening(@Req() req, @Param('id') id: string, @Body() body: UpdateOpeningDto) {
    return this.businessesService.updateOpening(req.user.userId, id, body);
  }

  @Delete('me/openings/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a recruitment opening' })
  async removeOpening(@Req() req, @Param('id') id: string) {
    return this.businessesService.removeOpening(req.user.userId, id);
  }

  @Get('me/earnings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Commission ledger computed from the business completed bookings' })
  async getEarnings(@Req() req) {
    return this.businessesService.getEarnings(req.user.userId);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public business page (profile + open roles) by slug' })
  async getPublic(@Param('slug') slug: string) {
    return this.businessesService.getPublicBySlug(slug);
  }
}
