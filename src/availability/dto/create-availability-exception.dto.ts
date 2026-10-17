import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateAvailabilityExceptionDto {
  @IsString()
  @Matches(DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @IsBoolean()
  isBlocked: boolean;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm (24-hour)' })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm (24-hour)' })
  endTime?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
