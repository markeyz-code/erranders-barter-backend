import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  role: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
