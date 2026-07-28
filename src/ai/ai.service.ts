import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from 'src/prisma/prisma.service';
import { Observable, Subscriber } from 'rxjs';

@Injectable()
export class AiService {
  private client: OpenAI;
  private model: string;

  constructor(private prisma: PrismaService) {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    });
    this.model = process.env.LLM_MODEL || 'qwen3.7-flash-2026-07-15';
  }

  // 阶段 1
  async chat(content: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content }],
    });
    console.log(response.usage);
    return response.choices[0].message.content || '';
  }

  // 阶段 2：流式输出
  chatStream(content: string): Observable<any> {
    return new Observable((subscriber) => {
      this.handleStream(subscriber, content);
    });
  }

  private async handleStream(subscriber: Subscriber<any>, content: string) {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content }],
        stream: true,
        stream_options: { include_usage: true }, //要看token在stream输出的情况下需要加这个
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          subscriber.next({ data: text });
        }
        if (chunk.usage) {
          console.log('Token 消耗:', chunk.usage);
        }
      }

      subscriber.next({ data: '[DONE]' });
      subscriber.complete();
    } catch (error) {
      subscriber.error(error);
    }
  }

  // 阶段 3 新增：带上下文的对话
  async chatWithContext(sessionId: string, content: string): Promise<string> {
    // 1. 保存用户消息到数据库
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content },
    });

    // 2. 从数据库读取这个会话的所有历史
    const history = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    console.log(history);

    // 3. 发给 AI（带上完整历史）
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: history as any,
    });

    const aiReply = response.choices[0].message.content || '';

    // 4. 保存 AI 回复到数据库
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: aiReply },
    });

    return aiReply;
  }
}
