import { Controller, Post, Body, Get, Sse, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ChatDto, ChatWithContextDto } from './dto/chat.dto';
import { Observable } from 'rxjs';

@ApiTags('AI')
@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('chat')
  @ApiOperation({ summary: '和 AI 对话' })
  chat(@Body() dto: ChatDto) {
    return this.aiService.chat(dto.content);
  }

  @Get('chat-stream')
  @Sse('chat-stream')
  @ApiQuery({ name: 'content', example: '你好' })
  @ApiOperation({ summary: '和 AI 对话（流式）' })
  chatStream(@Query('content') content: string): Observable<any> {
    return this.aiService.chatStream(content);
  }

  @Post('chat-context')
  @ApiOperation({ summary: '带上下文的对话' })
  chatContext(@Body() dto: ChatWithContextDto) {
    return this.aiService.chatWithContext(dto.sessionId, dto.content);
  }
}
