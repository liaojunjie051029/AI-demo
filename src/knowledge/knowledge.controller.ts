import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { KnowledgeDto, RagDto } from './dto/knowledge.dto';

@ApiTags('知识库')
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  //上传文档 -> 切片 -> 向量化 -> 存入 Qdrant
  @Post('upload')
  @ApiOperation({ summary: '上传文档' })
  upload(@Body() body: KnowledgeDto) {
    return this.knowledgeService.upload(body.content, body.title);
  }
  // 搜索向量库（测试用，看搜到了什么）
  @Get('search')
  @ApiOperation({ summary: '搜索知识库' })
  search(@Query('query') query: string) {
    return this.knowledgeService.search(query);
  }

  //rag 对话
  @Get('rag')
  @ApiOperation({ summary: ' rag 对话' })
  async rag(@Query('question') question: string) {
    return this.knowledgeService.ragChat(question);
  }

  @Post('rag-chat-memory')
  @ApiOperation({ summary: '带记忆的 RAG 对话' })
  ragChatMemory(@Body() dto: RagDto) {
    return this.knowledgeService.ragChatWithMemory(dto.userId, dto.question);
  }
}
