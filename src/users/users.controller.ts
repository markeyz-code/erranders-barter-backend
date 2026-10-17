import {
  Controller,
  Get,
  Patch,
  Put,
  Post,
  Delete,
  Body,
  UseGuards,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('admin/all')
  async getAllUsers() {
    return this.usersService.findAll();
  }

  @Get('me/stats')
  @UseGuards(AuthGuard('jwt'))
  async getMyStats(@Req() req) {
    return this.usersService.getMyStats(req.user.userId);
  }

  @Get('me/recently-viewed')
  @UseGuards(AuthGuard('jwt'))
  async getRecentlyViewed(@Req() req) {
    return this.usersService.getRecentlyViewed(req.user.userId);
  }

  @Post('me/recently-viewed')
  @UseGuards(AuthGuard('jwt'))
  async addRecentlyViewed(@Req() req, @Body() body: { itemId?: string; vendorId?: string }) {
    // The website helper names the field vendorId; both refer to the viewed item.
    const itemId = body?.itemId || body?.vendorId;
    if (!itemId) throw new BadRequestException('itemId is required');
    return this.usersService.addRecentlyViewed(req.user.userId, itemId);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getMe(@Req() req) {
    return this.usersService.findById(req.user.userId);
  }

  @Patch('me')
  @UseGuards(AuthGuard('jwt'))
  async updateProfile(@Req() req, @Body() body: any) {
    return this.usersService.update(req.user.userId, body);
  }

  // The website sends PUT for profile updates; kept alongside PATCH so both callers work.
  @Put('me')
  @UseGuards(AuthGuard('jwt'))
  async replaceProfile(@Req() req, @Body() body: any) {
    return this.usersService.update(req.user.userId, body);
  }

  @Put('me/fcm-token')
  @UseGuards(AuthGuard('jwt'))
  async updateFcmToken(@Req() req, @Body() body: { token?: string; fcmToken?: string }) {
    return this.usersService.updateFcmToken(req.user.userId, body?.token ?? body?.fcmToken);
  }

  @Delete('me')
  @UseGuards(AuthGuard('jwt'))
  async deleteAccount(@Req() req, @Body() body: { reason?: string }) {
    return this.usersService.deleteAccount(req.user.userId, body?.reason);
  }

  @Get('me/bank-details')
  @UseGuards(AuthGuard('jwt'))
  async getBankDetails(@Req() req, @Res() res: Response) {
    const bankDetails = await this.usersService.getBankDetails(req.user.userId);
    // Sent explicitly so "no saved account" is a JSON null rather than an empty body.
    return res.status(200).json(bankDetails);
  }

  @Put('me/bank-details')
  @UseGuards(AuthGuard('jwt'))
  async updateBankDetails(
    @Req() req,
    @Body() body: { bankCode?: string | number; bankName?: string; accountNumber?: string },
  ) {
    return this.usersService.updateBankDetails(req.user.userId, body);
  }

  @Post('me/withdraw')
  @UseGuards(AuthGuard('jwt'))
  async withdraw(@Req() req, @Body() body: { amount?: number | string }) {
    if (body?.amount === undefined || body?.amount === null || body?.amount === '') {
      throw new BadRequestException('Amount is required');
    }
    return this.usersService.withdraw(req.user.userId, Number(body.amount));
  }

  @Get('me/withdrawals')
  @UseGuards(AuthGuard('jwt'))
  async getWithdrawals(@Req() req) {
    return this.usersService.getWithdrawals(req.user.userId);
  }
}
