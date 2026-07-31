import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module';
import { PrismaModule } from './prisma/prisma.module';
import { KnowledgeModule } from './knowledge/knowledge.module';

@Module({
  imports: [AiModule, PrismaModule, KnowledgeModule],
})
export class AppModule {}
