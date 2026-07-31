import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { Observable, Subscriber } from 'rxjs';
import { UserProfile } from '@prisma/client';
import { KnowledgeService } from '../knowledge/knowledge.service';

export interface ExtractedMemory {
  name?: string;
  preferences?: string;
  key_facts?: string[];
}
export interface Vector {
  map(arg0: (m: any) => string): unknown;
  score: any;
  title: string;
  content: string;
}

@Injectable()
export class AiService {
  private client: OpenAI;
  private model: string;

  constructor(
    private prisma: PrismaService,
    private knowledge: KnowledgeService,
  ) {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    });
    this.model = process.env.LLM_MODEL || 'qwen3.7-flash-2026-07-15';
  }

  onModuleInit() {
    // const res = await this.getUserInfo('user001');
    // const res = await this.gethistory('text1');
    // const res = await this.saveusermessage('哈喽', 'text2');
    // const res = await this.getVector('我要退货');
    // console.log(
    //   res,
    //   '----------------------------------------------------------------',
    //   '\n',
    // );
    // this.ragChat('user001', 'text1', '我要退货');
  }

  async chatbyresponse() {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.LLM_BASE_URL_1,
    });
    // const res = await openai.responses.create({
    //   model: this.model,
    //   input: '我是廖俊杰',
    // });
    const res = await openai.responses.create({
      model: this.model,
      input: '我叫什么',
      previous_response_id: 'resp_2bffe579-3556-943b-942b-930faf80ce03',
    });
    console.log(res);
  }

  async getAll() {
    const res = await this.prisma.message.findMany({
      select: { role: true, content: true, sessionId: true },
    });
    console.log(res);
    return res;
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

      let fullReply = '';

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          fullReply += text;
          subscriber.next({ data: text });
          console.log(text);
        }
        if (chunk.usage) {
          console.log('Token 消耗:', chunk.usage);
        }
      }

      console.log(fullReply);
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
    const messages: {
      role: 'user' | 'assistant' | 'system';
      content: string;
    }[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    // 3. 发给 AI（带上完整历史）
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
    });

    const aiReply = response.choices[0].message.content || '';

    // 4. 保存 AI 回复到数据库
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: aiReply },
    });

    return aiReply;
  }

  // 流式版本（前端实时看到 + 存数据库）
  chatStreamWithContext(sessionId: string, content: string): Observable<any> {
    return new Observable((subscriber) => {
      this.handleStreamWithContext(subscriber, sessionId, content);
    });
  }

  private async handleStreamWithContext(
    subscriber: Subscriber<any>,
    sessionId: string,
    content: string,
  ) {
    try {
      // 1. 保存用户消息
      await this.prisma.message.create({
        data: { sessionId, role: 'user', content },
      });

      // 2. 读取历史
      const history = await this.prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true },
      });

      const messages: {
        role: 'user' | 'assistant' | 'system';
        content: string;
      }[] = history.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      // 3. 流式调用
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
        stream: true, // ← 关键：开启流式
        stream_options: { include_usage: true },
      });

      // 4. 拼接 + 推送
      let fullReply = '';

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          fullReply += text;
          subscriber.next({ data: text });
        }
        if (chunk.usage) {
          console.log('Token 消耗:', chunk.usage);
        }
      }

      // 5. 保存完整回复
      await this.prisma.message.create({
        data: { sessionId, role: 'assistant', content: fullReply },
      });
      subscriber.next({ data: '[DONE]' });
      subscriber.complete();
    } catch (error) {
      subscriber.error(error);
    }
  }

  async extractMemory(userId: string, sessionId: string) {
    // 1.读取这次对话的完整历史
    const history = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });

    // 2. 让大模型提取关键信息
    const extractPrompt = `请从以下对话中提取用户的关键信息，用 JSON 格式返回：
    {
    "name":"用户姓名(如果提到的话)",
    "preferences": "用户的偏好或习惯",
    "key_facts": ["重要的事实，如地址、需求、历史问题等"]
    }
    
    对话内容：
    ${history.map((m) => `${m.role}: ${m.content}`).join('\n')}
    只返回 JSON，不要其他内容。`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: extractPrompt }],
    });

    const raw = response.choices[0].message.content || '{}';
    console.log(raw);

    // 3. 解析 AI 返回的 JSON
    let extracted: ExtractedMemory;
    try {
      // 有些模型会返回 ```json ... ``` 包裹的内容，需要清理
      const cleaned = raw
        .replace(/```json\n?/g, '')
        .replace(/```/g, '')
        .trim();
      extracted = JSON.parse(cleaned) as ExtractedMemory;
    } catch {
      extracted = {};
    }

    // 4. 保存到 UserProfile 表
    const existing: UserProfile | null =
      await this.prisma.userProfile.findUnique({
        where: { userId },
      });

    const newMemories = extracted.key_facts || [];

    if (existing) {
      // 已有画像，合并旧记忆和新记忆
      const oldMemories: string[] = existing.memories
        ? (JSON.parse(existing.memories) as string[])
        : [];

      // 这是一个“先合并、再去重、再转回数组”的JS高阶语法糖。我把它拆解成三步，你就秒懂了：

      // 第一步 [...oldMemories, ...newMemories]（合并）：利用展开运算符 ...，把两个数组里的所有元素“倒出来”，放进一个新的大数组里。

      // 假设 old = ['A','B']，new = ['B','C']，这步得到 ['A','B','B','C']。

      // 第二步 new Set(...)（去重）：Set 是ES6里的“集合”结构，它的特性是内部元素绝对不重复。把 ['A','B','B','C'] 丢进去，自动变成 {'A', 'B', 'C'}（去掉了重复的 B）。

      // 第三步 [...Set]（转回数组）：因为最终你要的是数组格式（方便后续 JSON.stringify 存回数据库），所以再用 ... 把集合转回数组 ['A','B','C']。
      const merged = [...new Set([...oldMemories, ...newMemories])]; // 去重

      await this.prisma.userProfile.update({
        where: { userId },
        data: {
          name: extracted.name || existing.name,
          preferences: extracted.preferences || existing.preferences,
          memories: JSON.stringify(merged),
        },
      });
    } else {
      // 首次创建画像
      await this.prisma.userProfile.create({
        data: {
          userId,
          name: extracted.name || null,
          preferences: extracted.preferences || null,
          memories: JSON.stringify(newMemories),
        },
      });
    }
    console.log(extracted);
    return extracted;
  }

  ragChat(userId: string, sessionId: string, content: string): Observable<any> {
    return new Observable((subscriber) => {
      this.handleRagChat(subscriber, userId, sessionId, content);
    });
  }

  // rag模块完整流程 接受参数userid用来查用户画像，sessionId用来获取历史对话记录和存储对话记录，content用户的提问
  async handleRagChat(
    subscriber: Subscriber<any>,
    userId: string,
    sessionId: string,
    content: string,
  ) {
    try {
      //第一步查询用户画像
      const userInfo = await this.getUserInfo(userId);

      // 第二步查询历史会话记录
      const history = await this.gethistory(sessionId);

      // 第三步存储用户发送的信息
      await this.saveusermessage(content, sessionId, userId);

      // 第四步匹配向量库
      const context = await this.getVector(content);

      // 第五步拼接提示词
      const prompt = `你是一个专业的智能客服助手。请严格遵守以下规则：

      ## 回答规则
      1. 优先根据"参考资料"回答，不要编造信息
      2. 如果资料中没有相关信息，而且你无法回答，请直接说"抱歉，这个问题我暂时无法回答，建议联系人工客服"
      3. 回答要简洁、友好、专业
      4. 如果用户的问题不完整，可以追问

      ## 参考资料
      ${context || '暂无参考资料'}

      ## 用户信息
      ${userInfo || '暂无用户信息'}

      请根据以上信息回答用户的问题。`;
      console.log('提示词', prompt);

      // 第六步流式输出
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: prompt },
          ...history.map((m) => ({
            role: m.role as 'user' | 'assistant' | 'system',
            content: m.content,
          })),
          { role: 'user', content: content },
        ],
        stream: true,
      });

      // 第七步拼接 + 推送
      let fullReply = '';

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta.content;
        if (text) {
          fullReply += text;
          subscriber.next({ data: text });
          // console.log(text);
        }
      }
      console.log(fullReply);

      // 第八步 保存AI回复
      await this.prisma.message.create({
        data: { sessionId, role: 'assistant', content: fullReply, userId },
      });
      subscriber.next({ data: '[DONE]' });
      subscriber.complete();
    } catch (error) {
      subscriber.error(error);
    }
  }

  // 查询用户画像
  async getUserInfo(userId: string) {
    const res = await this.prisma.userProfile.findUnique({
      where: {
        userId,
      },
    });
    if (res) {
      return `用户信息：
      姓名：${res.name || '未知'}
      偏好：${res.preferences || '无'}
      历史记忆：${res.memories || '无'}`;
    }
  }

  // 查询历史会话记录
  async gethistory(sessionId: string) {
    const res = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    return res;
  }

  // 存用户发送的信息
  async saveusermessage(content: string, sessionId: string, userId: string) {
    const res = await this.prisma.message.create({
      data: { sessionId, role: 'user', content, userId },
    });
    return res;
  }

  // 匹配向量
  async getVector(text: string) {
    const res = (await this.knowledge.search(text)) as Vector[];
    // console.log(res);
    const context = res
      .map((m, i) => `[资料${i + 1}]${m.title}： ${m.content}`)
      .join('\n\n');
    return context;
  }
}
