import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * The admin money/trust surface. `commissionRate` is a percent of gross earnings, so 0–50 is
 * enforced here and again in the service (defence in depth for non-HTTP callers).
 */
export class AdminUpdateBusinessDto {
  @IsOptional()
  @IsNumber({}, { message: 'commissionRate must be a number' })
  @Min(0)
  @Max(50)
  commissionRate?: number;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
