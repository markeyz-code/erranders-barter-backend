import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class WeeklyWindowDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm (24-hour)' })
  startTime: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm (24-hour)' })
  endTime: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
