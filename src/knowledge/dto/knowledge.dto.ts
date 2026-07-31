import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class KnowledgeDto {
  @ApiProperty({
    description: '内容',
    example: '这是内容',
  })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiProperty({
    description: '标题',
    example: '这是标题',
  })
  @IsString()
  @MinLength(1)
  title!: string;
}

export class RagDto {
  @ApiProperty({
    description: '问题',
    example: '这是问题',
  })
  @IsString()
  @MinLength(1)
  question!: string;

  @ApiProperty({
    description: '用户id',
    example: 'user001',
  })
  @IsString()
  @MinLength(1)
  userId!: string;
}
