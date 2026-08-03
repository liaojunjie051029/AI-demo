import { PrismaService } from '../prisma/prisma.service';

const prisma = new PrismaService();

// 定义工具列表（告诉 AI 有哪些工具可以用）
export const tools = [
  //   {
  //     type: 'function' as const, //as const 就是告诉 TypeScript "这个值就是它本身，不要放宽类型" 这个工具是一个函数（目前只有 function 这一种类型）
  //     function: {
  //       name: 'get_weather', //函数名，AI 调用时会说"我要调 get_weather" 就像你写 function get_weather() 时的函数名
  //       description: '查询指定城市的天气信息', //AI 根据这段描述决定什么时候调用它
  //       strict: true, // 严格模式，AI 输出结果必须按照函数定义的参数格式返回
  //       parameters: {
  //         //函数需要的参数 就像函数签名里的参数定义
  //         type: 'object', //参数是一个对象
  //         properties: {
  //           city: {
  //             type: 'string',
  //             description: '城市名称，例如：北京、上海', //告诉 AI 这个参数填什么
  //           },
  //         },
  //         required: ['city'],
  //       },
  //     },
  //   },
  {
    type: 'function' as const,
    function: {
      name: 'get_user_info',
      description: '获取用户信息',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: '用户ID',
          },
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_current_time',
      description: '获取当前时间',
      strict: true,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

// 工具的执行函数（AI 说要调这个工具时，你真正执行的代码）
export function executeTool(name: string, args: Record<string, string>) {
  switch (name) {
    case 'get_weather':
      // 模拟查询天气（实际项目里调真实 API）
      return {
        city: args.city,
        temperature: '25°C',
        weather: '晴天',
        humidity: '45%',
      };
    case 'get_user_info':
      return prisma.userProfile.findUnique({
        where: { userId: args.userId },
      });
    case 'get_current_time':
      return {
        date: new Date().toLocaleDateString('zh-CN'),
        time: new Date().toLocaleTimeString('zh-CN'),
        datetime: new Date().toLocaleString('zh-CN'),
      };
    default:
      return { error: `未知工具: ${name}` };
  }
}
