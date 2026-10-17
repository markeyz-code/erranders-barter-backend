import { IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateBookingDto {
  @IsMongoId()
  serviceId: string;

  @IsString()
  @Matches(DATE_PATTERN, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm (24-hour)' })
  startTime: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
