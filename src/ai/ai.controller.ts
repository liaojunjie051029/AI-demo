import { Controller, Post, Body, Get, Sse, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ChatDto, ChatWithContextDto, memoryDto, ragDto } from './dto/chat.dto';
import { Observable } from 'rxjs';
import express from 'express';

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

  // post 请求
  @Post('chat-stream')
  @ApiOperation({ summary: '和 AI 对话（流式 post 方式）' })
  chatStream_post(
    @Body() dto: { sessionId: string; content: string },
    @Res() res: express.Response,
  ) {
    // 手动设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const observable = this.aiService.chatStreamWithContext(
      dto.sessionId,
      dto.content,
    );
    interface StreamEvent {
      data: string;
    }

    const subscriber = {
      next: (event: StreamEvent) => {
        res.write(`data: ${event.data}\n\n`);
      },
      error: (err: any) => {
        console.error(err);
        res.status(500).end();
      },
      complete: () => {
        res.end();
      },
    };

    observable.subscribe(subscriber);
  }
  // 正式项目用 POST + 流式。
  // 原因：
  // 参数安全 — 用户消息不会暴露在 URL 日志里
  // 无长度限制 — URL 最长约 2000 字符，Body 没有限制，用户可以发很长的消息
  // 支持复杂参数 — 可以传 JSON 对象，比如 { sessionId, content, model, temperature }
  // 行业标准 — ChatGPT、Claude、DeepSeek 的 API 都是 POST + 流式

  @Get('chat-stream/context')
  @Sse('chat-stream/context')
  @ApiQuery({ name: 'content', example: '你好' })
  @ApiOperation({ summary: '和 AI 对话（流式）,带上下文的对话' })
  chatStreamwithcontext(
    @Query('sessionId') sessionId: string,
    @Query('content') content: string,
  ): Observable<any> {
    return this.aiService.chatStreamWithContext(sessionId, content);
  }

  @Get('all')
  @ApiOperation({ summary: '获取所有会话' })
  getAll() {
    return this.aiService.getAll();
  }

  @Post('extract-memory')
  @ApiOperation({ summary: '提取用户记忆' })
  extractMemory(@Body() dto: memoryDto) {
    return this.aiService.extractMemory(dto.userId, dto.sessionId);
  }

  @Post('rag-chat')
  @ApiOperation({ summary: ' RAG 聊天（流式）' })
  ragChat(@Body() dto: ragDto, @Res() res: express.Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const observable = this.aiService.ragChat(
      dto.userId,
      dto.sessionId,
      dto.content,
    );

    interface StreamEvent {
      data: string;
    }

    observable.subscribe({
      next: (envent: StreamEvent) => {
        res.write(`data: ${envent.data}\n\n`);
      },
      error: (error: any) => {
        console.error(error);
        res.status(500).end();
      },
      complete: () => {
        res.end();
      },
    });
  }

  @Post('chat-mcp')
  @ApiOperation({ summary: 'MCP 文件管理对话' })
  chatMCP(@Body() dto: ChatDto) {
    return this.aiService.chatWithMCP(dto.content);
  }

  @Post('chat-search')
  @ApiOperation({ summary: '搜索对话' })
  chatSearch(@Body() dto: ChatDto) {
    return this.aiService.chatWithSearch(dto.content);
  }

  @Post('chat-baidu')
  @ApiOperation({ summary: '百度搜索对话' })
  chatBaidu(@Body() dto: ChatDto) {
    return this.aiService.chatWithBaidu(dto.content);
  }
}
