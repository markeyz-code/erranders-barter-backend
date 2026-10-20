import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { JobType } from '../schemas/business.schema';

export class CreateOpeningDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description: string;

  @IsEnum(JobType, {
    message: `type must be one of: ${Object.values(JobType).join(', ')}`,
  })
  type: JobType;

  @IsOptional()
  @IsNumber({}, { message: 'pay must be a number' })
  @Min(0)
  pay?: number;
}
