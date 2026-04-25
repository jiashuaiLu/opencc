import express, { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

export interface ProxyConfig {
  apiKey: string;
  baseUrl: string;
  port: number;
  models?: Array<{ id: string; name: string; modelId: string }>;
  defaultModel?: string;
  apiFormat?: 'chat-completions' | 'responses' | 'anthropic';
}

interface ClaudeTool {
  name: string;
  description?: string;
  input_schema: any;
}

type ClaudeContent =
  | string
  | Array<{
      type: 'text' | 'image' | 'tool_use' | 'tool_result';
      text?: string;
      source?: {
        type: 'base64' | 'url';
        media_type?: string;
        data?: string;
        url?: string;
      };
      id?: string;
      name?: string;
      input?: any;
      tool_use_id?: string;
      content?: any;
      cache_control?: { type: string };
    }>;

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContent;
}

interface ClaudeThinking {
  type: 'enabled' | 'adaptive';
  budget_tokens?: number;
}

interface ClaudeMessagesRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: string } }>;
  max_tokens: number;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: ClaudeTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
  thinking?: ClaudeThinking;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{ type: 'function'; function: any }>;
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

type ResponseInputContent =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail?: 'low' | 'high' | 'auto' | 'original' }
  | { type: 'input_file'; file_data?: string; file_id?: string; file_url?: string; filename?: string };

type ResponseOutputContent =
  | { type: 'output_text'; text: string; annotations?: any[] }
  | { type: 'refusal'; refusal: string };

interface ResponsesInputMessage {
  type: 'message';
  role: 'user' | 'assistant' | 'system' | 'developer';
  content: string | ResponseInputContent[];
  status?: 'in_progress' | 'completed' | 'incomplete';
}

interface ResponsesFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string | ResponseInputContent[];
  id?: string;
  status?: 'in_progress' | 'completed' | 'incomplete';
}

type ResponsesFunctionCallInput = {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: 'in_progress' | 'completed' | 'incomplete';
};

type ResponsesInputItem = ResponsesInputMessage | ResponsesFunctionCallOutput | ResponsesFunctionCallInput;

interface ResponsesRequest {
  model: string;
  input: ResponsesInputItem[] | string;
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    name: string;
    description?: string;
    parameters?: any;
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; name: string };
  previous_response_id?: string;
}

interface ResponsesOutputMessage {
  type: 'message';
  id: string;
  role: 'assistant';
  content: ResponseOutputContent[];
  status: 'in_progress' | 'completed' | 'incomplete';
}

interface ResponsesFunctionCall {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: 'in_progress' | 'completed' | 'incomplete';
}

type ResponsesOutputItem = ResponsesOutputMessage | ResponsesFunctionCall | {
  type: 'web_search_call' | 'code_interpreter_call' | 'file_search_call';
  id: string;
  status: string;
};

interface ResponsesResponse {
  id: string;
  object: 'response';
  status: 'completed' | 'in_progress' | 'failed';
  model: string;
  output: ResponsesOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

export class ProxyServer extends EventEmitter {
  private app: express.Application;
  private server: any;
  private config: ProxyConfig | null = null;
  private isRunning: boolean = false;
  private startTime: Date | null = null;

  constructor() {
    super();
    this.app = express();
    this.setupMiddleware();
  }

