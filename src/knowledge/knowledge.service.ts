/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import OpenAI from 'openai';

// type QdrantClientType = InstanceType<
//   Awaited<typeof import('@qdrant/js-client-rest')>['QdrantClient']
// >;

@Injectable()
export class KnowledgeService implements OnModuleInit {
  private client!: any;
  private openai: OpenAI;
  private embeddingModel: string;
  private collectionName = 'knowledge_base';
  private logger = new Logger(KnowledgeService.name);

  // 这是连接向量库
  constructor(private prisma: PrismaService) {
    // 连接Qdrant
    // this.client = new QdrantClient({ host: 'localhost', port: 6333 });

    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    });

    this.embeddingModel = process.env.EMBEDDING_MODEL as string;
  }
  //这里实现onModuleInit在里面创建集合
  async onModuleInit() {
    // 动态导入：CommonJS 里可以用 await import()
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    this.client = new QdrantClient({ host: 'localhost', port: 6333 });
    const collections = await this.client.getCollections();
    const exists = collections.collections.some(
      (collection) => collection.name === this.collectionName,
    );

    if (!exists) {
      // 没有就创建一个叫 'knowledge_base' 的集合
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: 1024,
          distance: 'Cosine',
        },
      });
      this.logger.log(`向量集合${this.collectionName}创建成功`);
    }
  }

  // 把长文本切成小段，每段最多 chunkSize 个字
  splitText(text: string, chunkSize = 300, overlap = 50): string[] {
    const chunks: string[] = [];
    // 按句号、感叹号、问号、换行来分句
    const sentences = text.split(/(?<=[。！？\n])/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length <= chunkSize) {
        currentChunk += sentence;
      } else {
        if (currentChunk.length) {
          chunks.push(currentChunk.trim());
          // 关键：保留最后一段 overlap 个字作为下一段的开头
          currentChunk = currentChunk.slice(-overlap) + sentence;
        } else {
          //如果 你的第一块段落太长，那么就直接把整段作为第一块
          currentChunk = sentence;
        }
      }
    }
    // 防止剩余的片段过短，导致无法插入
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
    }
    return chunks;
  }

  //文本向量化
  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: this.embeddingModel,
      input: text,
    });
    // console.log(text, response.data[0].embedding);
    return response.data[0].embedding;
  }

  // 对文字取 MD5 哈希，作为 Qdrant 的唯一 ID
  getMD5(text: string): string {
    return createHash('md5').update(text).digest('hex');
  }

  // upload（上传文档）
  async upload(content: string, title: string) {
    // 1. 切片
    const chunks = this.splitText(content);
    this.logger.log(`文档"${title}"切成 ${chunks.length} 个片段`);

    // 2. 逐个处理
    const points: Array<{
      id: string;
      vector: number[];
      payload: { content: string; title: string; index: number };
    }> = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // 3. 向量化
      const vector = await this.getEmbedding(chunk);

      // 4. MD5 作为 ID
      const md5Id = this.getMD5(chunk);

      // 5. 组装成 Qdrant 格式
      points.push({
        id: md5Id,
        vector: vector,
        payload: { content: chunk, title, index: i },
      });
    }

    // 6. 批量存入 Qdrant
    const res = await this.client.upsert(this.collectionName, { points });
    console.log(res);
    return { message: `上传成功，共 ${chunks.length} 个片段`, res };
  }

  async search(query: string, limit = 3) {
    // 1. 把问题向量化
    const queryVector = await this.getEmbedding(query);

    // 2. 去 Qdrant 搜最相似的
    const results = await this.client.search(this.collectionName, {
      vector: queryVector,
      limit: limit,
      with_payload: true, // 把 payload（原文）也返回
    });

    // 3. 整理结果
    return results.map((r) => {
      const payload = r.payload as Record<string, unknown> | undefined;
      return {
        score: r.score,
        title: typeof payload?.title === 'string' ? payload.title : '未知',
        content:
          typeof payload?.content === 'string'
            ? payload.content
            : JSON.stringify(payload?.content ?? ''),
      };
    });
  }

  async ragChat(question: string): Promise<string> {
    // 1. 搜索最相关的 3 个片段
    const results = await this.search(question, 3);

    // 2. 拼接增强版 prompt
    // 把数组转为字符串
    const context = results
      .map((r, i) => `[资料${i + 1}] ${String(r.content)}`)
      .join('\n\n');

    const prompt = `你是一个智能客服助手。请根据以下资料回答用户的问题。
    如果资料中没有相关信息，请直接说"抱歉，我没有找到相关信息"。
    ${context}
    用户问题：${question}`;

    // 3. 发给 LLM
    const response = await this.openai.chat.completions.create({
      model: process.env.LLM_MODEL || 'qwen3.7-flash-2026-07-15',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content || '';
  }

  async ragChatWithMemory(userId: string, question: string): Promise<string> {
    // 1. 读取用户画像
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });

    let userProfileText = '';
    if (profile) {
      userProfileText = `用户信息：
      姓名：${profile.name || '未知'}
      偏好：${profile.preferences || '无'}
      历史记忆：${profile.memories || '无'}`;
    }

    // 2. 搜索最相关的 3 个片段
    const results = await this.search(question, 3);

    // 3. 拼接增强版 prompt
    const context = results
      .map((r, i) => `[资料${i + 1}] ${r.content}`)
      .join('\n\n');

    const prompt = `你是一个智能客服助手。请根据以下资料回答用户的问题。
如果资料中没有相关信息，请直接说"抱歉，我没有找到相关信息"。

${userProfileText}

${context}

用户问题：${question}`;

    // 4. 发给 LLM
    const response = await this.openai.chat.completions.create({
      model: process.env.LLM_MODEL || 'qwen3.7-flash-2026-07-15',
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content || '';
  }
}
