import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelBookingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
