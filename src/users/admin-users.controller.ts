import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard';
import { UsersService } from './users.service';

@ApiTags('Admin — Users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List every user (admin only)' })
  async findAll() {
    return this.usersService.findAllForAdmin();
  }

  @Get(':id')
  @ApiOperation({ summary: 'User, listings, escrows and withdrawals for the admin detail panel' })
  async findOne(@Param('id') id: string) {
    return this.usersService.getAdminUserDetail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Verify, suspend, unsuspend or promote an account (whitelisted flags only)' })
  async update(@Param('id') id: string, @Body() body: any, @Req() req) {
    const isSelf = req.user.userId === id;

    if (isSelf && body && body.isAdmin === false) {
      throw new BadRequestException('You cannot remove your own admin access');
    }
    if (isSelf && (body?.isActive === false || body?.suspended === true)) {
      throw new BadRequestException('You cannot suspend your own account');
    }

    return this.usersService.adminUpdateUser(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Hard-delete an account, refusing while funds or trades are in flight' })
  async remove(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req) {
    if (req.user.userId === id) {
      throw new BadRequestException(
        'Use DELETE /users/me to delete your own account, so the normal safety checks still apply.',
      );
    }
    return this.usersService.deleteAccount(id, body?.reason);
  }
}
