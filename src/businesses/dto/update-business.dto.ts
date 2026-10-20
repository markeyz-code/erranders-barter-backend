import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Owner-settable profile fields only.
 *
 * `commissionRate` and `isVerified` are deliberately missing: they are admin-controlled and
 * must not be reachable from a JWT-authenticated owner request. The global ValidationPipe
 * strips them before they reach the service, and BusinessesService whitelists the fields a
 * second time, so neither layer alone is load-bearing.
 */
export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  banner?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  businessType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  templateId?: string;

  @IsOptional()
  studyMode?: any;
}
