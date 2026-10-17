import { IsBoolean } from 'class-validator';

export class ModerateServiceDto {
  @IsBoolean()
  isActive: boolean;
}
