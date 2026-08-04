import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// 连接文件系统 MCP Server
export async function createFilesystemMCP() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      'C:\\text\\智能体模块demo\\agent-learning',
    ],
  });

  const client = new Client({ name: 'my-agent', version: '1.0.0' });
  await client.connect(transport);

  // 打印工具列表
  const tools = await client.listTools();
  console.log(
    'MCP 文件工具加载成功:',
    tools.tools.map((t: any) => t.name),
  );

  return client;
}

// 连接搜索 MCP Server
export async function createSearchMCP() {
  // 1. 创建传输层，指定如何启动 MCP Server
  const transport = new StdioClientTransport({
    command: 'npx', // 使用 npx 执行
    args: [
      '-y', // 自动同意安装包
      'bing-cn-mcp', // MCP Server 的包名[reference:15]
    ],
  });

  // 2. 创建 MCP 客户端并连接
  const client = new Client({
    name: 'my-search-agent',
    version: '1.0.0',
  });
  await client.connect(transport);

  // 3. 打印工具列表，看看提供了什么功能
  const tools = await client.listTools();
  console.log(
    '搜索 MCP 工具:',
    tools.tools.map((t: any) => t.name),
  );
  // 你应该会看到类似 'bing_search' 和 'crawl_webpage' 的工具[reference:16]

  return client;
}

export async function createBaiduSearchMCP() {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: [
      'baidu-search-mcp',
      '--max-result=5',
      '--fetch-content-count=2',
      '--max-content-length=2000',
    ],
  });

  const client = new Client({
    name: 'my-baidu-search-agent',
    version: '1.0.0',
  });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log(
    '百度搜索 MCP 工具:',
    tools.tools.map((t: any) => t.name),
  );
  return client;
}
// 把 MCP 工具转成 OpenAI Function Calling 格式
export function convertMCPTools(mcpTools: any[]) {
  return mcpTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}
