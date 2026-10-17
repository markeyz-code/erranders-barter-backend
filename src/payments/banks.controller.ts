import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PaystackService } from './paystack.service';

@ApiTags('Banks')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('banks')
export class BanksController {
  constructor(private readonly paystackService: PaystackService) {}

  @Get()
  @ApiOperation({ summary: 'List the Nigerian banks Paystack can pay out to' })
  async listBanks() {
    return this.paystackService.listBanks();
  }

  @Get('resolve')
  @ApiOperation({ summary: 'Resolve an account number to its account holder name' })
  async resolveAccount(
    @Query('accountNumber') accountNumber: string,
    @Query('bankCode') bankCode: string,
  ) {
    const cleanAccountNumber = typeof accountNumber === 'string' ? accountNumber.trim() : '';
    const cleanBankCode = typeof bankCode === 'string' ? bankCode.trim() : '';

    if (!cleanAccountNumber) throw new BadRequestException('accountNumber is required');
    if (!cleanBankCode) throw new BadRequestException('bankCode is required');
    if (!/^\d{10}$/.test(cleanAccountNumber)) {
      throw new BadRequestException('accountNumber must be a 10-digit NUBAN account number');
    }

    return this.paystackService.resolveAccount(cleanAccountNumber, cleanBankCode);
  }
}
