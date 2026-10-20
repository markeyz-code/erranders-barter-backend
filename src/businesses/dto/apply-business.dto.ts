import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApplyBusinessDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  // The subdomain. Normalised and validated in BusinessesService so the 409/400 messages
  // explain exactly why a slug was rejected.
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  slug: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description: string;

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
}
