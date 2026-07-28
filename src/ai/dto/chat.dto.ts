import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChatDto {
  @ApiProperty({ example: '你好，介绍一下你自己' })
  @IsString()
  @MinLength(1)
  content!: string;
}

export class ChatWithContextDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(1)
  sessionId!: string;

  @ApiProperty({ example: '你好，介绍一下你自己' })
  @IsString()
  @MinLength(1)
  content!: string;
}
