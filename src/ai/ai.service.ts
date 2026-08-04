import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { Observable, Subscriber } from 'rxjs';
import { UserProfile } from '@prisma/client';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { tools, executeTool } from './tools';
import {
  createFilesystemMCP,
  createSearchMCP,
  convertMCPTools,
  createBaiduSearchMCP,
} from './mcp-client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

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
  private mcpClient!: Client;
  private searchMcpClient!: Client; // 搜索客户端
  private baiduMcpClient!: Client; // 百度搜索客户端

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

  async onModuleInit() {
    try {
      this.mcpClient = await createFilesystemMCP();

      // 初始化搜索 MCP
      this.searchMcpClient = await createSearchMCP();

      // 初始化百度搜索 MCP
      this.baiduMcpClient = await createBaiduSearchMCP();
      console.log('本地工具列表:', tools);
    } catch (error) {
      console.error('MCP 连接失败:', error);
    }
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
    // const res = await this.chatWithTools('今天是几号');
    // const res = await this.chatWithMCP('test-mcp.txt 里写了什么');
    // console.log(res);
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

  // Function Calling 对话
  async chatWithTools(content: string): Promise<string> {
    // 第一步：发消息 + 工具列表给 AI
    const messages: any[] = [
      {
        role: 'system',
        content: '你是一个智能助手，可以根据需要调用工具来回答用户问题。',
      },
      { role: 'user', content: content },
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as any[],
      tools: tools,
    });

    const aiMessage = response.choices[0].message;
    console.log('AI 回复:', aiMessage);

    // 第二步：判断 AI 是否要调用工具
    if (aiMessage.tool_calls) {
      // AI 要调工具！
      // 把 AI 的回复（tool_calls）也加入消息历史
      messages.push(aiMessage);

      // 第三步：逐个执行 AI 要求的工具
      for (const toolCall of aiMessage.tool_calls) {
        if (toolCall.type === 'function') {
          console.log(`AI 要调用工具: ${toolCall.function}`);
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`AI 要调用: ${functionName}`, functionArgs);

          const result = await executeTool(functionName, functionArgs);
          console.log(`工具 ${functionName} 的结果:`, result);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }
      console.log('更新后的消息历史:', messages);

      // 第五步：AI 根据工具结果组织语言回复
      const finalResponse = await this.client.chat.completions.create({
        model: this.model,
        messages: messages,
      });

      return finalResponse.choices[0].message.content || '';
    } else {
      // AI 不需要调工具，直接回复
      return aiMessage.content || '';
    }
  }

  // MCP 对话方法
  async chatWithMCP(content: string): Promise<string> {
    // 1. 从 MCP Server 获取工具列表
    const mcpTools = await this.mcpClient.listTools();
    const openaiTools = convertMCPTools(mcpTools.tools);

    const messages: any[] = [
      {
        role: 'system',
        content:
          '你是一个文件管理助手，可以帮助用户查看、创建、编辑文件。操作目录限定在 C:\\text\\智能体模块demo\\agent-learning 下。',
      },
      { role: 'user', content: content },
    ];

    // 2. 发给 AI
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: openaiTools,
    });

    const aiMessage = response.choices[0].message;

    // 3. 判断是否要调工具
    if (aiMessage.tool_calls) {
      messages.push(aiMessage);

      for (const toolCall of aiMessage.tool_calls) {
        if (toolCall.type === 'function') {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`MCP 调用: ${functionName}`, functionArgs);

          // 4. 通过 MCP Client 调用 MCP Server
          const result = await this.mcpClient.callTool({
            name: functionName,
            arguments: functionArgs,
          });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.content),
          });
        }
      }

      // 5. AI 根据结果回复
      const finalResponse = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });
      return finalResponse.choices[0].message.content || '';
    }

    return aiMessage.content || '';
  }

  // src/ai/ai.service.ts
  async chatWithSearch(content: string): Promise<string> {
    // 1. 从搜索 MCP Server 获取工具列表
    const mcpTools = await this.searchMcpClient.listTools();
    const openaiTools = convertMCPTools(mcpTools.tools);
    const allTools = [...tools, ...openaiTools];

    const messages: any[] = [
      {
        role: 'system',
        content: '你是一个搜索助手，可以帮助用户搜索网络信息。',
      },
      { role: 'user', content: content },
    ];

    // 2. 发给 AI，附带搜索工具
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: allTools,
    });

    const aiMessage = response.choices[0].message;

    // 3. 判断是否要调工具
    if (aiMessage.tool_calls) {
      messages.push(aiMessage);

      for (const toolCall of aiMessage.tool_calls) {
        if (toolCall.type === 'function') {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`搜索 MCP 调用: ${functionName}`, functionArgs);

          // 4. 通过搜索 MCP Client 调用工具
          const result = await this.searchMcpClient.callTool({
            name: functionName,
            arguments: functionArgs,
          });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.content),
          });
        }
      }

      // 5. AI 根据搜索结果回复
      const finalResponse = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });
      return finalResponse.choices[0].message.content || '';
    }

    return aiMessage.content || '';
  }

  // baidu搜索 MCP 对话方法
  // src/ai/ai.service.ts
  async chatWithBaidu(content: string): Promise<string> {
    console.log('chatWithBaidu called with content:', content);
    // 1. 从百度搜索 MCP Server 获取工具列表
    const mcpTools = await this.baiduMcpClient.listTools();
    const openaiTools = convertMCPTools(mcpTools.tools);
    console.log('百度搜索 MCP 工具列表:', openaiTools);
    const mcpTools1 = await this.mcpClient.listTools();
    const openaiTools1 = convertMCPTools(mcpTools1.tools);
    console.log(' 操作文件 MCP 工具列表:', openaiTools1);

    console.log('本地工具列表:', tools);

    const messages: any[] = [
      {
        role: 'system',
        content: `
你是一个智能助手，可以调用工具完成复杂任务。
首先你需要判断这个问题是不是复杂任务，如果是复杂任务要拆分成多少步，每一步要干什么。
如果用户的问题里面设计今年今天，这个月，明年，明天，昨天等时间相关的词语，首先你要调用local_get_current_time工具获取当前时间。
可用工具：
- baidu_search：搜索网络信息
- write_file：写入文件（路径相对于 C:\\text\\智能体模块demo\\agent-learning）
- local_get_current_time：获取当前时间

规则：
1. 如果用户要求"搜索并保存"，请先调用 baidu_search 获取信息，再根据搜索结果调用 write_file 保存。
2. 每一步只调用必要的工具，等待结果后再决定下一步。
      `,
      },
      { role: 'user', content: content },
    ];

    // 2. 发给 AI，附带搜索工具
    let response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: [...tools, ...openaiTools, ...openaiTools1],
      parallel_tool_calls: true, // 允许并行调用（如果条件允许）
    });

    let aiMessage = response.choices[0].message;
    console.log('AI 回复:', aiMessage, '工具调用:', aiMessage.tool_calls);

    // 4. 循环：只要 AI 返回了 tool_calls，就执行并继续
    let maxIterations = 10; // 安全保护，防止死循环

    // 3. 判断是否要调工具
    while (aiMessage.tool_calls && maxIterations > 0) {
      maxIterations--;

      console.log(`\n--- 第 ${10 - maxIterations} 轮工具调用 ---`);
      console.log(
        'AI 要调用的工具:',
        aiMessage.tool_calls.map((t) => t),
      );

      messages.push(aiMessage);

      for (const toolCall of aiMessage.tool_calls) {
        if (toolCall.type === 'function') {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);

          console.log(`正要使用方法和参数: ${functionName}`, functionArgs);

          let result;

          // 6. 根据工具来源执行
          if (functionName.includes('local')) {
            // 如果是本地工具，直接调用本地工具
            result = await executeTool(functionName, functionArgs);
            console.log(
              `本地工具 ${functionName} 的结果:`,
              result,
              typeof result,
            );
            result = { content: result }; // 包装成 { content: ... } 形式，方便后续处理
          } else if (
            functionName === 'baidu_search' ||
            functionName === 'fetch_url'
          ) {
            // 百度搜索 MCP
            result = await this.baiduMcpClient.callTool({
              name: functionName,
              arguments: functionArgs,
            });
            // 提取文本内容
            // const textContent = mcpResult.content
            //   .filter((item: any) => item.type === 'text')
            //   .map((item: any) => item.text)
            //   .join('\n');
            // result = { content: textContent };
          } else {
            // 文件系统 MCP（或其他）
            result = await this.mcpClient.callTool({
              name: functionName,
              arguments: functionArgs,
            });
            // const textContent = mcpResult.content
            //   .filter((item: any) => item.type === 'text')
            //   .map((item: any) => item.text)
            //   .join('\n');
            // result = { content: textContent };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result.content),
          });
        }
      }

      // 5. AI 根据搜索结果回复
      response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        tools: [...tools, ...openaiTools, ...openaiTools1],
        parallel_tool_calls: true,
      });

      aiMessage = response.choices[0].message;
    }

    // 9. 循环结束，返回最终答案
    if (aiMessage.content) {
      return aiMessage.content;
    } else {
      return '任务已完成，但 AI 没有返回文本内容。';
    }
  }
}
