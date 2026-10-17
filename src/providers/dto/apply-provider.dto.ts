import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyProviderDto {
  @IsString()
  @MaxLength(120)
  headline: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  serviceArea?: string;
}
