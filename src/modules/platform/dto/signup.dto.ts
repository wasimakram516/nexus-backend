import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PublicSignupDto {
  @ApiProperty({ description: 'Name of the institution to create.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  institutionName!: string;

  @ApiProperty({ description: 'Full name of the institution administrator.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