  private setupMiddleware(): void {
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version');

      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    this.app.use(express.json({ limit: '500mb' }));

    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'ok',
        running: this.isRunning,
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
        config: this.config
          ? {
              baseUrl: this.config.baseUrl,
              port: this.config.port,
            }
          : null,
      });
    });

    this.app.post('/v1/messages', this.handleMessages.bind(this));
    this.app.post('/v1/messages/*', this.handleMessages.bind(this));
  }

  private async handleMessages(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      if (!this.config) {
        res.status(503).json({
          error: 'Service Unavailable',
          message: '代理服务未配置',
        });
        return;
      }

      const claudeRequest: ClaudeMessagesRequest = req.body;

      console.log(`[Proxy] ${req.method} ${req.url}`);
    console.log(`[Proxy] Model: ${claudeRequest.model}`);
    console.log(`[Proxy] Stream: ${claudeRequest.stream}`);
    console.log(`[Proxy] Original request body: ${JSON.stringify(req.body, null, 2)}`);

      if (this.config && this.config.defaultModel && this.config.models) {
        const defaultModelConfig = this.config.models.find(m => m.id === this.config!.defaultModel);
        if (defaultModelConfig) {
          console.log(`[Proxy] Replacing model ${claudeRequest.model} with ${defaultModelConfig.modelId}`);
          claudeRequest.model = defaultModelConfig.modelId;
        }
      }

      // 强制使用 anthropic 格式，responses 格式暂时禁用
      const apiFormat = 'anthropic';
      console.log(`[Proxy] Using Anthropic Passthrough (responses API temporarily disabled)`);
      await this.handleWithAnthropicApi(claudeRequest, req, res, startTime);
    } catch (error: any) {
      console.error(`[Proxy Error] ${error.message}`);
      console.error(`[Proxy Error] Stack: ${error.stack}`);

      this.emit('error', error);

      if (!res.headersSent) {
        if (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
          res.status(502).json({
            error: 'Connection Failed',
            message: `无法连接到目标 API: ${this.config?.baseUrl}`,
            details: error.message,
            suggestion: '请检查网络连接和 API 端点是否正确',
          });
        } else {
          res.status(500).json({
            error: 'Proxy Error',
            message: error.message,
          });
        }
      }
    }
  }

  /**
   * 构建干净的 Anthropic 请求体，移除不必要的参数
   * 针对京东云等兼容服务进行优化
   */
  private buildCleanAnthropicBody(claudeRequest: ClaudeMessagesRequest): any {
    // 清理 messages，确保格式正确
    const cleanMessages = claudeRequest.messages.map(msg => {
      // 确保 content 是数组格式
      let content = msg.content;
      if (typeof content === 'string') {
        content = [{ type: 'text', text: content }];
      } else if (Array.isArray(content)) {
        // 清理 content 数组中的每一项
        content = content.map((block: any) => {
          if (block.type === 'text') {
            const text = block.text || '';
            // 过滤掉空的 text block
            if (!text.trim()) {
              return null;
            }
            return { type: 'text', text: text };
          }
          if (block.type === 'image') {
            return {
              type: 'image',
              source: block.source || {}
            };
          }
          if (block.type === 'tool_use') {
            // 确保 id 只包含合法字符: a-zA-Z0-9_-
            const cleanId = (block.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
            return {
              type: 'tool_use',
              id: cleanId || 'tool_default',
              name: block.name || '',
              input: block.input || {}
            };
          }
          if (block.type === 'tool_result') {
            // 确保 tool_use_id 只包含合法字符: a-zA-Z0-9_-
            const cleanToolUseId = (block.tool_use_id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
            return {
              type: 'tool_result',
              tool_use_id: cleanToolUseId || 'tool_default',
              content: block.content || ''
            };
          }
          return block;
        }).filter(Boolean); // 过滤掉 null 值
        
        // 如果过滤后 content 为空，添加一个默认文本
        if (content.length === 0) {
          content = [{ type: 'text', text: ' ' }];
        }
      }
      
      return {
        role: msg.role,
        content: content
      };
    });

    const body: any = {
      model: claudeRequest.model,
      messages: cleanMessages,
      max_tokens: claudeRequest.max_tokens,
    };

    // 只添加有值的参数
    if (claudeRequest.system !== undefined && claudeRequest.system !== null) {
      body.system = claudeRequest.system;
    }
    if (claudeRequest.stop_sequences !== undefined && claudeRequest.stop_sequences !== null) {
      body.stop_sequences = claudeRequest.stop_sequences;
    }
    if (claudeRequest.stream !== undefined && claudeRequest.stream !== null) {
      body.stream = claudeRequest.stream;
    }
    if (claudeRequest.temperature !== undefined && claudeRequest.temperature !== null) {
      body.temperature = claudeRequest.temperature;
    }
    if (claudeRequest.top_p !== undefined && claudeRequest.top_p !== null) {
      body.top_p = claudeRequest.top_p;
    }
    if (claudeRequest.top_k !== undefined && claudeRequest.top_k !== null) {
      body.top_k = claudeRequest.top_k;
    }
    if (claudeRequest.tools !== undefined && claudeRequest.tools !== null && claudeRequest.tools.length > 0) {
      body.tools = claudeRequest.tools;
    }
    if (claudeRequest.tool_choice !== undefined && claudeRequest.tool_choice !== null) {
      body.tool_choice = claudeRequest.tool_choice;
    }

    // 处理 thinking 参数 - 根据模型类型进行适配
    if (claudeRequest.thinking) {
      const model = claudeRequest.model.toLowerCase();
      
      // Claude-Opus-4.6: 只支持 adaptive 类型，不支持 budget_tokens
      if (model.includes('opus')) {
        body.thinking = { type: 'adaptive' };
      }
      // Claude-Sonnet-4.6: 支持 enabled 类型 + budget_tokens
      else if (model.includes('sonnet')) {
        body.thinking = {
          type: 'enabled',
          budget_tokens: claudeRequest.thinking.budget_tokens || 16000,
        };
      }
      // 其他模型：如果原始请求有 thinking 且类型匹配则传递，否则移除
      else {
        if (claudeRequest.thinking.type === 'adaptive') {
          body.thinking = { type: 'adaptive' };
        } else if (claudeRequest.thinking.type === 'enabled' && claudeRequest.thinking.budget_tokens) {
          body.thinking = {
            type: 'enabled',
            budget_tokens: claudeRequest.thinking.budget_tokens,
          };
        }
      }
    }

    return body;
  }

  private async handleWithAnthropicApi(
    claudeRequest: ClaudeMessagesRequest,
    req: Request,
    res: Response,
    startTime: number
  ): Promise<void> {
    const targetUrl = `${this.config!.baseUrl}/messages`;

    console.log(`[Proxy] Forwarding to: ${targetUrl}`);
    console.log(`[Proxy] Request model: ${claudeRequest.model}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config!.apiKey}`,
    };

    const anthropicVersion = req.headers['anthropic-version'] as string;
    if (anthropicVersion) {
      headers['anthropic-version'] = anthropicVersion;
    } else {
      // 默认使用 2023-06-01 版本
      headers['anthropic-version'] = '2023-06-01';
    }

    const traceId = req.headers['trace-id'] as string;
    if (traceId) {
      headers['Trace-Id'] = traceId;
    }

    // 清理并构建转发请求体，只传递必要的参数
    const forwardBody = this.buildCleanAnthropicBody(claudeRequest);

    console.log(`[Proxy] Forwarding body keys: ${Object.keys(forwardBody).join(', ')}`);
    console.log(`[Proxy] Request body: ${JSON.stringify(forwardBody, null, 2)}`);
    if (forwardBody.thinking) {
      console.log(`[Proxy] Thinking mode: ${JSON.stringify(forwardBody.thinking)}`);
    }

    const apiResponse = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(forwardBody),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error(`[Proxy Error] ${apiResponse.status} ${apiResponse.statusText}`);
      console.error(`[Proxy Error] ${errorBody}`);

      res.status(apiResponse.status).json({
        error: 'API Error',
        message: errorBody,
      });
      return;
    }

    if (claudeRequest.stream) {
      await this.handleAnthropicStreamResponse(apiResponse, res, claudeRequest.model, claudeRequest, startTime);
    } else {
      const anthropicResponse = await apiResponse.json() as any;

      res.json(anthropicResponse);

      const duration = Date.now() - startTime;
      const inputTokens = anthropicResponse.usage?.input_tokens || 0;
      const outputTokens = anthropicResponse.usage?.output_tokens || 0;

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: anthropicResponse,
        inputTokens,
        outputTokens,
        duration,
      });

      this.emit('request', {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens,
        outputTokens,
        cacheReadTokens: anthropicResponse.usage?.cache_read_input_tokens || 0,
        cacheCreationTokens: anthropicResponse.usage?.cache_creation_input_tokens || 0,
        isStreaming: false,
      });
    }
  }

  private async handleAnthropicStreamResponse(
    apiResponse: globalThis.Response,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest,
    startTime: number
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let streamCompleted = false;
    let inputTokens = 0;
    let outputTokens = 0;
    const collectedContent: any[] = [];
    let stopReason = 'end_turn';

    const reader = apiResponse.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const sendToClient = (data: string) => {
      if (!streamCompleted && !res.writableEnded) {
        res.write(data);
      }
    };

    const finalizeStream = () => {
      if (streamCompleted) return;
      streamCompleted = true;
      if (!res.writableEnded) {
        res.end();
      }

      const duration = Date.now() - startTime;

      const claudeResponse = {
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        model,
        content: collectedContent.filter(Boolean),
        stop_reason: stopReason,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      };

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: claudeResponse,
        inputTokens,
        outputTokens,
        duration,
      });

      this.emit('request', {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming: true,
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (!streamCompleted) {
            finalizeStream();
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          sendToClient(line + '\n');

          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            try {
              const event = JSON.parse(data);

              if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens || inputTokens;
                outputTokens = event.message.usage.output_tokens || outputTokens;
              }
              if (event.type === 'message_delta') {
                if (event.usage) {
                  outputTokens = event.usage.output_tokens || outputTokens;
                }
                if (event.delta?.stop_reason) {
                  stopReason = event.delta.stop_reason;
                }
              }

              if (event.type === 'content_block_delta' && event.delta) {
                const index = event.index || 0;
                if (event.delta.type === 'text_delta' && event.delta.text) {
                  if (!collectedContent[index]) {
                    collectedContent[index] = { type: 'text', text: '' };
                  }
                  collectedContent[index].text += event.delta.text;
                } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                  const toolIndex = index;
                  if (!collectedContent[toolIndex]) {
                    collectedContent[toolIndex] = { type: 'tool_use', id: '', name: '', _args: '', input: {} };
                  }
                  (collectedContent[toolIndex] as any)._args += event.delta.partial_json;
                }
              }

              if (event.type === 'content_block_start' && event.content_block) {
                const index = event.index || 0;
                if (event.content_block.type === 'tool_use') {
                  collectedContent[index] = {
                    type: 'tool_use',
                    id: event.content_block.id,
                    name: event.content_block.name,
                    input: {},
                    _args: '',
                  };
                }
              }

              if (event.type === 'content_block_stop') {
                const index = event.index || 0;
                const block = collectedContent[index] as any;
                if (block && block._args !== undefined) {
                  try {
                    block.input = JSON.parse(block._args);
                  } catch {
                    block.input = {};
                  }
                  delete block._args;
                }
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error) {
      if (!streamCompleted && res.headersSent && !res.writableEnded) {
        res.end();
        streamCompleted = true;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async handleWithResponsesApi(
    claudeRequest: ClaudeMessagesRequest,
    res: Response,
    startTime: number
  ): Promise<void> {
    const responsesRequest = this.convertClaudeToResponsesRequest(claudeRequest);
    const targetUrl = `${this.config!.baseUrl}/responses`;

    console.log(`[Proxy] Forwarding to: ${targetUrl}`);
    console.log(`[Proxy] Request model: ${responsesRequest.model}`);
    console.log(`[Proxy] Contents count: ${Array.isArray(responsesRequest.contents) ? responsesRequest.contents.length : 0}`);
    console.log(`[Proxy] Request body: ${JSON.stringify(responsesRequest, null, 2)}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config!.apiKey}`,
      'Trace-Id': `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    const apiResponse = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(responsesRequest),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error(`[Proxy Error] ${apiResponse.status} ${apiResponse.statusText}`);
      console.error(`[Proxy Error] ${errorBody}`);

      res.status(apiResponse.status).json({
        error: 'API Error',
        message: errorBody,
      });
      return;
    }

    if (claudeRequest.stream) {
      await this.handleResponsesStreamResponse(apiResponse, res, claudeRequest.model, claudeRequest, startTime);
    } else {
      const responsesResponse = await apiResponse.json() as ResponsesResponse;
      const claudeResponse = this.convertResponsesToClaudeResponse(responsesResponse, claudeRequest.model);

      res.json(claudeResponse);

      const duration = Date.now() - startTime;
      const inputTokens = claudeResponse.usage?.input_tokens || 0;
      const outputTokens = claudeResponse.usage?.output_tokens || 0;

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: claudeResponse,
        inputTokens,
        outputTokens,
        duration,
      });

      this.emit('request', {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming: false,
      });
    }
  }

  private convertClaudeToResponsesRequest(claudeRequest: ClaudeMessagesRequest): any {
    // 转换为京东云 Responses API 格式
    const contents: any[] = [];

    for (const message of claudeRequest.messages) {
      const parts: any[] = [];
      
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text || '' });
          } else if (block.type === 'image') {
            // 图片处理
            if (block.source?.type === 'base64' && block.source.data) {
              parts.push({
                inline_data: {
                  mime_type: block.source.media_type || 'image/png',
                  data: block.source.data
                }
              });
            }
          } else if (block.type === 'tool_use') {
            // 工具调用
            parts.push({
              function_call: {
                name: block.name || '',
                args: block.input || {}
              }
            });
          } else if (block.type === 'tool_result') {
            // 工具结果 - 京东云要求 response 必须是对象
            let responseData: any;
            if (typeof block.content === 'string') {
              // 尝试解析为 JSON，如果失败则包装为对象
              try {
                responseData = JSON.parse(block.content);
              } catch {
                responseData = { result: block.content };
              }
            } else {
              responseData = block.content || {};
            }
            
            // 从 tool_use_id 中提取工具名称，或使用默认值
            const toolName = block.name || block.tool_use_id || 'default_tool';
            
            parts.push({
              function_response: {
                name: toolName,
                response: responseData
              }
            });
          }
        }
      } else if (typeof message.content === 'string') {
        parts.push({ text: message.content });
      }

      if (parts.length > 0) {
        contents.push({
          role: message.role,
          parts: parts
        });
      }
    }

    // 构建京东云格式的请求体
    const jdRequest: any = {
      model: claudeRequest.model,
      contents: contents,
    };

    // 添加 system_instruction
    if (claudeRequest.system) {
      let systemText = '';
      if (typeof claudeRequest.system === 'string') {
        systemText = claudeRequest.system;
      } else if (Array.isArray(claudeRequest.system)) {
        systemText = claudeRequest.system.map((s: any) => {
          if (typeof s === 'string') return s;
          if (s && typeof s === 'object' && s.text) return s.text;
          return '';
        }).filter(Boolean).join('\n\n');
      }
      
      if (systemText) {
        jdRequest.system_instruction = {
          parts: [{ text: systemText }]
        };
      }
    }

    // 添加 generation_config
    const generationConfig: any = {};
    
    if (claudeRequest.max_tokens !== undefined) {
      generationConfig.max_output_tokens = claudeRequest.max_tokens;
    }
    if (claudeRequest.temperature !== undefined) {
      generationConfig.temperature = claudeRequest.temperature;
    }
    if (claudeRequest.top_p !== undefined) {
      generationConfig.top_p = claudeRequest.top_p;
    }
    if (claudeRequest.top_k !== undefined) {
      generationConfig.top_k = claudeRequest.top_k;
    }
    
    // 添加 thinkingConfig（如果适用）
    if (claudeRequest.thinking) {
      generationConfig.thinkingConfig = {
        thinkingLevel: claudeRequest.thinking.type === 'enabled' ? 'HIGH' : 'LOW'
      };
    }

    if (Object.keys(generationConfig).length > 0) {
      jdRequest.generation_config = generationConfig;
    }

    // 添加 stream 参数
    if (claudeRequest.stream !== undefined) {
      jdRequest.stream = claudeRequest.stream;
    }

    return jdRequest;
  }

  private convertResponsesToClaudeResponse(responsesResponse: any, model: string): any {
    const contentBlocks: any[] = [];
    let hasToolUse = false;

    console.log('[Responses API] Raw response:', JSON.stringify(responsesResponse, null, 2));

    // 处理京东云 Responses API 格式
    if (responsesResponse.candidates && Array.isArray(responsesResponse.candidates)) {
      for (const candidate of responsesResponse.candidates) {
        if (candidate.content && candidate.content.parts) {
          for (const part of candidate.content.parts) {
            if (part.text) {
              contentBlocks.push({ type: 'text', text: part.text });
            }
            if (part.function_call) {
              hasToolUse = true;
              contentBlocks.push({
                type: 'tool_use',
                id: `call_${Date.now()}`,
                name: part.function_call.name || '',
                input: part.function_call.args || {},
              });
            }
          }
        }
      }
    }
    // 处理标准 Anthropic Responses API 格式（兼容）
    else if (responsesResponse.output && Array.isArray(responsesResponse.output)) {
      for (const item of responsesResponse.output) {
        if (item.type === 'message' && 'content' in item) {
          for (const content of item.content) {
            if (content.type === 'output_text') {
              contentBlocks.push({ type: 'text', text: content.text });
            }
          }
        } else if (item.type === 'function_call') {
          hasToolUse = true;
          contentBlocks.push({
            type: 'tool_use',
            id: item.call_id || item.id || `call_${Date.now()}`,
            name: item.name,
            input: JSON.parse(item.arguments || '{}'),
          });
        }
      }
    }

    const stopReason = hasToolUse ? 'tool_use' : 'end_turn';
    console.log('[Responses API] Stop reason:', stopReason, 'Content blocks:', contentBlocks.length);

    // 提取 usage 信息（京东云格式）
    const usage = responsesResponse.usageMetadata || responsesResponse.usage || {};
    const inputTokens = usage.promptTokenCount || usage.input_tokens || 0;
    const outputTokens = usage.candidatesTokenCount || usage.output_tokens || 0;

    return {
      id: responsesResponse.responseId || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: model,
      content: contentBlocks,
      stop_reason: stopReason,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    };
  }

  private async handleResponsesStreamResponse(
    apiResponse: globalThis.Response,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest,
    startTime: number
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messageId = `msg_${Math.random().toString(36).substr(2, 9)}`;
    let streamCompleted = false;
    let initialized = false;
    let currentContentIndex = 0;
    let currentToolCallIndex = 0;
    const toolCallBlocks: Map<number, { id: string; name: string; args: string; index: number }> = new Map();

    const collectedContent: any[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const sendEvent = (event: string, data: object) => {
      if (!streamCompleted && !res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const finalizeStream = (stopReason: string) => {
      if (streamCompleted) return;
      streamCompleted = true;

      sendEvent('content_block_stop', {
        type: 'content_block_stop',
        index: currentContentIndex,
      });

      toolCallBlocks.forEach((block) => {
        sendEvent('content_block_stop', {
          type: 'content_block_stop',
          index: block.index,
        });
      });

      sendEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });
      sendEvent('message_stop', { type: 'message_stop' });

      if (!res.writableEnded) {
        res.end();
      }

      const duration = Date.now() - startTime;

      const claudeResponse = {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: collectedContent.filter(Boolean),
        stop_reason: stopReason,
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        },
      };

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: claudeResponse,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        duration,
      });

      this.emit('request', {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming: true,
      });
    };

    const reader = apiResponse.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (!reader) {
      throw new Error('无法获取响应流');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (!streamCompleted) {
            finalizeStream('end_turn');
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEventType = '';

        for (const line of lines) {
          if (!line.trim()) continue;

          if (line.startsWith('event: ')) {
            currentEventType = line.substring(7).trim();
            continue;
          }

          if (line.startsWith('data: ')) {
            const data = line.substring(6);

            try {
              const event = JSON.parse(data);

              if (event.type === 'response.output_item.added' || currentEventType === 'response.output_item.added') {
                const item = event.item || event;

                if (!initialized) {
                  sendEvent('message_start', {
                    type: 'message_start',
                    message: {
                      id: messageId,
                      type: 'message',
                      role: 'assistant',
                      model,
                      content: [],
                      stop_reason: null,
                      usage: { input_tokens: 0, output_tokens: 0 },
                    },
                  });
                  initialized = true;
                }

                if (item.type === 'message') {
                  sendEvent('content_block_start', {
                    type: 'content_block_start',
                    index: currentContentIndex,
                    content_block: { type: 'text', text: '' },
                  });
                } else if (item.type === 'function_call') {
                  currentToolCallIndex++;
                  const toolIndex = currentContentIndex + currentToolCallIndex;
                  const blockId = item.id || item.call_id || `call_${Date.now()}`;
                  console.log(`[Stream] function_call added: index=${toolIndex}, id=${blockId}, name=${item.name}`);
                  toolCallBlocks.set(toolIndex, {
                    id: blockId,
                    name: item.name || '',
                    args: '',
                    index: toolIndex,
                  });
                  sendEvent('content_block_start', {
                    type: 'content_block_start',
                    index: toolIndex,
                    content_block: {
                      type: 'tool_use',
                      id: item.call_id || item.id,
                      name: item.name || '',
                      input: {},
                    },
                  });
                }
              }

              if (event.type === 'response.output_text.delta' || currentEventType === 'response.output_text.delta') {
                const text = event.delta || '';
                if (text) {
                  sendEvent('content_block_delta', {
                    type: 'content_block_delta',
                    index: currentContentIndex,
                    delta: { type: 'text_delta', text: text },
                  });
                  if (!collectedContent[currentContentIndex]) {
                    collectedContent[currentContentIndex] = { type: 'text', text: '' };
                  }
                  collectedContent[currentContentIndex].text += text;
                }
              }

              if (event.type === 'response.function_call_arguments.delta' || currentEventType === 'response.function_call_arguments.delta') {
                const args = event.delta || '';
                const callId = event.call_id || event.item_id || event.id;

                console.log(`[Stream] function_call delta: callId=${callId}, args=${args}`);

                for (const [index, block] of toolCallBlocks) {
                  if (block.id === callId || !callId) {
                    block.args += args;
                    sendEvent('content_block_delta', {
                      type: 'content_block_delta',
                      index: block.index,
                      delta: { type: 'input_json_delta', partial_json: args },
                    });
                    break;
                  }
                }
              }

              if (event.type === 'response.function_call_arguments.done' || currentEventType === 'response.function_call_arguments.done') {
                const callId = event.call_id || event.item_id || event.id;
                const parsedArgs = event.arguments || '';

                console.log(`[Stream] function_call done: callId=${callId}, arguments=${parsedArgs}`);

                for (const [index, block] of toolCallBlocks) {
                  if (block.id === callId || !callId) {
                    try {
                      const input = JSON.parse(block.args || parsedArgs || '{}');
                      collectedContent.push({
                        type: 'tool_use',
                        id: block.id,
                        name: block.name,
                        input: input,
                      });
                      console.log(`[Stream] Tool use collected: ${block.name}(${JSON.stringify(input)})`);
                    } catch (e) {
                      collectedContent.push({
                        type: 'tool_use',
                        id: block.id,
                        name: block.name,
                        input: {},
                      });
                    }
                    break;
                  }
                }
              }

              if (event.type === 'response.completed' || currentEventType === 'response.completed') {
                if (event.response?.usage) {
                  inputTokens = event.response.usage.input_tokens || 0;
                  outputTokens = event.response.usage.output_tokens || 0;
                }

                const hasToolUse = collectedContent.some(c => c?.type === 'tool_use');
                const stopReason = hasToolUse ? 'tool_use' : 'end_turn';
                if (!streamCompleted) {
                  finalizeStream(stopReason);
                }
                return;
              }

            } catch (e) {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (error) {
      if (!streamCompleted && res.headersSent && !res.writableEnded) {
        res.end();
        streamCompleted = true;
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async handleWithChatCompletionsApi(
    claudeRequest: ClaudeMessagesRequest,
    res: Response,
    startTime: number
  ): Promise<void> {
    const openaiRequest = this.convertClaudeToOpenAIRequest(claudeRequest);
    const targetUrl = `${this.config!.baseUrl}/chat/completions`;

    console.log(`[Proxy] Forwarding to: ${targetUrl}`);
    console.log(`[Proxy] Request model: ${openaiRequest.model}`);

    const openaiApiResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config!.apiKey}`,
      },
      body: JSON.stringify(openaiRequest),
    });

    if (!openaiApiResponse.ok) {
      const errorBody = await openaiApiResponse.text();
      console.error(`[Proxy Error] ${openaiApiResponse.status} ${openaiApiResponse.statusText}`);
      console.error(`[Proxy Error] ${errorBody}`);

      res.status(openaiApiResponse.status).json({
        error: 'API Error',
        message: errorBody,
      });
      return;
    }

    if (claudeRequest.stream) {
      await this.handleStreamResponse(openaiApiResponse, res, claudeRequest.model, claudeRequest, startTime);
    } else {
      const openaiResponse = await openaiApiResponse.json();
      const claudeResponse = this.convertOpenAIToClaudeResponse(openaiResponse, claudeRequest.model);

      res.json(claudeResponse);

      const duration = Date.now() - startTime;
      const inputTokens = claudeResponse.usage?.input_tokens || 0;
      const outputTokens = claudeResponse.usage?.output_tokens || 0;

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: claudeResponse,
        inputTokens,
        outputTokens,
        duration,
      });

      this.emit('request', {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming: false,
      });
    }
  }

  private async handleStreamResponse(
    openaiResponse: globalThis.Response,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest,
    startTime: number
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const messageId = `msg_${Math.random().toString(36).substr(2, 9)}`;
    const toolCalls: {
      [index: number]: {
        id: string;
        name: string;
        args: string;
        claudeIndex: number;
        started: boolean;
      };
    } = {};
    let contentBlockIndex = 0;
    let initialized = false;
    let streamCompleted = false;

    const collectedContent: any[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const sendEvent = (event: string, data: object) => {
      if (!streamCompleted && !res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const reader = openaiResponse.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    if (!reader) {
      throw new Error('无法获取响应流');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.substring(6);

          if (data.trim() === '[DONE]') {
            sendEvent('content_block_stop', {
              type: 'content_block_stop',
              index: 0,
            });

            Object.values(toolCalls).forEach((tc) => {
              if (tc.started) {
                sendEvent('content_block_stop', {
                  type: 'content_block_stop',
                  index: tc.claudeIndex,
                });
              }
            });

            const stopReason = Object.keys(toolCalls).length > 0 ? 'tool_use' : 'end_turn';
            if (!streamCompleted) {
              streamCompleted = true;
              sendEvent('message_delta', {
                type: 'message_delta',
                delta: { stop_reason: stopReason, stop_sequence: null },
                usage: { output_tokens: outputTokens },
              });
              sendEvent('message_stop', { type: 'message_stop' });
              res.end();
            }

            const duration = Date.now() - startTime;

            const claudeResponse = {
              id: messageId,
              type: 'message',
              role: 'assistant',
              model,
              content: collectedContent.filter(Boolean),
              stop_reason: stopReason,
              usage: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
              },
            };

            this.emit('conversation', {
              id: `conv_${Date.now()}`,
              model: claudeRequest.model,
              request: claudeRequest,
              response: claudeResponse,
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              duration,
            });

            this.emit('request', {
              method: 'POST',
              url: '/v1/messages',
              statusCode: 200,
              duration,
              model: claudeRequest.model,
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
              isStreaming: true,
            });

            return;
          }

          try {
            const openaiChunk = JSON.parse(data);
            const delta = openaiChunk.choices[0]?.delta;

            if (openaiChunk.usage) {
              inputTokens = openaiChunk.usage.prompt_tokens || 0;
              outputTokens = openaiChunk.usage.completion_tokens || 0;
              console.log(`[Proxy Stream] Usage: input=${inputTokens}, output=${outputTokens}, total=${inputTokens + outputTokens}`);
            }

            if (!delta) continue;

            if (!initialized) {
              sendEvent('message_start', {
                type: 'message_start',
                message: {
                  id: messageId,
                  type: 'message',
                  role: 'assistant',
                  model,
                  content: [],
                  stop_reason: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              });
              sendEvent('content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              });
              initialized = true;
            }

            if (delta.content) {
              sendEvent('content_block_delta', {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: delta.content },
              });
              if (!collectedContent[0]) {
                collectedContent[0] = { type: 'text', text: '' };
              }
              collectedContent[0].text += delta.content;
            }

            if (delta.tool_calls) {
              for (const tc_delta of delta.tool_calls) {
                const index = tc_delta.index;

                if (!toolCalls[index]) {
                  toolCalls[index] = {
                    id: '',
                    name: '',
                    args: '',
                    claudeIndex: 0,
                    started: false,
                  };
                }

                if (tc_delta.id) toolCalls[index].id = tc_delta.id;
                if (tc_delta.function?.name) toolCalls[index].name = tc_delta.function.name;
                if (tc_delta.function?.arguments) toolCalls[index].args += tc_delta.function.arguments;

                if (toolCalls[index].id && toolCalls[index].name && !toolCalls[index].started) {
                  contentBlockIndex++;
                  toolCalls[index].claudeIndex = contentBlockIndex;
                  toolCalls[index].started = true;
                  sendEvent('content_block_start', {
                    type: 'content_block_start',
                    index: contentBlockIndex,
                    content_block: {
                      type: 'tool_use',
                      id: toolCalls[index].id,
                      name: toolCalls[index].name,
                      input: {},
                    },
                  });
                }

                if (toolCalls[index].started && tc_delta.function?.arguments) {
                  sendEvent('content_block_delta', {
                    type: 'content_block_delta',
                    index: toolCalls[index].claudeIndex,
                    delta: { type: 'input_json_delta', partial_json: tc_delta.function.arguments },
                  });
                }
              }
            }
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private convertClaudeToOpenAIRequest(
    claudeRequest: ClaudeMessagesRequest
  ): OpenAIRequest {
    const openaiMessages: OpenAIMessage[] = [];

    if (claudeRequest.system) {
      const systemText = typeof claudeRequest.system === 'string'
        ? claudeRequest.system
        : claudeRequest.system
            .filter((s: any) => typeof s === 'string' || s?.text)
            .map((s: any) => (typeof s === 'string' ? s : s.text))
            .join('\n\n');
      openaiMessages.push({ role: 'system', content: systemText });
    }

    for (let i = 0; i < claudeRequest.messages.length; i++) {
      const message = claudeRequest.messages[i];

      if (message.role === 'user') {
        if (Array.isArray(message.content)) {
          const toolResults = message.content.filter((c) => c.type === 'tool_result');
          const otherContent = message.content.filter((c) => c.type !== 'tool_result');

          if (toolResults.length > 0) {
            toolResults.forEach((block) => {
              openaiMessages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id!,
                content:
                  typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content),
              });
            });
          }

          if (otherContent.length > 0) {
            openaiMessages.push({
              role: 'user',
              content: otherContent.map((block) =>
                block.type === 'text'
                  ? { type: 'text', text: block.text }
                  : {
                      type: 'image_url',
                      image_url: {
                        url: `data:${block.source!.media_type};base64,${block.source!.data}`,
                      },
                    }
              ) as any,
            });
          }
        } else {
          openaiMessages.push({ role: 'user', content: message.content });
        }
      } else if (message.role === 'assistant') {
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];

        if (Array.isArray(message.content)) {
          message.content.forEach((block) => {
            if (block.type === 'text') {
              textParts.push(block.text!);
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id!,
                type: 'function',
                function: {
                  name: block.name!,
                  arguments: JSON.stringify(block.input || {}),
                },
              });
            }
          });
        }

        const assistantMessage: OpenAIMessage = {
          role: 'assistant',
          content: textParts.join('\n') || (null as any),
        };
        if (toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        openaiMessages.push(assistantMessage);
      }
    }

    const openaiRequest: OpenAIRequest = {
      model: claudeRequest.model,
      messages: openaiMessages,
      max_tokens: claudeRequest.max_tokens,
      temperature: claudeRequest.temperature,
      top_p: claudeRequest.top_p,
      stream: claudeRequest.stream,
      stop: claudeRequest.stop_sequences,
    };

    if (claudeRequest.stream) {
      (openaiRequest as any).stream_options = {
        include_usage: true
      };
    }

    if (claudeRequest.tools) {
      openaiRequest.tools = claudeRequest.tools.map((tool) => {
        const cleanedParameters = this.recursivelyCleanSchema(tool.input_schema);
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: cleanedParameters,
          },
        };
      });
    }

    if (claudeRequest.tool_choice) {
      if (
        claudeRequest.tool_choice.type === 'auto' ||
        claudeRequest.tool_choice.type === 'any'
      ) {
        openaiRequest.tool_choice = 'auto';
      } else if (claudeRequest.tool_choice.type === 'tool') {
        openaiRequest.tool_choice = {
          type: 'function',
          function: { name: claudeRequest.tool_choice.name! },
        };
      }
    }

    return openaiRequest;
  }

  private recursivelyCleanSchema(schema: any): any {
    if (schema === null || typeof schema !== 'object') {
      return schema;
    }

    if (Array.isArray(schema)) {
      return schema.map((item) => this.recursivelyCleanSchema(item));
    }

    const newSchema: { [key: string]: any } = {};
    for (const key in schema) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        if (key === '$schema' || key === 'additionalProperties') {
          continue;
        }
        newSchema[key] = this.recursivelyCleanSchema(schema[key]);
      }
    }

    if (newSchema.type === 'string' && newSchema.format) {
      const supportedFormats = ['date-time', 'enum'];
      if (!supportedFormats.includes(newSchema.format)) {
        delete newSchema.format;
      }
    }

    return newSchema;
  }

  private convertOpenAIToClaudeResponse(openaiResponse: any, model: string): any {
    const choice = openaiResponse.choices[0];
    const contentBlocks: any[] = [];

    if (choice.message.content) {
      contentBlocks.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
      choice.message.tool_calls.forEach((call: OpenAIToolCall) => {
        contentBlocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input: JSON.parse(call.function.arguments),
        });
      });
    }

    const stopReasonMap: Record<string, string> = {
      stop: 'end_turn',
      length: 'max_tokens',
      tool_calls: 'tool_use',
    };

    return {
      id: openaiResponse.id,
      type: 'message',
      role: 'assistant',
      model: model,
      content: contentBlocks,
      stop_reason: stopReasonMap[choice.finish_reason] || 'end_turn',
      usage: {
        input_tokens: openaiResponse.usage.prompt_tokens,
        output_tokens: openaiResponse.usage.completion_tokens,
      },
    };
  }

  configure(config: ProxyConfig): void {
    this.config = config;
    this.emit('configured', config);
  }

  async start(port: number): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, () => {
          this.isRunning = true;
          this.startTime = new Date();
          this.emit('started', { port });
          resolve();
        });

        this.server.on('error', (err: Error) => {
          this.isRunning = false;
          this.emit('error', err);
          reject(err);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.close((err?: Error) => {
        if (err) {
          this.emit('error', err);
          reject(err);
        } else {
          this.isRunning = false;
          this.startTime = null;
          this.emit('stopped');
          resolve();
        }
      });
    });
  }

  getStatus(): { running: boolean; uptime: number; config: ProxyConfig | null } {
    return {
      running: this.isRunning,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      config: this.config,
    };
  }
}
