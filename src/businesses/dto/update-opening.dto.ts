import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Contract type is fixed when a role is posted (changing it would repost the job), and a
 * null `pay` clears the advertised amount instead of writing 0.
 */
export class UpdateOpeningDto {
  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description?: string;

  @IsOptional()
  @IsNumber({}, { message: 'pay must be a number' })
  @Min(0)
  pay?: number;
}
