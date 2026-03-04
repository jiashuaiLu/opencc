import express, { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

export interface ProxyConfig {
  apiKey: string;
  baseUrl: string;
  port: number;
  models?: Array<{ id: string; name: string; modelId: string }>;
  defaultModel?: string;
}

// Claude API Types
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
        type: 'base64';
        media_type: string;
        data: string;
      };
      id?: string;
      name?: string;
      input?: any;
      tool_use_id?: string;
      content?: any;
    }>;

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeContent;
}

interface ClaudeMessagesRequest {
  model: string;
  messages: ClaudeMessage[];
  system?: string;
  max_tokens: number;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  tools?: ClaudeTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool'; name?: string };
}

// OpenAI API Types
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

      // 如果配置了默认模型，替换请求中的模型名称
      if (this.config && this.config.defaultModel && this.config.models) {
        const defaultModelConfig = this.config.models.find(m => m.id === this.config!.defaultModel);
        if (defaultModelConfig) {
          console.log(`[Proxy] Replacing model ${claudeRequest.model} with ${defaultModelConfig.modelId}`);
          claudeRequest.model = defaultModelConfig.modelId;
        }
      }

      const openaiRequest = this.convertClaudeToOpenAIRequest(claudeRequest);
      const targetUrl = `${this.config.baseUrl}/chat/completions`;

      console.log(`[Proxy] Forwarding to: ${targetUrl}`);
      console.log(`[Proxy] Request model: ${openaiRequest.model}`);

      const openaiApiResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
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
        await this.handleStreamResponse(openaiApiResponse, res, claudeRequest.model, claudeRequest);
      } else {
        const openaiResponse = await openaiApiResponse.json();
        const claudeResponse = this.convertOpenAIToClaudeResponse(openaiResponse, claudeRequest.model);
        
        res.json(claudeResponse);

        // 保存对话历史
        this.emit('conversation', {
          id: `conv_${Date.now()}`,
          model: claudeRequest.model,
          request: claudeRequest,
          response: claudeResponse,
          inputTokens: claudeResponse.usage?.input_tokens || 0,
          outputTokens: claudeResponse.usage?.output_tokens || 0,
          duration: Date.now() - startTime,
        });
      }

      const duration = Date.now() - startTime;
      this.emit('request', {
        method: req.method,
        url: req.url,
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        tokens: 0, // Will be updated by conversation event
      });
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

  private async handleStreamResponse(
    openaiResponse: globalThis.Response,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest
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
    
    // 收集响应内容用于保存对话历史
    const collectedContent: any[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    const sendEvent = (event: string, data: object) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

            let finalStopReason = 'end_turn';
            sendEvent('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: finalStopReason, stop_sequence: null },
              usage: { output_tokens: 0 },
            });
            sendEvent('message_stop', { type: 'message_stop' });
            res.end();
            
            // 保存流式对话历史
            const claudeResponse = {
              id: messageId,
              type: 'message',
              role: 'assistant',
              model,
              content: collectedContent.filter(Boolean),
              stop_reason: finalStopReason,
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
              duration: 0, // Stream duration not tracked
            });
            
            return;
          }

          try {
            const openaiChunk = JSON.parse(data);
            const delta = openaiChunk.choices[0]?.delta;
            
            // 检查是否有 usage 信息（流式响应的最后一个 chunk）
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
              // 收集文本内容
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
      openaiMessages.push({ role: 'system', content: claudeRequest.system });
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

    // 如果是流式请求，添加 stream_options 以获取 usage 信息
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
