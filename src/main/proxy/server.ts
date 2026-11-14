import express, { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as dns from 'dns';
import { session as electronSession, app } from 'electron';
import { logger } from '../logger';
import { getCachedUserInfo } from '../auth/localAuth';
import { newRequestId, buildRequestLog } from './logFields';
import { getCachedInstanceId } from '../instance/instanceId';

interface DnsCacheEntry {
  addresses: string[];
  timestamp: number;
}

const dnsCache = new Map<string, DnsCacheEntry>();
const DNS_CACHE_TTL = 5 * 60 * 1000; 

function customDnsLookup(
  hostname: string,
  options: any,
  callback: (err: NodeJS.ErrnoException | null, address?: string | any[], family?: number) => void
) {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
    const addresses = cached.addresses;
    if (options?.all) {
      return callback(null, addresses.map(a => ({ address: a, family: 4 })));
    } else {
      return callback(null, addresses[0], 4);
    }
  }

  dns.resolve4(hostname, (err, addresses) => {
    if (err || !addresses?.length) {
      return dns.lookup(hostname, options, callback as any);
    }
    dnsCache.set(hostname, { addresses, timestamp: Date.now() });
    if (options?.all) {
      callback(null, addresses.map(a => ({ address: a, family: 4 })));
    } else {
      callback(null, addresses[0], 4);
    }
  });
}

interface NodeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | undefined };
  body: ReadableStream<Uint8Array> | null;
  json(): Promise<any>;
  text(): Promise<string>;
}

async function nodeHttpFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
  cookieInjection: boolean = false
): Promise<NodeFetchResponse> {
  // 仅在 cookieInjection 开启时从 Electron session 获取 cookie 并注入
  if (cookieInjection) {
    const cookies = await electronSession.defaultSession.cookies.get({ url });
    if (cookies.length > 0) {
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      options.headers['Cookie'] = options.headers['Cookie']
        ? `${options.headers['Cookie']}; ${cookieStr}`
        : cookieStr;
    }
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;
    const bodyBuffer = options.body ? Buffer.from(options.body, 'utf-8') : undefined;

    const reqOptions: http.RequestOptions = {
      method: options.method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      lookup: customDnsLookup as any,
      headers: {
        ...options.headers,
        ...(bodyBuffer ? { 'Content-Length': String(bodyBuffer.length) } : {}),
      },
    };

    const req = mod.request(reqOptions, (incoming) => {
      const status = incoming.statusCode ?? 0;

      // Pause the stream until a consumer attaches
      incoming.pause();

      let bodyConsumed = false;

      const consumeAsText = (): Promise<string> => {
        bodyConsumed = true;
        return new Promise((res, rej) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => res(Buffer.concat(chunks).toString('utf-8')));
          incoming.on('error', rej);
          incoming.resume();
        });
      };

      // Lazily create web stream only when .body is accessed
      let webStream: ReadableStream<Uint8Array> | null = null;

      resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: incoming.statusMessage ?? '',
        headers: {
          get(name: string) {
            const val = incoming.headers[name.toLowerCase()];
            return Array.isArray(val) ? val[0] : val;
          },
        },
        get body() {
          if (!webStream && !bodyConsumed) {
            webStream = new ReadableStream({
              start(controller) {
                incoming.on('data', (chunk: Buffer) => {
                  controller.enqueue(new Uint8Array(chunk));
                });
                incoming.on('end', () => {
                  controller.close();
                });
                incoming.on('error', (err) => {
                  controller.error(err);
                });
                incoming.resume();
              },
            });
          }
          return webStream;
        },
        json: async () => JSON.parse(await consumeAsText()),
        text: consumeAsText,
      });
    });

    req.on('error', reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

export interface ClientProxyConfig {
  apiKey: string;
  baseUrl: string;
  apiFormat: 'chat-completions' | 'responses' | 'anthropic';
  models?: Array<{ id: string; name: string; modelId: string; protocol?: string; apiTypes?: Array<{ apiType: string; path: string }>; capabilities?: string[] }>;
  defaultModel?: string;
}

export interface DesktopModelRoute {
  role: string;
  routeId: string;
  modelId: string;
  label?: string;
}

export interface DesktopProxyConfig {
  apiKey: string;
  baseUrl: string;
  apiFormat: 'chat-completions' | 'responses' | 'anthropic';
  modelRoutes: DesktopModelRoute[];
}

export interface ProxyConfig {
  port: number;
  claude?: ClientProxyConfig;
  codex?: ClientProxyConfig;
  cursor?: ClientProxyConfig;
  opencode?: ClientProxyConfig;
  claudeDesktop?: DesktopProxyConfig;

  // Legacy flat fields — accepted by configure() and folded into `claude`.
  apiKey?: string;
  baseUrl?: string;
  models?: Array<{ id: string; name: string; modelId: string; protocol?: string; apiTypes?: Array<{ apiType: string; path: string }>; capabilities?: string[] }>;
  defaultModel?: string;
  apiFormat?: 'chat-completions' | 'responses' | 'anthropic';

  // Headroom 压缩配置
  headroom?: {
    enabled: boolean;
    proxyUrl?: string;  // Headroom 代理地址，默认 http://127.0.0.1:8787
  };
}

/**
 * 每模型能力解析结果（元数据优先、名字正则兜底）。
 * 所有字段在「无元数据」时退回与迁移前逐字节一致的名字启发式，故天然非破坏。
 */
interface ResolvedModelCaps {
  /** 协议族：网关 protocol 优先，否则名字判断 */
  family: 'anthropic' | 'openai' | 'gemini' | 'other';
  /**
   * 线路 API：'responses' = 网关声明「仅 responses 端点」；'chat' = 明确有 chat/completions；
   * 'auto' = 无法从元数据判定，交回 CODEX_RESPONSES_ONLY_PATTERNS 正则 + 自学习兜底。
   * ⚠️ 仅用于「额外识别」responses-only 新模型，不会把正则判定的 responses 模型翻回 chat（见 codexModelNeedsResponses）。
   */
  wireApi: 'responses' | 'chat' | 'auto';
  /** 是否可理解图像（能力标签「图像理解/视频理解」正向命中；否则退回 !isTextOnlyModel） */
  vision: boolean;
  /** 是否支持 reasoning_effort（网关暂无信号，沿用名字判断） */
  reasoningEffort: boolean;
  /** token 上限参数名（O 系用 max_completion_tokens） */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
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
  // Internally we keep this.config in the legacy flat shape for the existing
  // /v1/messages handlers. The codex client lives on a separate field.
  private config: (ProxyConfig & ClientProxyConfig) | null = null;
  private codexClient: ClientProxyConfig | null = null;
  private cursorClient: ClientProxyConfig | null = null;
  private opencodeClient: ClientProxyConfig | null = null;
  private desktopClient: DesktopProxyConfig | null = null;
  // 自学习:上游明确要求过"改用 /v1/responses"的 codex 模型(解析后 modelId,小写)。
  // 命中后后续直连 responses,跳过注定失败的 R→C(chat)尝试。内存态,重启后按需重学。
  private codexResponsesOnlyModels = new Set<string>();
  private isRunning: boolean = false;
  private startTime: Date | null = null;
  private cookieInjection: boolean = false;
  private headroomEnabled: boolean = false;
  private headroomUpstreamHosts: { anthropic?: string; openai?: string } = {};

  /**
   * 动态设置 Headroom 是否启用（启动失败时可禁用）
   */
  setHeadroomEnabled(enabled: boolean, proxyUrl?: string, upstreamHosts?: { anthropic?: string; openai?: string }): void {
    this.headroomEnabled = enabled;
    if (proxyUrl) {
      this.headroomProxyUrl = proxyUrl;
    }
    if (upstreamHosts) {
      this.headroomUpstreamHosts = upstreamHosts;
    }
    logger.info(`[Headroom] 透明代理${enabled ? '已启用' : '已禁用'}，代理地址: ${this.headroomProxyUrl}`);
  }
  private headroomProxyUrl: string = 'http://127.0.0.1:8788';

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

    // 为每个请求生成唯一 request_id(PRD 4.1.1):挂到 req 供后续字段组装/上游透传使用，
    // 并回写响应头 X-Request-Id 便于链路观测。
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const id = newRequestId();
      (req as any).dongccRequestId = id;
      res.header('X-Request-Id', id);
      next();
    });

    this.app.use(express.json({ limit: '500mb' }));

    this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      if (err.type === 'entity.parse.failed') {
        console.error(`[Proxy] JSON 解析失败: ${err.message}`);
        console.error(`[Proxy] Raw body (partial): ${err.body?.substring?.(0, 500)}`);
        res.status(400).json({
          error: 'Invalid JSON',
          message: '请求体 JSON 解析失败',
          detail: err.message,
        });
        return;
      }
      next(err);
    });

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

    // Codex CLI direct passthrough — body is already in OpenAI format,
    // we only swap the Authorization header and forward to the configured codex baseUrl.
    this.app.post('/v1/chat/completions', (req, res) => this.handleCodexPassthrough(req, res, 'chat'));
    this.app.post('/v1/responses', (req, res) => this.handleCodexPassthrough(req, res, 'responses'));
    this.app.post('/v1/responses/*', (req, res) => this.handleCodexPassthrough(req, res, 'responses'));

    // Cursor passthrough — 路径前缀 /cursor/
    this.app.post('/cursor/chat/completions', (req, res) => this.handleClientPassthrough(req, res, 'cursor', 'chat'));
    this.app.post('/cursor/v1/chat/completions', (req, res) => this.handleClientPassthrough(req, res, 'cursor', 'chat'));
    this.app.post('/cursor/messages', (req, res) => this.handleClientPassthrough(req, res, 'cursor', 'anthropic'));

    // OpenCode passthrough — 路径前缀 /opencode/
    this.app.post('/opencode/chat/completions', (req, res) => this.handleClientPassthrough(req, res, 'opencode', 'chat'));
    this.app.post('/opencode/v1/chat/completions', (req, res) => this.handleClientPassthrough(req, res, 'opencode', 'chat'));
    this.app.post('/opencode/messages', (req, res) => this.handleClientPassthrough(req, res, 'opencode', 'anthropic'));

    // Claude Desktop 3P proxy — model route mapping
    this.app.post('/claude-desktop/v1/messages', (req, res) => this.handleDesktopProxy(req, res));
    this.app.post('/claude-desktop/v1/messages/*', (req, res) => this.handleDesktopProxy(req, res));

    this.app.get('/v1/models', (req: Request, res: Response) => {
      if (!this.config?.models || this.config.models.length === 0) {
        res.json({ object: 'list', data: [] });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      res.json({
        object: 'list',
        data: this.config.models.map(m => ({
          id: m.modelId,
          object: 'model',
          created: now,
          owned_by: 'dongcc',
          display_name: m.name,
        })),
      });
    });
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

      logger.debug(`[Proxy] ${req.method} ${req.url} Content-Type: ${req.headers['content-type']} Model: ${claudeRequest?.model} Stream: ${claudeRequest?.stream}`);

      if (!claudeRequest || !claudeRequest.model) {
        const bodyKeys = req.body ? Object.keys(req.body).join(', ') : 'null/undefined';
        const bodySnapshot = JSON.stringify(req.body, null, 2)?.substring(0, 2000) || '';
        logger.error(`[Proxy] model 字段缺失`, { bodyKeys, bodySnapshot: bodySnapshot.substring(0, 2000) });

        this.logRequest(req, {
          method: 'POST',
          url: req.url,
          statusCode: 400,
          duration: Date.now() - startTime,
          model: 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          isStreaming: false,
          error: `model 字段缺失! body keys: [${bodyKeys}], body: ${bodySnapshot.substring(0, 500)}`,
        });

        res.status(400).json({
          error: { code: 4010, message: "Required parameter 'model' is missing" },
          debug: {
            bodyType: typeof req.body,
            bodyKeys: req.body ? Object.keys(req.body) : null,
            hint: 'DongCC 代理收到的请求中缺少 model 字段，请检查客户端或新开会话',
          },
        });
        return;
      }

      const apiFormat = this.config.apiFormat || 'anthropic';
      console.log(`[Proxy] Using API format: ${apiFormat}`);

      // Headroom 集成：当启用时，DongCC 将请求转发给 Headroom 透明代理
      if (apiFormat === 'chat-completions') {
        await this.handleWithChatCompletionsApi(claudeRequest, req, res, startTime);
      } else {
        // responses 格式暂时禁用，统一走 anthropic 透传
        await this.handleWithAnthropicApi(claudeRequest, req, res, startTime);
      }
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
   * 将 Claude messages 转换为 OpenAI 格式（供 Headroom compress 使用）
   */
  private claudeMessagesToOpenAI(claudeRequest: ClaudeMessagesRequest): any[] {
    const messages: any[] = [];

    // system → system message
    if (claudeRequest.system) {
      const systemText = typeof claudeRequest.system === 'string'
        ? claudeRequest.system
        : claudeRequest.system.map((s: any) => s.text || '').filter(Boolean).join('\n\n');
      if (systemText) {
        messages.push({ role: 'system', content: systemText });
      }
    }

    for (const msg of claudeRequest.messages) {
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          messages.push({ role: 'user', content: msg.content });
        } else if (Array.isArray(msg.content)) {
          const toolResults = msg.content.filter((c: any) => c.type === 'tool_result');
          const otherContent = msg.content.filter((c: any) => c.type !== 'tool_result');

          if (toolResults.length > 0) {
            toolResults.forEach((block: any) => {
              messages.push({
                role: 'tool',
                tool_call_id: block.tool_use_id || '',
                content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              });
            });
          }
          if (otherContent.length > 0) {
            const textParts = otherContent
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text || '')
              .filter(Boolean);
            if (textParts.length > 0) {
              messages.push({ role: 'user', content: textParts.join('\n') });
            }
          }
        }
      } else if (msg.role === 'assistant') {
        const textParts: string[] = [];
        const toolCalls: any[] = [];

        if (typeof msg.content === 'string') {
          textParts.push(msg.content);
        } else if (Array.isArray(msg.content)) {
          msg.content.forEach((block: any) => {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id || '',
                type: 'function',
                function: { name: block.name || '', arguments: JSON.stringify(block.input || {}) },
              });
            }
          });
        }

        const assistantMsg: any = { role: 'assistant', content: textParts.join('\n') || null };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        messages.push(assistantMsg);
      }
    }
    return messages;
  }

  /**
   * 将 OpenAI 格式 messages 转回 Claude 格式
   */
  private openaiMessagesToClaude(openaiMessages: any[], originalRequest: ClaudeMessagesRequest): {
    messages: ClaudeMessage[];
    systemText?: string;
  } {
    const claudeMessages: ClaudeMessage[] = [];
    let systemText: string | undefined;

    for (const msg of openaiMessages) {
      if (msg.role === 'system') {
        systemText = typeof msg.content === 'string' ? msg.content : systemText;
        continue;
      }
      if (msg.role === 'user') {
        claudeMessages.push({
          role: 'user',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
      } else if (msg.role === 'assistant') {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: tc.id || `tool_${Date.now()}`,
              name: tc.function?.name || '',
              input: JSON.parse(tc.function?.arguments || '{}'),
            });
          }
        }
        claudeMessages.push({ role: 'assistant', content: content.length > 0 ? content : [{ type: 'text', text: '' }] });
      } else if (msg.role === 'tool') {
        claudeMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || '',
            content: msg.content || '',
          }],
        });
      }
    }
    return { messages: claudeMessages, systemText };
  }

  /**
   * 将客户端请求的 model 名映射到上游实际的 modelId
   */
  private resolveModelId(requestModel: string): string {
    if (!this.config?.models || this.config.models.length === 0) {
      return requestModel;
    }
    // 精确匹配 modelId（已经是正确的上游名称）
    const exactMatch = this.config.models.find(m => m.modelId === requestModel);
    if (exactMatch) return exactMatch.modelId;
    // 匹配客户端可能用的标准名（id 字段）
    const idMatch = this.config.models.find(m => m.id === requestModel);
    if (idMatch) return idMatch.modelId;
    // 模糊匹配：客户端发的 model 名包含关键词（opus/sonnet/haiku）
    const lower = requestModel.toLowerCase();
    if (lower.includes('opus')) {
      const opusModel = this.config.models.find(m => m.modelId.toLowerCase().includes('opus'));
      if (opusModel) return opusModel.modelId;
    }
    if (lower.includes('sonnet')) {
      const sonnetModel = this.config.models.find(m => m.modelId.toLowerCase().includes('sonnet'));
      if (sonnetModel) return sonnetModel.modelId;
    }
    if (lower.includes('haiku')) {
      const haikuModel = this.config.models.find(m => m.modelId.toLowerCase().includes('haiku'));
      if (haikuModel) return haikuModel.modelId;
    }
    // 无法匹配，使用默认模型或原值
    const cfg = this.config;
    if (cfg.defaultModel) {
      const defaultEntry = cfg.models?.find(m => m.id === cfg.defaultModel);
      if (defaultEntry) return defaultEntry.modelId;
      return cfg.defaultModel;
    }
    return requestModel;
  }

  /**
   * 构建干净的 Anthropic 请求体，移除不必要的参数
   * 针对部分兼容服务的差异进行适配
   */
  private buildCleanAnthropicBody(claudeRequest: ClaudeMessagesRequest): any {
    // 剥掉 cache_control 中上游不支持的 scope 字段
    const cleanCacheControl = (cc: any): any => {
      if (!cc) return cc;
      const { scope, ...rest } = cc;
      return rest;
    };

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
            if (!text.trim()) {
              return null;
            }
            const textBlock: any = { type: 'text', text: text };
            if (block.cache_control) {
              textBlock.cache_control = cleanCacheControl(block.cache_control);
            }
            return textBlock;
          }
          if (block.type === 'image') {
            const imageBlock: any = {
              type: 'image',
              source: block.source || {}
            };
            if (block.cache_control) {
              imageBlock.cache_control = cleanCacheControl(block.cache_control);
            }
            return imageBlock;
          }
          if (block.type === 'tool_use') {
            const cleanId = (block.id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
            const toolUseBlock: any = {
              type: 'tool_use',
              id: cleanId || 'tool_default',
              name: block.name || '',
              input: block.input || {}
            };
            if (block.cache_control) {
              toolUseBlock.cache_control = cleanCacheControl(block.cache_control);
            }
            return toolUseBlock;
          }
          if (block.type === 'tool_result') {
            const cleanToolUseId = (block.tool_use_id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
            const toolResultBlock: any = {
              type: 'tool_result',
              tool_use_id: cleanToolUseId || 'tool_default',
              content: block.content || ''
            };
            if (block.cache_control) {
              toolResultBlock.cache_control = cleanCacheControl(block.cache_control);
            }
            return toolResultBlock;
          }
          // 过滤掉 thinking 块 - 签名与上游绑定，转发会导致 Invalid signature
          if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            return null;
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

    const resolvedModel = this.resolveModelId(claudeRequest.model);
    if (resolvedModel !== claudeRequest.model) {
      logger.debug(`[Proxy] Model 映射: ${claudeRequest.model} -> ${resolvedModel}`);
    }

    const body: any = {
      model: resolvedModel,
      messages: cleanMessages,
      max_tokens: claudeRequest.max_tokens,
    };

    // 只添加有值的参数
    if (claudeRequest.system !== undefined && claudeRequest.system !== null) {
      // system 数组中的 cache_control 也需要剥掉 scope
      body.system = Array.isArray(claudeRequest.system)
        ? claudeRequest.system.map((s: any) => s.cache_control
            ? { ...s, cache_control: cleanCacheControl(s.cache_control) }
            : s)
        : claudeRequest.system;
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
    let tokensSaved = 0;
    let compressionRatio = 0;
    const targetUrl = this.getTargetUrl(this.config!.baseUrl, '/messages');

    console.log(`[Proxy] Forwarding to: ${targetUrl}`);
    console.log(`[Proxy] Request model: ${claudeRequest.model}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config!.apiKey}`,
      // JD 网关(Anthropic 兼容)靠 x-api-key 解析账号;缺它会报 "Account invalid/参数解析失败"。
      // 与可正常工作的 Claude Desktop 路径(handleDesktopProxy)保持一致。
      'x-api-key': this.config!.apiKey,
    };

    const userInfo = getCachedUserInfo();
    if (userInfo?.erp) headers['x-llm-erp'] = userInfo.erp;

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

    ProxyServer.injectAppCodeHeader(headers, this.config!.baseUrl);
    ProxyServer.injectUserAgent(headers, 'Claude Code');
    ProxyServer.injectRequestId(headers, req);

    // 清理并构建转发请求体，只传递必要的参数
    const forwardBody = this.buildCleanAnthropicBody(claudeRequest);

    // Media Sanitizer: 纯文本模型自动替换图片块
    this.applyMediaSanitizer(forwardBody);

    // Thinking 优化器: 根据模型自动注入最优 thinking 配置（仅 anthropic 族；gpt/deepseek 等 openai 族跳过）
    if (forwardBody.model && this.modelCaps(forwardBody.model).family !== 'openai') {
      ProxyServer.optimizeThinking(forwardBody);
    }

    console.log(`[Proxy] Forwarding body keys: ${Object.keys(forwardBody).join(', ')}`);
    if (forwardBody.thinking) {
      console.log(`[Proxy] Thinking mode: ${JSON.stringify(forwardBody.thinking)}`);
    }

    const maxRetries = 4;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const apiResponse = await nodeHttpFetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(forwardBody),
      }, this.cookieInjection);

      if (apiResponse.ok) {
        if (this.headroomEnabled) {
          const hrStats = await this.fetchHeadroomSavings(claudeRequest.model, apiResponse.headers);
          tokensSaved = hrStats.tokensSaved;
          compressionRatio = hrStats.compressionRatio;
        }

        if (claudeRequest.stream) {
          await this.handleAnthropicStreamResponse(apiResponse, res, claudeRequest.model, claudeRequest, startTime, req);
        } else {
          const anthropicResponse = await apiResponse.json() as any;

          res.json(anthropicResponse);

          const duration = Date.now() - startTime;
          const inputTokens = anthropicResponse.usage?.input_tokens || 0;
          const outputTokens = anthropicResponse.usage?.output_tokens || 0;
          const cacheReadTokens = anthropicResponse.usage?.cache_read_input_tokens || 0;
          const cacheCreationTokens = anthropicResponse.usage?.cache_creation_input_tokens || 0;

          this.emit('conversation', {
            id: `conv_${Date.now()}`,
            model: claudeRequest.model,
            request: claudeRequest,
            response: anthropicResponse,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            duration,
          });

          this.logRequest(req, {
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
            tokensSaved,
            compressionRatio,
          });
        }
        return;
      }

      const errorBody = await apiResponse.text();
      lastError = { status: apiResponse.status, body: errorBody };

      if (attempt < maxRetries && apiResponse.status === 400) {
        // Thinking 签名纠错器: 检测签名错误并自动整流重试
        if (ProxyServer.shouldRectifyThinkingSignature(errorBody)) {
          const rectResult = ProxyServer.rectifyAnthropicRequest(forwardBody);
          if (rectResult.applied) {
            console.warn(`[Thinking Rectifier] 检测到签名错误，已移除 ${rectResult.removedCount} 个 thinking/signature 字段，正在重试...`);
            continue;
          }
        }
        if (errorBody.includes('upstream error') || errorBody.includes('please try again')) {
          console.warn(`[Proxy] Retry attempt ${attempt}/${maxRetries} due to upstream error`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          continue;
        }
      }

      // 上游瞬时故障(5xx)与限流(429)退避重试。
      // 这类错误(如 Bedrock 503 "unable to process"、网关 BAD_UPSTREAM)通常是临时的，
      // 直接透传会中断 Claude Code 长任务(尤其 deep-research 这类高并发 fan-out)。
      if (attempt < maxRetries && ProxyServer.isRetriableUpstreamStatus(apiResponse.status)) {
        const delayMs = ProxyServer.computeRetryDelayMs(attempt, apiResponse.headers.get('retry-after'));
        console.warn(`[Proxy] 上游 ${apiResponse.status}，第 ${attempt}/${maxRetries} 次重试，${delayMs}ms 后重发: ${errorBody.substring(0, 200)}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      logger.error(`[Proxy] 上游返回 ${apiResponse.status}`, { response: errorBody.substring(0, 1000) });

      const diag = ProxyServer.buildModelDiagnostics({
        errorBody,
        statusCode: apiResponse.status,
        rawModel: claudeRequest.model,
        resolvedModel: forwardBody.model,
        availableModels: this.config?.models,
        defaultModel: this.config?.defaultModel,
        client: 'claude-code',
      });
      if (diag) logger.error('[Model Diagnostics] ' + diag.diagnostic, diag.logMeta);

      this.logRequest(req, {
        method: 'POST',
        url: '/v1/messages',
        statusCode: apiResponse.status,
        duration: Date.now() - startTime,
        model: claudeRequest.model || 'unknown',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming: claudeRequest.stream || false,
        error: diag ? diag.diagnostic : `上游返回 ${apiResponse.status}: ${errorBody.substring(0, 500)}`,
      });

      res.status(apiResponse.status).json({
        error: 'API Error',
        message: errorBody,
      });
      return;
    }

    if (lastError) {
      console.error(`[Proxy Error] All ${maxRetries} retries failed`);
      console.error(`[Proxy Error] ${lastError.body}`);
      res.status(lastError.status).json({
        error: 'API Error',
        message: lastError.body,
      });
    }
  }

  private async handleAnthropicStreamResponse(
    apiResponse: NodeFetchResponse,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest,
    startTime: number,
    req?: Request
  ): Promise<void> {
    let tokensSaved = 0;
    let compressionRatio = 0;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let streamCompleted = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;
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
        cacheReadTokens,
        cacheCreationTokens,
        duration,
      });

      this.logRequest(req, {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        isStreaming: true,
        tokensSaved,
        compressionRatio,
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (!streamCompleted) {
            if (this.headroomEnabled && tokensSaved === 0) {
              const hrStats = await this.fetchHeadroomSavings(model, apiResponse.headers);
              tokensSaved = hrStats.tokensSaved;
              compressionRatio = hrStats.compressionRatio;
            }
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
                cacheReadTokens = event.message.usage.cache_read_input_tokens || cacheReadTokens;
                cacheCreationTokens = event.message.usage.cache_creation_input_tokens || cacheCreationTokens;
              }
              if (event.type === 'message_delta') {
                if (event.usage) {
                  inputTokens = event.usage.input_tokens || inputTokens;
                  outputTokens = event.usage.output_tokens || outputTokens;
                  cacheReadTokens = event.usage.cache_read_input_tokens || cacheReadTokens;
                  cacheCreationTokens = event.usage.cache_creation_input_tokens || cacheCreationTokens;
                }
                if (event.delta?.stop_reason) {
                  stopReason = event.delta.stop_reason;
                }
              }

              // 部分网关在 message_stop 中返回真实 token 数
              if (event.type === 'message_stop' && event['amazon-bedrock-invocationMetrics']) {
                const metrics = event['amazon-bedrock-invocationMetrics'];
                inputTokens = metrics.inputTokenCount || inputTokens;
                outputTokens = metrics.outputTokenCount || outputTokens;
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
    startTime: number,
    req?: Request
  ): Promise<void> {
    let tokensSaved = 0;
    let compressionRatio = 0;
    const responsesRequest = this.convertClaudeToResponsesRequest(claudeRequest);
    const targetUrl = this.getTargetUrl(this.config!.baseUrl, '/responses');

    console.log(`[Proxy] Forwarding to: ${targetUrl}`);
    console.log(`[Proxy] Request model: ${responsesRequest.model}`);
    console.log(`[Proxy] Contents count: ${Array.isArray(responsesRequest.contents) ? responsesRequest.contents.length : 0}`);
    console.log(`[Proxy] Request body: ${JSON.stringify(responsesRequest, null, 2)}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config!.apiKey}`,
      'Trace-Id': `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    };

    const userInfo2 = getCachedUserInfo();
    if (userInfo2?.erp) headers['x-llm-erp'] = userInfo2.erp;

    ProxyServer.injectAppCodeHeader(headers, this.config!.baseUrl);
    ProxyServer.injectUserAgent(headers, 'Claude Code');

    const apiResponse = await nodeHttpFetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(responsesRequest),
    }, this.cookieInjection);

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error(`[Proxy Error] ${apiResponse.status} ${apiResponse.statusText}`);
      console.error(`[Proxy Error] ${errorBody}`);

      const rsDiag = ProxyServer.buildModelDiagnostics({
        errorBody,
        statusCode: apiResponse.status,
        rawModel: claudeRequest.model,
        resolvedModel: responsesRequest.model,
        availableModels: this.config?.models,
        defaultModel: this.config?.defaultModel,
        client: 'claude-code',
      });
      if (rsDiag) {
        logger.error('[Model Diagnostics] ' + rsDiag.diagnostic, rsDiag.logMeta);
        this.logRequest(req, {
          method: 'POST',
          url: '/v1/messages',
          statusCode: apiResponse.status,
          duration: Date.now() - startTime,
          model: claudeRequest.model || 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          isStreaming: claudeRequest.stream || false,
          error: rsDiag.diagnostic,
        });
      }
      res.status(apiResponse.status).json({
        error: 'API Error',
        message: errorBody,
      });
      return;
    }

    if (claudeRequest.stream) {
      await this.handleResponsesStreamResponse(apiResponse, res, claudeRequest.model, claudeRequest, startTime, req);
    } else {
      const responsesResponse = await apiResponse.json() as ResponsesResponse;
      const claudeResponse = this.convertResponsesToClaudeResponse(responsesResponse, claudeRequest.model);

      res.json(claudeResponse);

      const duration = Date.now() - startTime;
      const inputTokens = claudeResponse.usage?.input_tokens || 0;
      const outputTokens = claudeResponse.usage?.output_tokens || 0;

      if (this.headroomEnabled) {
        const hrStats = await this.fetchHeadroomSavings(claudeRequest.model, apiResponse.headers);
        tokensSaved = hrStats.tokensSaved;
        compressionRatio = hrStats.compressionRatio;
      }

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: claudeResponse,
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        duration,
      });

      this.logRequest(req, {
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
        tokensSaved,
        compressionRatio,
      });
    }
  }

  private convertClaudeToResponsesRequest(claudeRequest: ClaudeMessagesRequest): any {
    // 转换为 Responses API 格式
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
            // 工具结果 —— 部分服务要求 response 必须是对象
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

    // 构建 Responses API 请求体
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

    // 处理 Responses API 格式
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

    // 提取 usage 信息
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
    apiResponse: NodeFetchResponse,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest,
    startTime: number,
    req?: Request
  ): Promise<void> {
    let tokensSaved = 0;
    let compressionRatio = 0;
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
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

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
        cacheReadTokens,
        cacheCreationTokens,
        duration,
      });

      this.logRequest(req, {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        isStreaming: true,
        tokensSaved,
        compressionRatio,
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
            if (this.headroomEnabled && tokensSaved === 0) {
              const hrStats = await this.fetchHeadroomSavings(model, apiResponse.headers);
              tokensSaved = hrStats.tokensSaved;
              compressionRatio = hrStats.compressionRatio;
            }
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
                  cacheReadTokens = event.response.usage.cache_read_input_tokens || cacheReadTokens;
                  cacheCreationTokens = event.response.usage.cache_creation_input_tokens || cacheCreationTokens;
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
    req: Request,
    res: Response,
    startTime: number
  ): Promise<void> {
    let tokensSaved = 0;
    let compressionRatio = 0;
    const openaiRequest = this.convertClaudeToOpenAIRequest(claudeRequest);
    this.applyMediaSanitizer(openaiRequest);
    const targetUrl = this.getTargetUrl(this.config!.baseUrl, '/chat/completions');

    console.log(`[Proxy] Forwarding to: ${targetUrl}`);
    console.log(`[Proxy] Request model: ${openaiRequest.model}`);
    console.log(`[Proxy] Request body: ${JSON.stringify(openaiRequest, null, 2)}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config!.apiKey}`,
    };
    const traceId = req.headers['trace-id'] as string;
    if (traceId) {
      headers['Trace-Id'] = traceId;
    }
    const userInfo3 = getCachedUserInfo();
    if (userInfo3?.erp) headers['x-llm-erp'] = userInfo3.erp;

    ProxyServer.injectAppCodeHeader(headers, this.config!.baseUrl);
    ProxyServer.injectUserAgent(headers, 'Claude Code');
    ProxyServer.injectRequestId(headers, req);

    const openaiBody = JSON.stringify(openaiRequest);
    const ccMaxRetries = 4;
    let openaiApiResponse!: NodeFetchResponse;
    let ccLastError: { status: number; body: string } | null = null;

    for (let attempt = 1; attempt <= ccMaxRetries; attempt++) {
      openaiApiResponse = await nodeHttpFetch(targetUrl, {
        method: 'POST',
        headers,
        body: openaiBody,
      }, this.cookieInjection);

      if (openaiApiResponse.ok) break;

      const errorBody = await openaiApiResponse.text();
      ccLastError = { status: openaiApiResponse.status, body: errorBody };

      // 上游瞬时故障(5xx)/限流(429)退避重试，与 anthropic 路径一致，避免上游抖动中断长任务。
      if (attempt < ccMaxRetries && ProxyServer.isRetriableUpstreamStatus(openaiApiResponse.status)) {
        const delayMs = ProxyServer.computeRetryDelayMs(attempt, openaiApiResponse.headers.get('retry-after'));
        console.warn(`[Proxy] 上游 ${openaiApiResponse.status}，第 ${attempt}/${ccMaxRetries} 次重试，${delayMs}ms 后重发: ${errorBody.substring(0, 200)}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      console.error(`[Proxy Error] ${openaiApiResponse.status} ${openaiApiResponse.statusText}`);
      console.error(`[Proxy Error] ${errorBody}`);
      const ccDiag = ProxyServer.buildModelDiagnostics({
        errorBody,
        statusCode: openaiApiResponse.status,
        rawModel: claudeRequest.model,
        resolvedModel: openaiRequest.model,
        availableModels: this.config?.models,
        defaultModel: this.config?.defaultModel,
        client: 'claude-code',
      });
      if (ccDiag) {
        logger.error('[Model Diagnostics] ' + ccDiag.diagnostic, ccDiag.logMeta);
        this.logRequest(req, {
          method: 'POST',
          url: '/v1/messages',
          statusCode: openaiApiResponse.status,
          duration: Date.now() - startTime,
          model: claudeRequest.model || 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          isStreaming: claudeRequest.stream || false,
          error: ccDiag.diagnostic,
        });
      }
      res.status(openaiApiResponse.status).json({
        error: 'API Error',
        message: errorBody,
      });
      return;
    }

    if (!openaiApiResponse.ok) {
      // 重试用尽仍失败，透传最后一次错误
      const ccDiag2 = ProxyServer.buildModelDiagnostics({
        errorBody: ccLastError!.body,
        statusCode: ccLastError!.status,
        rawModel: claudeRequest.model,
        resolvedModel: openaiRequest.model,
        availableModels: this.config?.models,
        defaultModel: this.config?.defaultModel,
        client: 'claude-code',
      });
      if (ccDiag2) {
        logger.error('[Model Diagnostics] ' + ccDiag2.diagnostic, ccDiag2.logMeta);
        this.logRequest(req, {
          method: 'POST',
          url: '/v1/messages',
          statusCode: ccLastError!.status,
          duration: Date.now() - startTime,
          model: claudeRequest.model || 'unknown',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          isStreaming: claudeRequest.stream || false,
          error: ccDiag2.diagnostic,
        });
      }
      res.status(ccLastError!.status).json({
        error: 'API Error',
        message: ccLastError!.body,
      });
      return;
    }

    if (claudeRequest.stream) {
      await this.handleStreamResponse(openaiApiResponse, res, claudeRequest.model, claudeRequest, startTime, req);
    } else {
      const openaiResponse = await openaiApiResponse.json();
      const claudeResponse = this.convertOpenAIToClaudeResponse(openaiResponse, claudeRequest.model);

      res.json(claudeResponse);

      if (this.headroomEnabled) {
        const hrStats = await this.fetchHeadroomSavings(claudeRequest.model, openaiApiResponse.headers);
        tokensSaved = hrStats.tokensSaved;
        compressionRatio = hrStats.compressionRatio;
      }

      const duration = Date.now() - startTime;
      let inputTokens = claudeResponse.usage?.input_tokens || 0;
      const outputTokens = claudeResponse.usage?.output_tokens || 0;
      const cacheReadTokens = claudeResponse.usage?.cache_read_input_tokens || 0;
      const cacheCreationTokens = claudeResponse.usage?.cache_creation_input_tokens || 0;

      // OpenAI 语义（claudeResponse.input_tokens 实为 prompt_tokens，含缓存）：扣减为真实计费 input
      inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);

      this.emit('conversation', {
        id: `conv_${Date.now()}`,
        model: claudeRequest.model,
        request: claudeRequest,
        response: claudeResponse,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        duration,
      });

      this.logRequest(req, {
        method: 'POST',
        url: '/v1/messages',
        statusCode: 200,
        duration,
        model: claudeRequest.model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        isStreaming: false,
        tokensSaved,
        compressionRatio,
      });
    }
  }

  private async handleStreamResponse(
    openaiResponse: NodeFetchResponse,
    res: Response,
    model: string,
    claudeRequest: ClaudeMessagesRequest,
    startTime: number,
    req?: Request
  ): Promise<void> {
    let tokensSaved = 0;
    let compressionRatio = 0;
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
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

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
            // 关闭当前活跃的 content block（可能是 thinking 或 text）
            if (collectedContent[contentBlockIndex]) {
              sendEvent('content_block_stop', {
                type: 'content_block_stop',
                index: contentBlockIndex,
              });
            }

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

            if (this.headroomEnabled && tokensSaved === 0) {
              const hrStats = await this.fetchHeadroomSavings(model, openaiResponse.headers);
              tokensSaved = hrStats.tokensSaved;
              compressionRatio = hrStats.compressionRatio;
            }

            inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);

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
              cacheReadTokens,
              cacheCreationTokens,
              duration,
            });

            this.logRequest(req, {
              method: 'POST',
              url: '/v1/messages',
              statusCode: 200,
              duration,
              model: claudeRequest.model,
              inputTokens: inputTokens,
              outputTokens: outputTokens,
              cacheReadTokens,
              cacheCreationTokens,
              isStreaming: true,
              tokensSaved,
              compressionRatio,
            });

            return;
          }

          try {
            const openaiChunk = JSON.parse(data);
            const delta = openaiChunk.choices[0]?.delta;

            if (openaiChunk.usage) {
              inputTokens = openaiChunk.usage.prompt_tokens || 0;
              outputTokens = openaiChunk.usage.completion_tokens || 0;
              cacheReadTokens = openaiChunk.usage.prompt_tokens_details?.cached_tokens ?? openaiChunk.usage.cache_read_input_tokens ?? cacheReadTokens;
              cacheCreationTokens = openaiChunk.usage.cache_creation_input_tokens ?? cacheCreationTokens;
              console.log(`[Proxy Stream] Usage: input=${inputTokens}, output=${outputTokens}, cacheRead=${cacheReadTokens}, total=${inputTokens + outputTokens}`);
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
              initialized = true;
            }

            // reasoning_content → thinking block
            // 注意：Claude 协议要求 thinking 必须在 text 之前。
            // 如果 text 已经开始输出（GLM 等模型可能先发 content 再发 reasoning），
            // 则忽略后续 reasoning，避免违反协议导致客户端清空已显示的正文。
            const reasoningDelta = delta.reasoning_content || delta.reasoning;
            const hasTextStarted = collectedContent.some(c => c?.type === 'text');
            if (reasoningDelta && !hasTextStarted) {
              const text = typeof reasoningDelta === 'string' ? reasoningDelta : (reasoningDelta.content || '');
              if (text) {
                if (!collectedContent[contentBlockIndex] || collectedContent[contentBlockIndex].type !== 'thinking') {
                  sendEvent('content_block_start', {
                    type: 'content_block_start',
                    index: contentBlockIndex,
                    content_block: { type: 'thinking', thinking: '' },
                  });
                  collectedContent[contentBlockIndex] = { type: 'thinking', thinking: '' };
                }
                sendEvent('content_block_delta', {
                  type: 'content_block_delta',
                  index: contentBlockIndex,
                  delta: { type: 'thinking_delta', thinking: text },
                });
                collectedContent[contentBlockIndex].thinking += text;
              }
            }

            if (delta.content) {
              // 切换到 text block（如果之前是 thinking）
              if (collectedContent[contentBlockIndex]?.type === 'thinking') {
                sendEvent('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
                contentBlockIndex++;
              }
              if (!collectedContent[contentBlockIndex] || collectedContent[contentBlockIndex].type !== 'text') {
                sendEvent('content_block_start', {
                  type: 'content_block_start',
                  index: contentBlockIndex,
                  content_block: { type: 'text', text: '' },
                });
                collectedContent[contentBlockIndex] = { type: 'text', text: '' };
              }
              sendEvent('content_block_delta', {
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: { type: 'text_delta', text: delta.content },
              });
              collectedContent[contentBlockIndex].text += delta.content;
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
      let systemText = typeof claudeRequest.system === 'string'
        ? claudeRequest.system
        : claudeRequest.system
            .filter((s: any) => typeof s === 'string' || s?.text)
            .map((s: any) => (typeof s === 'string' ? s : s.text))
            .join('\n\n');
      systemText = ProxyServer.stripLeadingBillingHeader(systemText);
      if (systemText) openaiMessages.push({ role: 'system', content: systemText });
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
        let reasoningText = '';

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
            } else if ((block as any).type === 'thinking' && (block as any).thinking) {
              reasoningText += (block as any).thinking;
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
        if (reasoningText) {
          (assistantMessage as any).reasoning_content = reasoningText;
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

    // o-series 模型使用 max_completion_tokens 而不是 max_tokens
    const caps = this.modelCaps(claudeRequest.model);
    if (caps.tokenParam === 'max_completion_tokens') {
      delete (openaiRequest as any).max_tokens;
      (openaiRequest as any).max_completion_tokens = claudeRequest.max_tokens;
    }

    if (claudeRequest.stream) {
      (openaiRequest as any).stream_options = {
        include_usage: true
      };
    }

    // reasoning effort 映射（GPT-5+ 和 o-series 支持）
    if (claudeRequest.thinking && caps.reasoningEffort) {
      const effort = ProxyServer.resolveReasoningEffort({ reasoning: claudeRequest.thinking });
      if (effort) {
        (openaiRequest as any).reasoning_effort = effort;
      }
    } else if (claudeRequest.thinking) {
      // 部分服务的 chat/completions 使用 thinking_budget 控制思考预算
      const model = claudeRequest.model.toLowerCase();
      if (model.includes('sonnet')) {
        (openaiRequest as any).thinking_budget =
          claudeRequest.thinking.budget_tokens || 16000;
      } else if (!model.includes('opus') && claudeRequest.thinking.budget_tokens) {
        (openaiRequest as any).thinking_budget = claudeRequest.thinking.budget_tokens;
      }
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

    // reasoning_content → thinking block
    const reasoning = choice.message.reasoning_content || choice.message.reasoning;
    if (reasoning) {
      const text = typeof reasoning === 'string' ? reasoning : (reasoning.content || '');
      if (text) {
        contentBlocks.push({ type: 'thinking', thinking: text, signature: '' });
      }
    }

    let textContent = choice.message.content || '';

    // <think>...</think> 块提取
    if (typeof textContent === 'string' && textContent.startsWith('<think>')) {
      const thinkEnd = textContent.indexOf('</think>');
      if (thinkEnd > 0) {
        const thinkText = textContent.substring(7, thinkEnd).trim();
        if (thinkText) {
          contentBlocks.push({ type: 'thinking', thinking: thinkText, signature: '' });
        }
        textContent = textContent.substring(thinkEnd + 8).trim();
      }
    }

    if (textContent) {
      contentBlocks.push({ type: 'text', text: textContent });
    }

    if (choice.message.tool_calls) {
      choice.message.tool_calls.forEach((call: OpenAIToolCall) => {
        let input: any;
        try { input = JSON.parse(call.function.arguments); } catch { input = {}; }
        contentBlocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.function.name,
          input,
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
        input_tokens: openaiResponse.usage?.prompt_tokens ?? 0,
        output_tokens: openaiResponse.usage?.completion_tokens ?? 0,
        cache_read_input_tokens: openaiResponse.usage?.prompt_tokens_details?.cached_tokens
          ?? openaiResponse.usage?.input_tokens_details?.cached_tokens ?? 0,
        cache_creation_input_tokens: openaiResponse.usage?.cache_creation_input_tokens ?? 0,
      },
    };
  }

  /**
   * Codex CLI direct passthrough: body is already in OpenAI format
   * (chat/completions or responses), forward as-is to the upstream codex baseUrl
   * and stream the response back. We only swap Authorization to use the user's
   * configured codex apiKey, and emit metrics so usage shows up in the dashboard.
   */
  /**
   * 诊断：打印 codex 请求体各部分的 UTF-8 字节大小，定位「问候也很大」的来源。
   * instructions = 系统提示词；tools = 工具定义 schema；input/messages = 实际对话内容。
   */
  private static logCodexPayloadSize(tag: string, body: any): void {
    try {
      const sz = (v: any): number =>
        v == null ? 0 : Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8');
      const fmt = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);
      const toolsCount = Array.isArray(body.tools) ? body.tools.length : 0;
      const inputCount = Array.isArray(body.input) ? body.input.length : 0;
      const msgCount = Array.isArray(body.messages) ? body.messages.length : 0;
      logger.info(
        `[${tag}] payload size: total=${fmt(sz(body))} | instructions=${fmt(sz(body.instructions))} ` +
          `tools=${fmt(sz(body.tools))}(${toolsCount}) input=${fmt(sz(body.input))}(${inputCount} items) ` +
          `messages=${fmt(sz(body.messages))}(${msgCount} msgs)`
      );
      // 工具名清单：用于诊断工具数量异常变化（重复注册 / 静默丢弃 type）。
      if (Array.isArray(body.tools) && body.tools.length > 0) {
        const names = body.tools.map((t: any) => {
          const n = t?.function?.name || t?.name || `<${t?.type || 'unknown'}>`;
          return t?.type === 'namespace' && Array.isArray(t?.tools) ? `${n}[ns:${t.tools.length}]` : n;
        });
        const dupes = names.filter((n: string, i: number) => names.indexOf(n) !== i);
        logger.info(`[${tag}] tool names(${names.length}): ${names.join(', ')}${dupes.length ? ` | 重复: ${[...new Set(dupes)].join(', ')}` : ''}`);
      }
    } catch {
      // 诊断日志不应影响主流程
    }
  }

  /**
   * OpenAI 兼容语义下 prompt_tokens/input_tokens 含缓存命中量，
   * 扣减得到真实全量计费的 input。Anthropic 语义（input_tokens 本不含缓存）不应调用此方法。
   */
  private static netInputTokens(inputTokens: number, cacheReadTokens: number): number {
    if (!cacheReadTokens || cacheReadTokens <= 0) return inputTokens;
    return Math.max(0, inputTokens - cacheReadTokens);
  }

  // 判断上游错误是否可重试:5xx 瞬时故障(含 Bedrock 503、网关 BAD_UPSTREAM)与 429 限流。
  private static isRetriableUpstreamStatus(status: number): boolean {
    return status >= 500 || status === 429;
  }

  // 计算重试退避时延:优先遵从上游 Retry-After(秒，上限 10s)，
  // 否则指数退避 + 随机抖动，避免高并发 fan-out(如 deep-research)同时重试形成 retry storm。
  private static computeRetryDelayMs(attempt: number, retryAfter?: string | null): number {
    if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
      return Math.min(parseInt(retryAfter.trim(), 10) * 1000, 10000);
    }
    const base = 500 * Math.pow(2, attempt - 1);
    return base + Math.floor(base * 0.5 * Math.random());
  }

  /**
   * 解析 Codex 请求实际使用的上游 modelId 并写回 requestBody.model。
   *
   * 关键行为：当 dongcc 配置了 codex.defaultModel 时，**始终以它为准**，覆盖 Codex
   * 会话锁定的旧模型。原因：Codex 一旦在任务中选定模型就会持续发送该 model；用户又不能
   * 在 Codex 界面切换官方模型（会绕过代理直连 OpenAI），因此模型切换只能在 dongcc 完成——
   * 由 dongcc 覆盖上游模型，才能让进行中的会话即时切换，无需新开会话。
   * 未配置 defaultModel 时回退为按客户端 model 映射（保持旧行为）。
   */
  private resolveCodexModel(
    codex: ClientProxyConfig,
    requestBody: any
  ): { rawModel: string; resolvedModel: string } {
    const rawModel: string = requestBody.model || '';
    let resolved = rawModel;
    if (codex.defaultModel && codex.models?.length) {
      const def = codex.models.find(m => m.id === codex.defaultModel || m.name === codex.defaultModel);
      resolved = def?.modelId || codex.models[0]?.modelId || rawModel;
    } else if (codex.models?.length) {
      const route = codex.models.find(m => m.id === rawModel || m.name === rawModel);
      if (route) resolved = route.modelId;
    }
    if (resolved) requestBody.model = resolved;
    return { rawModel, resolvedModel: resolved };
  }

  // 已知"必须走 /v1/responses"的模型静态模式(立即兜底,无需先撞一次 400)。
  // 未来新增此类模型,加一条正则即可;更长远的未知模型由 codexResponsesOnlyModels 自学习兜住。
  private static readonly CODEX_RESPONSES_ONLY_PATTERNS: RegExp[] = [
    /codex/,        // *-codex-* 原生 Responses API 模型
    /gpt-?5\.[56]/, // gpt-5.5 / gpt-5.6(Luna/Terra)系:chat/completions 上不支持 函数工具+reasoning_effort,必须走 responses
  ];

  /**
   * 跨所有 client(claude/codex/cursor/opencode)的 models 里按 modelId/id/name 查路由元数据。
   * requestBody.model 在路由决策时可能是别名(id/name)或已解析的上游 modelId，故三者都匹配。
   */
  private lookupModelMeta(model: string): { protocol?: string; apiTypes?: Array<{ apiType: string; path: string }>; capabilities?: string[] } | undefined {
    const m = (model || '').toLowerCase();
    if (!m) return undefined;
    const pools = [this.config?.models, this.codexClient?.models, this.cursorClient?.models, this.opencodeClient?.models];
    for (const pool of pools) {
      if (!pool) continue;
      const hit = pool.find(x =>
        x.modelId?.toLowerCase() === m || x.id?.toLowerCase() === m || x.name?.toLowerCase() === m);
      if (hit) return { protocol: hit.protocol, apiTypes: hit.apiTypes, capabilities: hit.capabilities };
    }
    return undefined;
  }

  /**
   * 每模型能力解析器：逐字段「元数据优先、名字兜底」。
   * 无元数据(老配置/自定义模型)时所有字段退回原名字启发式，保证行为零变化。
   */
  private modelCaps(model: string): ResolvedModelCaps {
    const meta = this.lookupModelMeta(model);
    const lower = (model || '').toLowerCase();

    // ── family：网关 protocol 优先 ──
    let family: ResolvedModelCaps['family'];
    const proto = meta?.protocol?.toLowerCase();
    if (proto === 'claude' || proto === 'anthropic') family = 'anthropic';
    else if (proto === 'openai') family = 'openai';
    else if (proto === 'gemini') family = 'gemini';
    else if (proto === 'other') family = 'other';
    else {
      // 名字兜底：与现有 gpt/deepseek 排除 + opus/sonnet/haiku 判断保持一致
      if (lower.includes('gpt') || lower.includes('deepseek') || ProxyServer.isOSeriesModel(lower)) family = 'openai';
      else if (lower.includes('claude') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku')) family = 'anthropic';
      else if (lower.includes('gemini')) family = 'gemini';
      else family = 'other';
    }

    // ── wireApi：仅在能明确识别时判定，否则 auto 交回正则/自学习 ──
    let wireApi: ResolvedModelCaps['wireApi'] = 'auto';
    if (meta?.apiTypes && meta.apiTypes.length) {
      const paths = meta.apiTypes.map(a => (a.path || '').toLowerCase());
      const hasResponses = paths.some(p => p.includes('/responses'));
      const hasChat = paths.some(p => p.includes('/chat/completions'));
      if (hasResponses && !hasChat) wireApi = 'responses';
      else if (hasChat) wireApi = 'chat';
    }

    // ── vision：正向增强。仅当元数据「明确可视觉」时提升为 true，绝不因缺失能力而误判纯文本(避免误删图像) ──
    let vision = !ProxyServer.isTextOnlyModel(model);
    if (meta?.capabilities?.some(c => c.includes('图像理解') || c.includes('视频理解'))) {
      vision = true;
    }

    return {
      family,
      wireApi,
      vision,
      reasoningEffort: ProxyServer.supportsReasoningEffort(model),
      tokenParam: ProxyServer.isOSeriesModel(model) ? 'max_completion_tokens' : 'max_tokens',
    };
  }

  private applyMediaSanitizer(body: any): number {
    const model = body?.model || '';
    if (ProxyServer.isTextOnlyModel(model) && this.modelCaps(model).vision) {
      return 0; // 名字命中纯文本正则，但元数据(能力标签)证明可理解图像 → 不清洗
    }
    return ProxyServer.sanitizeMediaInRequest(body);
  }

  /** 该 codex 模型是否应直连 /v1/responses(跳过 R→C):静态模式命中 或 已自学习 或 元数据声明仅 responses 端点。 */
  private codexModelNeedsResponses(model: string): boolean {
    const m = (model || '').toLowerCase();
    if (!m) return false;
    if (ProxyServer.CODEX_RESPONSES_ONLY_PATTERNS.some(re => re.test(m))) return true;
    if (this.codexResponsesOnlyModels.has(m)) return true;
    // 元数据兜底：网关声明该模型仅有 responses 端点(无 chat/completions)→ 直连 responses，
    // 无需先撞一次 400 靠自学习。仅「额外识别」，不把正则判定的 responses 模型翻回 chat。
    if (this.modelCaps(model).wireApi === 'responses') return true;
    return false;
  }

  private async handleCodexPassthrough(
    req: Request,
    res: Response,
    wireApi: 'chat' | 'responses',
    forcePassthrough = false,
  ): Promise<void> {
    const startTime = Date.now();
    const codex = this.codexClient;

    if (!codex || !codex.apiKey || !codex.baseUrl) {
      res.status(503).json({
        error: 'Codex Not Configured',
        message: '请在 DongCC 配置页 Codex Tab 完成配置',
      });
      return;
    }

    const requestBody = req.body || {};
    const isStreaming = requestBody.stream === true;

    // 模型解析：dongcc 配置了默认模型时以其为准，覆盖 Codex 会话锁定的旧模型
    const { rawModel: requestModel, resolvedModel } = this.resolveCodexModel(codex, requestBody);
    const loggedModel = resolvedModel || requestModel;

    const codexApiFormat = codex.apiFormat || 'responses';
    // 自动路由：需走 responses 的模型（codex 原生 / gpt-5.5 静态兜底 / 已自学习）直连 passthrough，
    // 跳过注定失败的 R→C；其余模型走 R→C 转换以支持 tool_search 等 Codex 内置插件、兼容只支持 chat 的上游。
    const needsResponses = this.codexModelNeedsResponses(requestBody.model);
    if (!forcePassthrough && wireApi === 'responses' && (codexApiFormat === 'chat-completions' || !needsResponses)) {
      return this.handleCodexResponsesToChatConversion(req, res, startTime);
    }

    const endpoint = wireApi === 'chat' ? '/chat/completions' : '/responses';
    const targetUrl = this.getTargetUrl(codex.baseUrl.replace(/\/$/, ''), endpoint);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${codex.apiKey}`,
    };
    const traceId = req.headers['trace-id'] as string;
    if (traceId) headers['Trace-Id'] = traceId;
    const userInfo4 = getCachedUserInfo();
    if (userInfo4?.erp) headers['x-llm-erp'] = userInfo4.erp;

    ProxyServer.injectAppCodeHeader(headers, codex.baseUrl);
    ProxyServer.injectUserAgent(headers, 'Codex');
    ProxyServer.injectRequestId(headers, req);

    console.log(`[Codex Passthrough] ${wireApi} → ${targetUrl}, model=${requestModel}→${requestBody.model}, stream=${isStreaming}`);

    // 只保留顶层核心工具：直接丢弃 namespace 子工具、tool_search、web_search* 等
    // 上游内置工具，不再展开到 tools[]。目的是显著缩减 tools schema 体积，避免
    // Codex 的浏览器工具集等把 tools 段膨胀到几十 KB。namespace 名保留在映射里
    // 只用于历史 function_call 的还原（上游若已按扁平名调用，仍能被识别）。
    const nsToolMap = new Map<string, string>(); // subToolName → namespace（仅供响应侧回填）
    let droppedNamespaceSubs = 0;
    let droppedInlineDynamic = 0;
    if (requestBody.tools && Array.isArray(requestBody.tools)) {
      const kept: any[] = [];
      for (const tool of requestBody.tools) {
        if (tool?.type === 'namespace' && Array.isArray(tool.tools)) {
          // 记录 sub → namespace 映射，但**不**把子工具展开到顶层
          for (const sub of tool.tools) {
            if (sub?.name) nsToolMap.set(sub.name, tool.name);
          }
          droppedNamespaceSubs += tool.tools.length;
        } else if (tool?.type === 'tool_search') {
          // tool_search 是 Codex 客户端本地执行的，不转发给上游
        } else if (typeof tool?.type === 'string' && tool.type.toLowerCase().startsWith('web_search')) {
          // web_search 系列为客户端内置工具，上游不支持，剥离
        } else if (tool?.type === 'function' || tool?.type === 'custom') {
          kept.push(tool);
        } else {
          // 未知/不支持类型也丢弃，避免上游报 "tool type not supported"
          droppedInlineDynamic++;
        }
      }
      requestBody.tools = kept;
    }

    // 递归剥离 input 中 tool_search_output 内部的 tools 列表（Codex 动态注册的浏览器工具等）。
    // 不动其余字段（call_id / query / output 需要保留，供上下文继续对话）。
    let strippedInInput = 0;
    if (Array.isArray(requestBody.input)) {
      const clearNestedTools = (value: any): void => {
        if (Array.isArray(value)) {
          for (const v of value) clearNestedTools(v);
          return;
        }
        if (value && typeof value === 'object') {
          if (
            (value.type === 'tool_search_output' || value.type === 'tool_search_call_output') &&
            Array.isArray(value.tools)
          ) {
            strippedInInput += value.tools.length;
            value.tools = [];
          }
          for (const k of Object.keys(value)) clearNestedTools(value[k]);
        }
      };
      clearNestedTools(requestBody.input);
    }

    // 剥离 input 中前轮的 reasoning items：encrypted_content 由上游签发的加密 CoT，
    // 切模型/切路径(R→C↔responses)/切上游节点都会导致下游解不开 → invalid_encrypted_content 400。
    // 对话历史(message/function_call/function_call_output)全部保留，模型记忆不受影响；
    // 仅代价是推理模型每轮重新思考，省掉解密校验失败风险。
    let strippedReasoning = 0;
    if (Array.isArray(requestBody.input)) {
      const before = requestBody.input.length;
      requestBody.input = requestBody.input.filter((it: any) => it?.type !== 'reasoning');
      strippedReasoning = before - requestBody.input.length;
    }

    // 调试日志：记录裁剪后的工具数量
    const toolsBefore = (req.body?.tools || []).length;
    const nsTops = (req.body?.tools || []).filter((t: any) => t?.type === 'namespace').length;
    logger.info(
      `[Codex Passthrough] tools 裁剪: 原 ${toolsBefore} 个（含 ${nsTops} 个 namespace，${droppedNamespaceSubs} 子工具）→ ` +
        `保留 ${requestBody.tools?.length ?? 0} 个顶层核心工具；丢弃动态/未知 ${droppedInlineDynamic} 个；` +
        `剥离 input 内动态工具 ${strippedInInput} 个；剥离前轮 reasoning ${strippedReasoning} 个；model=${requestModel}`
    );

    // Media Sanitizer：纯文本模型自动替换图片块（与 R→C 路径对齐，避免图片块被上游拒）
    this.applyMediaSanitizer(requestBody);

    ProxyServer.logCodexPayloadSize(`Codex Passthrough ${wireApi}`, requestBody);

    const cxMaxRetries = 4;

    try {
      let upstream!: NodeFetchResponse;
      for (let attempt = 1; attempt <= cxMaxRetries; attempt++) {
        upstream = await nodeHttpFetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        }, this.cookieInjection);

        if (upstream.ok) break;

        const errorBody = await upstream.text();

        // 当 responses 端点返回 model 相关错误时，自动 fallback 到 chat/completions 转换（最高优先级，不重试）
        // forcePassthrough=true 表示本次正是从 R→C 因"请改用 /v1/responses"回退而来，禁止再退回去，避免来回循环
        if (!forcePassthrough && wireApi === 'responses' && /model.*(not found|missing)/i.test(errorBody)) {
          logger.info(`[Codex Passthrough] responses 端点不支持模型 ${requestBody.model}，fallback 到 chat/completions`);
          return this.handleCodexResponsesToChatConversion(req, res, startTime);
        }

        // 上游瞬时故障(5xx)/限流(429)退避重试，与 anthropic 路径一致
        if (attempt < cxMaxRetries && ProxyServer.isRetriableUpstreamStatus(upstream.status)) {
          const delayMs = ProxyServer.computeRetryDelayMs(attempt, upstream.headers.get('retry-after'));
          console.warn(`[Codex Passthrough] 上游 ${upstream.status}，第 ${attempt}/${cxMaxRetries} 次重试，${delayMs}ms 后重发: ${errorBody.substring(0, 200)}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // 不可重试或重试用尽：走错误处理
        logger.error(`[Codex Passthrough] 上游返回 ${upstream.status}`, { response: errorBody.substring(0, 1000) });
        const cxDiag = ProxyServer.buildModelDiagnostics({
          errorBody,
          statusCode: upstream.status,
          rawModel: requestModel,
          resolvedModel: requestBody.model,
          availableModels: codex.models,
          defaultModel: codex.defaultModel,
          client: 'codex',
        });
        if (cxDiag) logger.error('[Model Diagnostics] ' + cxDiag.diagnostic, cxDiag.logMeta);
        this.logRequest(req, {
          method: 'POST',
          url: req.url,
          statusCode: upstream.status,
          duration: Date.now() - startTime,
          model: loggedModel,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          isStreaming,
          client: 'codex',
          error: cxDiag ? cxDiag.diagnostic : `上游返回 ${upstream.status}: ${errorBody.substring(0, 500)}`,
        });
        res.status(upstream.status).json(ProxyServer.buildCodexErrorResponse(errorBody, upstream.status));
        return;
      }

      // Stream response straight through
      if (isStreaming) {
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = upstream.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        let buffer = '';

        let chunkCount = 0;
        const needsNsRewrite = nsToolMap.size > 0;

        // 断流兜底状态:跟踪整轮是否见过 response.* 事件、是否收到终止事件(completed/failed/incomplete),
        // 并复原可用的响应快照(id/model/已完成 output item/最后 sequence_number),供上游在
        // response.completed 前中断(常见 Windows 锁屏掐连接,或 Headroom 压缩打断流)时补发一个终止事件,
        // 避免 codex 报 "stream closed before response.completed" 反复重试甚至崩溃。
        let sawTerminalEvent = false;
        let streamStarted = false;
        let respId = '';
        let respModel = '';
        let lastSeq = -1;
        const completedItems: any[] = [];
        const trackCodexStreamEvent = (evt: any): void => {
          if (!evt || typeof evt !== 'object') return;
          if (typeof evt.sequence_number === 'number' && evt.sequence_number > lastSeq) lastSeq = evt.sequence_number;
          const t = typeof evt.type === 'string' ? evt.type : '';
          if (t.startsWith('response.')) streamStarted = true;
          if (t === 'response.completed' || t === 'response.failed' || t === 'response.incomplete') sawTerminalEvent = true;
          if (evt.response && typeof evt.response === 'object') {
            if (evt.response.id) respId = evt.response.id;
            if (evt.response.model) respModel = evt.response.model;
          }
          if (t === 'response.output_item.done' && evt.item) completedItems.push(evt.item);
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // 收尾时解析残留 buffer 里最后一个(可能结尾无换行)事件:
              //  · 标记是否已收到 response.completed —— 避免下方 finally 兜底重复补发;
              //  · ns-rewrite 分支是逐行写出、尾部不完整行留在 buffer 未发,需把它原样补发出去
              //    (否则无换行结尾的 response.completed 会被丢弃 → 客户端报 stream closed before response.completed);
              //  · 非 ns 分支已 res.write(chunk) 全量透传,buffer 仅用于解析,只解析不重写。
              if (buffer) {
                for (const bl of buffer.split('\n')) {
                  if (!bl.startsWith('data: ')) continue;
                  const d = bl.substring(6).trim();
                  if (!d || d === '[DONE]') continue;
                  try { trackCodexStreamEvent(JSON.parse(d)); } catch { /* 半截 JSON,忽略 */ }
                }
                if (needsNsRewrite) res.write(buffer);
                buffer = '';
              }
              logger.info(`[Codex Stream] done after ${chunkCount} chunks, tokens: in=${inputTokens} out=${outputTokens}`);
              break;
            }
            chunkCount++;
            const chunk = decoder.decode(value, { stream: true });
            if (chunkCount <= 3) {
              logger.info(`[Codex Stream] chunk#${chunkCount} (${value.length}B): ${chunk.substring(0, 300)}`);
            }

            if (needsNsRewrite) {
              // 需要注入 namespace：逐事件解析，改写后发送
              buffer += chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.substring(6).trim();
                  if (data && data !== '[DONE]') {
                    try {
                      const evt = JSON.parse(data);
                      let modified = false;
                      if (evt.type === 'response.output_item.added' && evt.item?.type === 'function_call') {
                        const ns = nsToolMap.get(evt.item.name);
                        if (ns) { evt.item.namespace = ns; modified = true; }
                      } else if (evt.type === 'response.output_item.done' && evt.item?.type === 'function_call') {
                        const ns = nsToolMap.get(evt.item.name);
                        if (ns) { evt.item.namespace = ns; modified = true; }
                      } else if (evt.type === 'response.completed' && Array.isArray(evt.response?.output)) {
                        for (const item of evt.response.output) {
                          if (item.type === 'function_call') {
                            const ns = nsToolMap.get(item.name);
                            if (ns) { item.namespace = ns; modified = true; }
                          }
                        }
                      }
                      if (evt.usage) {
                        inputTokens = evt.usage.prompt_tokens ?? evt.usage.input_tokens ?? inputTokens;
                        outputTokens = evt.usage.completion_tokens ?? evt.usage.output_tokens ?? outputTokens;
                        cacheReadTokens = evt.usage.prompt_tokens_details?.cached_tokens ?? evt.usage.input_tokens_details?.cached_tokens ?? evt.usage.cache_read_input_tokens ?? cacheReadTokens;
                        cacheCreationTokens = evt.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                      } else if (evt.response?.usage) {
                        inputTokens = evt.response.usage.input_tokens ?? inputTokens;
                        outputTokens = evt.response.usage.output_tokens ?? outputTokens;
                        cacheReadTokens = evt.response.usage.prompt_tokens_details?.cached_tokens ?? evt.response.usage.input_tokens_details?.cached_tokens ?? evt.response.usage.cache_read_input_tokens ?? cacheReadTokens;
                        cacheCreationTokens = evt.response.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                      }
                      trackCodexStreamEvent(evt);
                      if (modified) {
                        res.write(`data: ${JSON.stringify(evt)}\n\n`);
                      } else {
                        res.write(line + '\n');
                      }
                    } catch {
                      res.write(line + '\n');
                    }
                  } else {
                    res.write(line + '\n');
                  }
                } else {
                  res.write(line + '\n');
                }
              }
            } else {
              // 无 namespace 工具，直接透传原始字节，保持 SSE 格式不变
              res.write(chunk);

              // best-effort 解析 usage
              buffer += chunk;
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.substring(6).trim();
                if (!data || data === '[DONE]') continue;
                try {
                  const evt = JSON.parse(data);
                  trackCodexStreamEvent(evt);
                  if (evt.usage) {
                    inputTokens = evt.usage.prompt_tokens ?? evt.usage.input_tokens ?? inputTokens;
                    outputTokens = evt.usage.completion_tokens ?? evt.usage.output_tokens ?? outputTokens;
                    cacheReadTokens = evt.usage.prompt_tokens_details?.cached_tokens ?? evt.usage.input_tokens_details?.cached_tokens ?? evt.usage.cache_read_input_tokens ?? cacheReadTokens;
                    cacheCreationTokens = evt.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                  } else if (evt.response?.usage) {
                    inputTokens = evt.response.usage.input_tokens ?? inputTokens;
                    outputTokens = evt.response.usage.output_tokens ?? outputTokens;
                    cacheReadTokens = evt.response.usage.prompt_tokens_details?.cached_tokens ?? evt.response.usage.input_tokens_details?.cached_tokens ?? evt.response.usage.cache_read_input_tokens ?? cacheReadTokens;
                    cacheCreationTokens = evt.response.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
          // 断流兜底:上游在 response.completed 前就结束/断开(常见 Windows 锁屏掐连接,或 Headroom 压缩打断流)。
          // 若整轮见过 response.* 事件却没有任何终止事件,则补发一个 response.completed,让 codex 干净收尾、
          // 不再报 "stream closed before response.completed" 反复重试甚至崩溃。output 只含已完成 item,避免半截工具调用。
          if (streamStarted && !sawTerminalEvent && res.writable && !res.writableEnded) {
            try {
              const synthetic = {
                type: 'response.completed',
                response: {
                  id: respId || `resp_${Date.now().toString(36)}`,
                  object: 'response',
                  status: 'completed',
                  model: respModel || requestModel,
                  output: completedItems,
                  usage: {
                    input_tokens: inputTokens,
                    output_tokens: outputTokens,
                    total_tokens: inputTokens + outputTokens,
                  },
                },
                sequence_number: lastSeq + 1,
              };
              res.write(`event: response.completed\ndata: ${JSON.stringify(synthetic)}\n\n`);
              logger.warn('[Codex Stream] 上游在 response.completed 前中断,已兜底补发 response.completed', {
                model: loggedModel, items: completedItems.length, chunks: chunkCount,
              });
            } catch (e: any) {
              logger.warn('[Codex Stream] 兜底补发 response.completed 失败', { error: e?.message });
            }
          }
          if (!res.writableEnded) res.end();
        }

        let tokensSaved = 0;
        let compressionRatio = 0;
        if (this.headroomEnabled) {
          const hrStats = await this.fetchHeadroomSavings(requestModel, upstream.headers);
          tokensSaved = hrStats.tokensSaved;
          compressionRatio = hrStats.compressionRatio;
        }

        // OpenAI 兼容语义：prompt_tokens/input_tokens 含缓存命中量，扣减为真实计费 input
        inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);

        this.logRequest(req, {
          method: 'POST',
          url: req.url,
          statusCode: 200,
          duration: Date.now() - startTime,
          model: loggedModel,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          isStreaming: true,
          client: 'codex',
          tokensSaved,
          compressionRatio,
        });
        return;
      }

      // Non-streaming — 注入 namespace 到 function_call 输出
      const responseJson: any = await upstream.json();
      const outputTypes = (responseJson.output || []).map((o: any) => o.type).join(',');
      logger.info(`[Codex Passthrough] non-stream response: status=${responseJson.status}, output=[${outputTypes}]`);
      if (nsToolMap.size > 0 && Array.isArray(responseJson.output)) {
        for (const item of responseJson.output) {
          if (item.type === 'function_call' && item.name) {
            const ns = nsToolMap.get(item.name);
            if (ns) item.namespace = ns;
          }
        }
      }
      res.json(responseJson);

      const usage = responseJson.usage || responseJson.response?.usage || {};
      let inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
      const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;

      let tokensSavedNonStream = 0;
      let compressionRatioNonStream = 0;
      if (this.headroomEnabled) {
        const hrStats = await this.fetchHeadroomSavings(requestModel, upstream.headers);
        tokensSavedNonStream = hrStats.tokensSaved;
        compressionRatioNonStream = hrStats.compressionRatio;
      }

      // OpenAI 兼容语义：prompt_tokens/input_tokens 含缓存命中量，扣减为真实计费 input
      inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);

      this.logRequest(req, {
        method: 'POST',
        url: req.url,
        statusCode: 200,
        duration: Date.now() - startTime,
        model: loggedModel,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        isStreaming: false,
        client: 'codex',
        tokensSaved: tokensSavedNonStream,
        compressionRatio: compressionRatioNonStream,
      });
    } catch (error: any) {
      logger.error('[Codex Passthrough] failed', { error: error.message });
      this.logRequest(req, {
        method: 'POST',
        url: req.url,
        statusCode: 502,
        duration: Date.now() - startTime,
        model: loggedModel,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming,
        client: 'codex',
        error: error.message,
      });
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Codex Proxy Error',
          message: error.message,
        });
      }
    }
  }

  /**
   * Cursor / OpenCode 通用代理转发
   * 与 handleCodexPassthrough 逻辑一致，但根据 clientType 选择不同的上游配置
   */
  private async handleClientPassthrough(
    req: Request,
    res: Response,
    clientType: 'cursor' | 'opencode',
    wireApi: 'chat' | 'anthropic'
  ): Promise<void> {
    const startTime = Date.now();
    const client = clientType === 'cursor' ? this.cursorClient : this.opencodeClient;

    if (!client || !client.apiKey || !client.baseUrl) {
      res.status(503).json({
        error: `${clientType === 'cursor' ? 'Cursor' : 'OpenCode'} Not Configured`,
        message: `请在 DongCC 配置页 ${clientType === 'cursor' ? 'Cursor' : 'OpenCode'} Tab 完成配置`,
      });
      return;
    }

    const requestBody = req.body || {};
    const requestModel: string = requestBody.model || 'unknown';
    const isStreaming = requestBody.stream === true;

    // 模型映射：将请求中的 model name/id 映射为真实的上游 modelId
    let resolvedModel = requestModel;
    if (client.models?.length) {
      const route = client.models.find(m => m.id === requestModel || m.name === requestModel);
      if (route) {
        resolvedModel = route.modelId;
        requestBody.model = resolvedModel;
      }
    }
    const loggedModel = resolvedModel;

    // Headroom 集成：当启用时，请求通过 Headroom 透明代理转发，自动压缩
    // 不再需要手动调用 compress，Headroom 代理会自动处理
    let tokensSaved = 0;
    let compressionRatio = 1;

    // 确定上游端点路径
    let endpoint: string;
    if (wireApi === 'chat') {
      endpoint = '/chat/completions';
    } else {
      endpoint = '/messages';
    }

    // 如果客户端配置的 apiFormat 与路由不匹配，按客户端配置的 apiFormat 走
    const effectiveApiFormat = client.apiFormat || 'chat-completions';
    if (effectiveApiFormat === 'anthropic' && wireApi === 'chat') {
      // 客户端配置了 anthropic 但请求走 chat 路径 → 转换为 anthropic 格式
      endpoint = '/messages';
    } else if (effectiveApiFormat === 'chat-completions' && wireApi === 'anthropic') {
      // 客户端配置了 chat-completions 但请求走 anthropic 路径 → 转换为 chat 格式
      endpoint = '/chat/completions';
    }
    if (endpoint === '/chat/completions') {
    }

    const targetUrl = this.getTargetUrl(client.baseUrl.replace(/\/$/, ''), endpoint);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${client.apiKey}`,
    };
    const traceId = req.headers['trace-id'] as string;
    if (traceId) headers['Trace-Id'] = traceId;
    const userInfo = getCachedUserInfo();
    if (userInfo?.erp) headers['x-llm-erp'] = userInfo.erp;

    ProxyServer.injectAppCodeHeader(headers, client.baseUrl);
    ProxyServer.injectUserAgent(headers, clientType === 'opencode' ? 'OpenCode' : 'Cursor');
    ProxyServer.injectRequestId(headers, req);

    // anthropic 格式需要额外的头
    if (endpoint === '/messages') {
      headers['anthropic-version'] = '2023-06-01';
    }

    console.log(`[${clientType} Passthrough] ${wireApi} → ${targetUrl}, model=${requestModel}, stream=${isStreaming}`);

    try {
      const upstream = await nodeHttpFetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      }, this.cookieInjection);

      if (!upstream.ok) {
        const errorBody = await upstream.text();
        logger.error(`[${clientType} Passthrough] 上游返回 ${upstream.status}`, { response: errorBody.substring(0, 1000) });
        const clDiag = ProxyServer.buildModelDiagnostics({
          errorBody,
          statusCode: upstream.status,
          rawModel: requestModel,
          resolvedModel: requestBody.model,
          availableModels: client.models,
          defaultModel: client.defaultModel,
          client: clientType,
        });
        if (clDiag) logger.error('[Model Diagnostics] ' + clDiag.diagnostic, clDiag.logMeta);
        this.logRequest(req, {
          method: 'POST',
          url: req.url,
          statusCode: upstream.status,
          duration: Date.now() - startTime,
          model: loggedModel,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          isStreaming,
          client: clientType,
          error: clDiag ? clDiag.diagnostic : `上游返回 ${upstream.status}: ${errorBody.substring(0, 500)}`,
        });
        res.status(upstream.status).json({
          error: 'Upstream Error',
          message: errorBody,
        });
        return;
      }

      // Stream response straight through
      if (isStreaming) {
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = upstream.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheCreationTokens = 0;
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            res.write(chunk);

            // Best-effort parse for usage
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.substring(6).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const evt = JSON.parse(data);
                if (evt.usage) {
                  inputTokens = evt.usage.prompt_tokens ?? evt.usage.input_tokens ?? inputTokens;
                  outputTokens = evt.usage.completion_tokens ?? evt.usage.output_tokens ?? outputTokens;
                  cacheReadTokens = evt.usage.prompt_tokens_details?.cached_tokens ?? evt.usage.input_tokens_details?.cached_tokens ?? evt.usage.cache_read_input_tokens ?? cacheReadTokens;
                  cacheCreationTokens = evt.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                } else if (evt.response?.usage) {
                  inputTokens = evt.response.usage.input_tokens ?? inputTokens;
                  outputTokens = evt.response.usage.output_tokens ?? outputTokens;
                  cacheReadTokens = evt.response.usage.prompt_tokens_details?.cached_tokens ?? evt.response.usage.input_tokens_details?.cached_tokens ?? evt.response.usage.cache_read_input_tokens ?? cacheReadTokens;
                  cacheCreationTokens = evt.response.usage.cache_creation_input_tokens ?? cacheCreationTokens;
                }
              } catch {
                // ignore non-JSON lines
              }
            }
          }
        } finally {
          reader.releaseLock();
          if (!res.writableEnded) res.end();
        }

        if (this.headroomEnabled && tokensSaved === 0) {
          const hrStats = await this.fetchHeadroomSavings(requestModel, upstream.headers);
          tokensSaved = hrStats.tokensSaved;
          compressionRatio = hrStats.compressionRatio;
        }

        // 仅 OpenAI 语义（chat）需扣缓存；anthropic 路由的 input_tokens 本不含缓存
        if (wireApi === 'chat') {
          inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);
        }

        this.logRequest(req, {
          method: 'POST',
          url: req.url,
          statusCode: 200,
          duration: Date.now() - startTime,
          model: loggedModel,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheCreationTokens,
          isStreaming: true,
          client: clientType,
          tokensSaved,
          compressionRatio,
        });
        return;
      }

      // Non-streaming
      const responseJson: any = await upstream.json();
      res.json(responseJson);

      const usage = responseJson.usage || responseJson.response?.usage || {};
      let inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
      const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0;
      const cacheCreationTokens = usage.cache_creation_input_tokens ?? 0;

      if (this.headroomEnabled) {
        const hrStats = await this.fetchHeadroomSavings(requestModel, upstream.headers);
        tokensSaved = hrStats.tokensSaved;
        compressionRatio = hrStats.compressionRatio;
      }

      // 仅 OpenAI 语义（chat）需扣缓存；anthropic 路由的 input_tokens 本不含缓存
      if (wireApi === 'chat') {
        inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);
      }

      this.logRequest(req, {
        method: 'POST',
        url: req.url,
        statusCode: 200,
        duration: Date.now() - startTime,
        model: loggedModel,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        isStreaming: false,
        client: clientType,
        tokensSaved,
        compressionRatio,
      });
    } catch (error: any) {
      logger.error(`[${clientType} Passthrough] failed`, { error: error.message });
      this.logRequest(req, {
        method: 'POST',
        url: req.url,
        statusCode: 502,
        duration: Date.now() - startTime,
        model: loggedModel,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        isStreaming,
        client: clientType,
        error: error.message,
      });
      if (!res.headersSent) {
        res.status(502).json({
          error: `${clientType === 'cursor' ? 'Cursor' : 'OpenCode'} Proxy Error`,
          message: error.message,
        });
      }
    }
  }

  configure(config: ProxyConfig): void {
    // Normalize incoming config — accept both new {claude, codex} shape and
    // legacy flat shape. Internally we keep `this.config` flattened for the
    // existing /v1/messages handlers, and `this.codexClient` separate.
    this.cookieInjection = (config as any).cookieInjection === true;

    const claude: ClientProxyConfig | undefined = config.claude || (
      config.apiKey ? {
        apiKey: config.apiKey,
        baseUrl: config.baseUrl || '',
        apiFormat: config.apiFormat || 'anthropic',
        models: config.models,
        defaultModel: config.defaultModel,
      } : undefined
    );

    if (claude) {
      this.config = {
        port: config.port,
        claude,
        codex: config.codex,
        apiKey: claude.apiKey,
        baseUrl: claude.baseUrl,
        apiFormat: claude.apiFormat,
        models: claude.models,
        defaultModel: claude.defaultModel,
      };
    } else {
      // No claude client configured — keep a stub so existing checks still work.
      this.config = {
        port: config.port,
        codex: config.codex,
        apiKey: '',
        baseUrl: '',
        apiFormat: 'anthropic',
      };
    }

    this.codexClient = config.codex || null;
    this.cursorClient = config.cursor || null;
    this.opencodeClient = config.opencode || null;
    this.desktopClient = config.claudeDesktop || null;

    // Headroom 压缩配置
    this.headroomEnabled = config.headroom?.enabled === true;
    if (config.headroom?.proxyUrl) {
      this.headroomProxyUrl = config.headroom.proxyUrl;
    }
    if (this.headroomEnabled) {
      logger.info(`[Headroom] 已启用，代理地址: ${this.headroomProxyUrl}，请求将通过 Headroom 透明代理转发`);
    }

    this.emit('configured', config);
  }

  /**
   * 计算转发目标 URL：当 Headroom 启用且上游匹配时，请求转发给 Headroom 透明代理
   * 如果当前请求的 baseUrl 和 Headroom 配置的上游不匹配，则直连上游
   */
  private getTargetUrl(originalBaseUrl: string, path: string): string {
    if (this.headroomEnabled) {
      const isAnthropicPath = path.includes('/messages');
      const matchHost = isAnthropicPath
        ? this.headroomUpstreamHosts.anthropic
        : this.headroomUpstreamHosts.openai;
      if (matchHost && originalBaseUrl.includes(matchHost)) {
        const headroomBase = this.headroomProxyUrl.replace(/\/$/, '');
        const headroomPath = path.startsWith('/v1/') ? path : `/v1${path}`;
        return `${headroomBase}${headroomPath}`;
      }
    }
    return `${originalBaseUrl.replace(/\/$/, '')}${path}`;
  }

  private static injectAppCodeHeader(headers: Record<string, string>, baseUrl: string): void {
    // 部分自建网关要求携带应用标识，可通过环境变量按需开启
    const appCode = process.env.DONGCC_APPCODE;
    if (appCode) headers['X-LLM-APPCODE'] = appCode;
  }

  private static injectUserAgent(headers: Record<string, string>, client: string): void {
    headers['User-Agent'] = client;
  }

  /** 透传本次请求的 request_id 到上游网关(PRD 4.1.1:X-Request-Id 贯穿全链路)。 */
  private static injectRequestId(headers: Record<string, string>, req?: Request): void {
    const id = (req as any)?.dongccRequestId;
    if (id) headers['X-Request-Id'] = id;
  }

  /**
   * 统一的请求记录出口:保留原有 'request' 事件(用量入库不变),并额外组装并发射
   * 'requestLog'(PRD 网关级日志)。所有原 `this.logRequest(req, {...})` 均改走此方法,
   * 从 req 取 request_id、补 base_url/instance_id/version。异常不影响主链路。
   */
  private logRequest(req: Request | undefined, data: Record<string, any>): void {
    this.emit('request', data);
    try {
      this.emit('requestLog', buildRequestLog(data, {
        requestId: (req as any)?.dongccRequestId,
        baseUrl: this.config?.baseUrl,
        instanceId: getCachedInstanceId(),
        dongccVersion: (() => { try { return app.getVersion(); } catch { return undefined; } })(),
      }));
    } catch (e) {
      logger.warn('[LogReporting] 组装 requestLog 失败(忽略)', e);
    }
  }


  private static extractHeadroomStatsFromHeaders(
    headers: { get: (name: string) => string | null | undefined }
  ): { tokensSaved: number; compressionRatio: number; inputTokensOptimized: number; inputTokensOriginal: number } | null {
    const tokensSaved = parseInt(headers.get('x-headroom-tokens-saved') || '0', 10);
    // headroom-ai(0.32.x) 实际吐的是 x-headroom-tokens-before / -after；
    // 兼容早期/其它版本可能用的 x-headroom-input-tokens-original / -optimized。
    const inputOriginal = parseInt(
      headers.get('x-headroom-tokens-before') || headers.get('x-headroom-input-tokens-original') || '0',
      10
    );
    const inputOptimized = parseInt(
      headers.get('x-headroom-tokens-after') || headers.get('x-headroom-input-tokens-optimized') || '0',
      10
    );

    if (tokensSaved > 0 || inputOriginal > 0) {
      const ratio = inputOriginal > 0 ? tokensSaved / inputOriginal : 0;
      logger.info(`[Headroom] stats from response headers: saved=${tokensSaved}, original=${inputOriginal}, optimized=${inputOptimized}`);
      return { tokensSaved, compressionRatio: ratio, inputTokensOptimized: inputOptimized, inputTokensOriginal: inputOriginal };
    }
    return null;
  }

  private cachedHeadroomStats: { data: any; fetchedAt: number } | null = null;
  private static readonly HEADROOM_STATS_CACHE_TTL = 5000;

  private static matchHeadroomStats(
    stats: any,
    model?: string
  ): { tokensSaved: number; compressionRatio: number; inputTokensOptimized: number; inputTokensOriginal: number } {
    const recentRequests: any[] = stats?.recent_requests || [];
    if (recentRequests.length === 0) {
      return { tokensSaved: 0, compressionRatio: 0, inputTokensOptimized: 0, inputTokensOriginal: 0 };
    }

    let matched = recentRequests[recentRequests.length - 1];
    if (model) {
      for (let i = recentRequests.length - 1; i >= 0; i--) {
        if (recentRequests[i].model?.includes(model)) {
          matched = recentRequests[i];
          break;
        }
      }
    }

    if (matched) {
      const tokensSaved = matched.tokens_saved || 0;
      const original = matched.input_tokens_original || 0;
      const optimized = matched.input_tokens_optimized || 0;
      const ratio = original > 0 ? tokensSaved / original : 0;
      logger.info(`[Headroom] matched from /stats: model=${matched.model}, saved=${tokensSaved}, original=${original}, optimized=${optimized}`);
      return { tokensSaved, compressionRatio: ratio, inputTokensOptimized: optimized, inputTokensOriginal: original };
    }
    return { tokensSaved: 0, compressionRatio: 0, inputTokensOptimized: 0, inputTokensOriginal: 0 };
  }

  private async fetchHeadroomSavings(
    model?: string,
    responseHeaders?: { get: (name: string) => string | null | undefined }
  ): Promise<{ tokensSaved: number; compressionRatio: number; inputTokensOptimized: number; inputTokensOriginal: number }> {
    if (!this.headroomEnabled) return { tokensSaved: 0, compressionRatio: 0, inputTokensOptimized: 0, inputTokensOriginal: 0 };

    // 优先从响应头读取（精确的每请求统计，无并发匹配问题）
    if (responseHeaders) {
      const headerStats = ProxyServer.extractHeadroomStatsFromHeaders(responseHeaders);
      if (headerStats) return headerStats;
    }

    // 回退：从 /stats 端点查询（带缓存，最多 5 秒刷新一次）
    try {
      const now = Date.now();
      if (this.cachedHeadroomStats && (now - this.cachedHeadroomStats.fetchedAt) < ProxyServer.HEADROOM_STATS_CACHE_TTL) {
        return ProxyServer.matchHeadroomStats(this.cachedHeadroomStats.data, model);
      }

      const url = `${this.headroomProxyUrl.replace(/\/$/, '')}/stats`;
      const statsResponse = await nodeHttpFetch(url, {
        method: 'GET',
        headers: {},
      });
      if (statsResponse.ok) {
        const text = await statsResponse.text();
        const stats = JSON.parse(text);
        this.cachedHeadroomStats = { data: stats, fetchedAt: now };
        return ProxyServer.matchHeadroomStats(stats, model);
      }
    } catch (e) {
      // ignore
    }
    return { tokensSaved: 0, compressionRatio: 0, inputTokensOptimized: 0, inputTokensOriginal: 0 };
  }

  async start(port: number): Promise<void> {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(port, '127.0.0.1', () => {
          this.isRunning = true;
          this.startTime = new Date();
          // 缩短 keep-alive,避免空闲长连接长期占住 socket,便于 stop 时快速释放端口
          try { this.server.keepAliveTimeout = 5000; } catch { /* ignore */ }
          this.emit('started', { port });
          resolve();
        });

        this.server.on('error', (err: Error) => {
          this.isRunning = false;
          if ((err as any).code === 'EADDRINUSE') {
            const friendly = new Error(
              `端口 ${port} 已被占用:可能已有 DongCC 实例在运行(请检查系统托盘)或上次未完全退出。` +
              `请从托盘退出已有实例后重试,或重启电脑。`
            );
            (friendly as any).code = 'EADDRINUSE';
            this.emit('error', friendly);
            reject(friendly);
            return;
          }
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
          this.server = null;
          this.emit('stopped');
          resolve();
        }
      });
      // 强制断开已建立的长连接(SSE/流式/keep-alive),否则 close 会等它们自然结束,
      // 导致端口迟迟不释放、紧接着的 start 撞 EADDRINUSE。Node ≥18.2 支持。
      try { (this.server as any).closeAllConnections?.(); } catch { /* ignore */ }
    });
  }

  // ── Claude Desktop 3P 代理 ──

  private async handleDesktopProxy(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    const desktop = this.desktopClient;

    if (!desktop || !desktop.apiKey || !desktop.baseUrl) {
      res.status(503).json({
        error: 'Claude Desktop Not Configured',
        message: '请在 DongCC 配置页 Claude Desktop Tab 完成配置',
      });
      return;
    }

    const requestBody = req.body || {};
    const routeModelId: string = requestBody.model || '';
    const isStreaming = requestBody.stream === true;

    // Claude Desktop 可能在 route ID 后追加快照日期或其他版本后缀。
    const route = routeModelId
      ? desktop.modelRoutes?.find(
          r => routeModelId === r.routeId || routeModelId.startsWith(`${r.routeId}-`)
        )
      : null;
    // 匹配到路由时使用配置的上游 modelId；未知的非空模型保持原样透传。
    const defaultRoute = desktop.modelRoutes?.[0];
    const upstreamModel = route?.modelId || (routeModelId || defaultRoute?.modelId || '');
    requestBody.model = upstreamModel;

    if (!requestBody.model) {
      console.warn(`[Desktop Proxy] model 为空，请求 body keys: ${Object.keys(requestBody).join(',')}`);
    }

    const isAnthropic = desktop.apiFormat === 'anthropic';
    if (
      isAnthropic &&
      ProxyServer.CLAUDE_DESKTOP_ADAPTIVE_THINKING_MODELS.has(upstreamModel.toLowerCase())
    ) {
      ProxyServer.optimizeThinking(requestBody);
    }
    const endpoint = isAnthropic ? '/messages' : '/chat/completions';
    const targetUrl = this.getTargetUrl(desktop.baseUrl.replace(/\/$/, ''), endpoint);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${desktop.apiKey}`,
    };
    if (isAnthropic) {
      headers['anthropic-version'] = '2023-06-01';
      headers['x-api-key'] = desktop.apiKey;
    }
    const traceId = req.headers['trace-id'] as string;
    if (traceId) headers['Trace-Id'] = traceId;
    const userInfo = getCachedUserInfo();
    if (userInfo?.erp) headers['x-llm-erp'] = userInfo.erp;

    ProxyServer.injectAppCodeHeader(headers, desktop.baseUrl);
    ProxyServer.injectUserAgent(headers, 'Claude Desktop');
    ProxyServer.injectRequestId(headers, req);

    console.log(`[Desktop Proxy] ${routeModelId} → ${upstreamModel}, format=${desktop.apiFormat}, stream=${isStreaming}, target=${targetUrl}`);

    // 非 anthropic 格式（chat-completions）：Claude Desktop 发的是 Anthropic body / 只认 Anthropic SSE，
    // 必须做请求/响应双向格式转换，否则客户端收到看不懂的 OpenAI 流会判失败并整条重发（请求被放大成 10+ 次）。
    if (!isAnthropic) {
      await this.handleDesktopChatCompletions(
        req, res, requestBody, routeModelId, upstreamModel, isStreaming, headers, startTime
      );
      return;
    }

    try {
      const upstream = await nodeHttpFetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      }, this.cookieInjection);

      if (!upstream.ok) {
        const errorBody = await upstream.text();
        logger.error(`[Desktop Proxy] 上游返回 ${upstream.status}`, { response: errorBody.substring(0, 1000) });
        const dkDiag = ProxyServer.buildModelDiagnostics({
          errorBody,
          statusCode: upstream.status,
          rawModel: routeModelId,
          resolvedModel: upstreamModel,
          availableModels: desktop.modelRoutes?.map(r => ({ id: r.routeId, name: r.label, modelId: r.modelId })),
          client: 'claude-desktop',
        });
        if (dkDiag) logger.error('[Model Diagnostics] ' + dkDiag.diagnostic, dkDiag.logMeta);
        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: upstream.status,
          duration: Date.now() - startTime, model: upstreamModel,
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
          isStreaming, client: 'claude-desktop',
          error: dkDiag ? dkDiag.diagnostic : `上游返回 ${upstream.status}: ${errorBody.substring(0, 500)}`,
        });
        res.status(upstream.status).json({ error: 'Upstream Error', message: errorBody });
        return;
      }

      if (isStreaming) {
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = upstream.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0;
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // 替换响应中的 model 字段回 route ID（上游可能返回任何模型名）
            const replaced = chunk.replace(/"model"\s*:\s*"[^"]*"/g, `"model":"${routeModelId}"`);
            res.write(replaced);

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.substring(6).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const evt = JSON.parse(data);
                const u = evt.usage || evt.message?.usage;
                if (u) {
                  inputTokens = u.input_tokens ?? u.prompt_tokens ?? inputTokens;
                  outputTokens = u.output_tokens ?? u.completion_tokens ?? outputTokens;
                  cacheReadTokens = u.cache_read_input_tokens ?? cacheReadTokens;
                  cacheCreationTokens = u.cache_creation_input_tokens ?? cacheCreationTokens;
                }
              } catch { /* ignore */ }
            }
          }
        } finally {
          reader.releaseLock();
          if (!res.writableEnded) res.end();
        }

        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: 200,
          duration: Date.now() - startTime, model: upstreamModel,
          inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
          isStreaming: true, client: 'claude-desktop',
        });
      } else {
        const respJson: any = await upstream.json();
        if (respJson.model) respJson.model = routeModelId;
        res.json(respJson);

        const u = respJson.usage || {};
        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: 200,
          duration: Date.now() - startTime, model: upstreamModel,
          inputTokens: u.input_tokens ?? u.prompt_tokens ?? 0,
          outputTokens: u.output_tokens ?? u.completion_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
          isStreaming: false, client: 'claude-desktop',
        });
      }
    } catch (error: any) {
      logger.error('[Desktop Proxy] failed', { error: error.message });
      this.logRequest(req, {
        method: 'POST', url: req.url, statusCode: 502,
        duration: Date.now() - startTime, model: upstreamModel,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        isStreaming, client: 'claude-desktop', error: error.message,
      });
      if (!res.headersSent) {
        res.status(502).json({ error: 'Desktop Proxy Error', message: error.message });
      }
    }
  }

  // Claude Desktop 走 chat-completions：复用主 chat 路径的转换链路
  // （convertClaudeToOpenAIRequest → handleStreamResponse / convertOpenAIToClaudeResponse），
  // 与 handleWithChatCompletionsApi 同构。修复点：之前只换 endpoint 不转格式，导致客户端重发放大。
  private async handleDesktopChatCompletions(
    req: Request,
    res: Response,
    requestBody: any,
    routeModelId: string,
    upstreamModel: string,
    isStreaming: boolean,
    headers: Record<string, string>,
    startTime: number
  ): Promise<void> {
    const desktop = this.desktopClient!;
    const targetUrl = this.getTargetUrl(desktop.baseUrl.replace(/\/$/, ''), '/chat/completions');

    // requestBody.model 已是 upstreamModel：上游收到 upstreamModel、reasoning 策略按上游模型算。
    const claudeRequest = requestBody as ClaudeMessagesRequest;
    const openaiRequest = this.convertClaudeToOpenAIRequest(claudeRequest);
    this.applyMediaSanitizer(openaiRequest);
    const openaiBody = JSON.stringify(openaiRequest);

    // 响应里 Claude Desktop 期望看到自己发来的 routeModelId（兜空回退 upstreamModel）。
    const responseModel = routeModelId || upstreamModel;

    // 有限退避重试：仅包裹建立连接的首个 fetch，绝不重试已开始下发的流。
    const ccMaxRetries = 4;
    let upstream!: NodeFetchResponse;
    let lastError: { status: number; body: string } | null = null;
    for (let attempt = 1; attempt <= ccMaxRetries; attempt++) {
      try {
        upstream = await nodeHttpFetch(targetUrl, {
          method: 'POST',
          headers,
          body: openaiBody,
        }, this.cookieInjection);
      } catch (e: any) {
        lastError = { status: 502, body: e.message || String(e) };
        if (attempt < ccMaxRetries) {
          await new Promise(resolve => setTimeout(resolve, ProxyServer.computeRetryDelayMs(attempt, null)));
          continue;
        }
        break;
      }

      if (upstream.ok) break;

      const errorBody = await upstream.text();
      lastError = { status: upstream.status, body: errorBody };
      if (attempt < ccMaxRetries && ProxyServer.isRetriableUpstreamStatus(upstream.status)) {
        const delayMs = ProxyServer.computeRetryDelayMs(attempt, upstream.headers.get('retry-after'));
        console.warn(`[Desktop Proxy] 上游 ${upstream.status}，第 ${attempt}/${ccMaxRetries} 次重试，${delayMs}ms 后重发: ${errorBody.substring(0, 200)}`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      break;
    }

    if (!upstream || !upstream.ok) {
      logger.error(`[Desktop Proxy] chat-completions 上游失败 ${lastError?.status}`, { response: lastError?.body.substring(0, 1000) });
      const dkcDiag = ProxyServer.buildModelDiagnostics({
        errorBody: lastError?.body || '',
        statusCode: lastError?.status ?? 502,
        rawModel: routeModelId,
        resolvedModel: upstreamModel,
        availableModels: this.config?.claudeDesktop?.modelRoutes?.map(r => ({ id: r.routeId, name: r.label, modelId: r.modelId })),
        client: 'claude-desktop',
      });
      if (dkcDiag) logger.error('[Model Diagnostics] ' + dkcDiag.diagnostic, dkcDiag.logMeta);
      this.logRequest(req, {
        method: 'POST', url: req.url, statusCode: lastError?.status ?? 502,
        duration: Date.now() - startTime, model: upstreamModel,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        isStreaming, client: 'claude-desktop',
        error: dkcDiag ? dkcDiag.diagnostic : `上游 ${lastError?.status}: ${(lastError?.body || '').substring(0, 500)}`,
      });
      if (!res.headersSent) {
        res.status(lastError?.status ?? 502).json({ error: 'Upstream Error', message: lastError?.body });
      }
      return;
    }

    try {
      if (isStreaming) {
        // 复用主路径：内部把 OpenAI SSE 转成 Anthropic SSE、解析 usage、自建 text/event-stream 头并 emit。
        await this.handleStreamResponse(upstream, res, responseModel, claudeRequest, startTime, req);
      } else {
        const openaiResponse: any = await upstream.json();
        const claudeResponse = this.convertOpenAIToClaudeResponse(openaiResponse, responseModel);
        res.json(claudeResponse);

        let inputTokens = claudeResponse.usage?.input_tokens || 0;
        const outputTokens = claudeResponse.usage?.output_tokens || 0;
        const cacheReadTokens = claudeResponse.usage?.cache_read_input_tokens || 0;
        const cacheCreationTokens = claudeResponse.usage?.cache_creation_input_tokens || 0;
        inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);

        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: 200,
          duration: Date.now() - startTime, model: upstreamModel,
          inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
          isStreaming: false, client: 'claude-desktop',
        });
      }
    } catch (error: any) {
      logger.error('[Desktop Proxy] chat-completions failed', { error: error.message });
      this.logRequest(req, {
        method: 'POST', url: req.url, statusCode: 502,
        duration: Date.now() - startTime, model: upstreamModel,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        isStreaming, client: 'claude-desktop', error: error.message,
      });
      if (!res.headersSent) {
        res.status(502).json({ error: 'Desktop Proxy Error', message: error.message });
      }
    }
  }

  getStatus(): { running: boolean; uptime: number; config: ProxyConfig | null } {
    return {
      running: this.isRunning,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      config: this.config,
    };
  }

  // ── Codex Responses ↔ Chat Completions 自动转换 ──

  private static readonly BILLING_HEADER_PREFIX = 'x-anthropic-billing-header:';
  private static readonly CUSTOM_TOOL_INPUT_FIELD = 'input';
  private static readonly CHAT_TOOL_NAME_MAX_LEN = 64;

  private static stripLeadingBillingHeader(text: string): string {
    if (!text.startsWith(ProxyServer.BILLING_HEADER_PREFIX)) return text;
    const idx = text.indexOf('\n');
    if (idx < 0) return '';
    return text.substring(idx + 1).replace(/^\r?\n/, '');
  }

  private static flattenNamespaceName(ns: string, name: string): string {
    const flat = `${ns}__${name}`;
    if (flat.length <= ProxyServer.CHAT_TOOL_NAME_MAX_LEN) return flat;
    const hash = require('crypto').createHash('sha256').update(flat).digest('hex').substring(0, 8);
    return flat.substring(0, ProxyServer.CHAT_TOOL_NAME_MAX_LEN - 9) + '_' + hash;
  }

  private static isOSeriesModel(model: string): boolean {
    return model.length > 1 && model.startsWith('o') && /\d/.test(model[1]);
  }

  private static supportsReasoningEffort(model: string): boolean {
    if (ProxyServer.isOSeriesModel(model)) return true;
    const lower = model.toLowerCase();
    const rest = lower.startsWith('gpt-') ? lower.substring(4) : null;
    return rest != null && /\d/.test(rest[0]) && rest[0] >= '5';
  }

  private static resolveReasoningEffort(body: any): string | null {
    const effort = body?.output_config?.effort;
    if (effort) {
      const map: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' };
      return map[effort] || null;
    }
    const thinking = body?.reasoning;
    if (!thinking) return null;
    if (thinking.effort) {
      const map: Record<string, string> = { low: 'low', medium: 'medium', high: 'high' };
      return map[thinking.effort] || 'high';
    }
    const budget = thinking.budget_tokens;
    if (typeof budget === 'number') {
      if (budget < 4000) return 'low';
      if (budget < 16000) return 'medium';
      return 'high';
    }
    return null;
  }

  // ── Thinking 签名纠错器 ──

  // ── Model 错误诊断器 ──
  // 上游因 model 字段缺失/未映射/不存在而拒绝时（典型：4010 "Required parameter 'model' is missing"），
  // 生成结构化诊断：传入 model、可用模型、原因、修复建议。
  // 诊断文本写入 emit('request').error → 落库 errorMessage → Dashboard 错误列直接可见。
  // 非 model 类错误返回 null，调用方走原有逻辑，行为零变化。
  static buildModelDiagnostics(params: {
    errorBody: string;
    statusCode: number;
    rawModel?: string;
    resolvedModel?: string;
    availableModels?: Array<{ id?: string; name?: string; modelId: string }>;
    defaultModel?: string;
    client?: string;
  }): { isModelError: boolean; diagnostic: string; logMeta: Record<string, any> } | null {
    const { errorBody, statusCode, rawModel, resolvedModel, availableModels, defaultModel, client } = params;
    if (!errorBody) return null;

    const isModelError =
      statusCode === 400 &&
      (/code["']?\s*:?\s*4010/i.test(errorBody) ||
        /required parameter ['"]?model/i.test(errorBody) ||
        /\bmodel\b.*(is missing|not found|invalid|required|unavailable|does not exist)/i.test(errorBody));
    if (!isModelError) return null;

    // 提取上游原始 message 作为首行
    let upstreamMsg = errorBody.slice(0, 300);
    const msgMatch = errorBody.match(/"message"\s*:\s*"([^"]+)"/);
    if (msgMatch) upstreamMsg = msgMatch[1];

    const raw = rawModel ?? '';
    const resolved = resolvedModel ?? '';
    const models = availableModels ?? [];
    const modelList = models.length
      ? models.map(m => `${m.modelId}${m.id ? `(id:${m.id})` : ''}`).join(', ')
      : '(未配置任何模型)';
    const rawInList = !!raw && models.some(m => m.modelId === raw || m.id === raw || m.name === raw);

    // 场景分类：(a) 传入为空 (b) 传入非空但映射未命中 (c) 上游 model not found
    let reason: string;
    let suggestion: string;
    if (!raw) {
      reason = '客户端请求未携带 model 字段' + (defaultModel ? `（已配默认模型 ${defaultModel}，但未生效到本路径）` : '，且配置未设置默认模型');
      suggestion = defaultModel
        ? '检查该客户端（' + (client || '未知') + '）的转发路径是否应用了默认模型，或在客户端侧显式指定 model'
        : '打开 DongCC 配置页设置「默认模型」，或在客户端侧显式指定 model';
    } else if (!rawInList && models.length > 0) {
      reason = `传入 model "${raw}" 不在已配置的模型列表中，映射未命中`;
      suggestion = `在 DongCC 配置页将 "${raw}" 加入模型列表（或修正其 id/name），可用模型见上`;
    } else {
      reason = `上游拒绝了 model "${resolved || raw}"，通常是配置的 modelId 与上游真实模型名不一致`;
      suggestion = '核对 DongCC 配置页中该模型的 modelId 是否与上游服务提供的模型名完全一致';
    }

    const diagnostic = [
      `[Model 错误] 上游拒绝: ${upstreamMsg}`,
      `· 客户端: ${client || '未知'}`,
      `· 传入 model: ${raw ? `"${raw}"` : '"" (空)'}`,
      `· 映射后 model: ${resolved ? `"${resolved}"` : '(未映射)'}`,
      `· 可用模型: ${modelList}`,
      `· 原因: ${reason}`,
      `· 建议: ${suggestion}`,
    ].join('\n');

    const logMeta = {
      client: client || 'unknown',
      rawModel: raw,
      resolvedModel: resolved,
      availableModelIds: models.map(m => m.modelId),
      defaultModel: defaultModel || null,
      statusCode,
      upstreamError: errorBody.slice(0, 1000),
    };

    return { isModelError: true, diagnostic, logMeta };
  }

  // ── Codex 错误响应改写 ──
  // Codex CLI 期望 OpenAI Responses 风格的错误体 { error: { message, type, code, param } }。
  // 上游服务的错误形态各异（JSON error.message、message、base_resp.status_msg，或纯文本），
  // 统一抽取出可读 message 后包装成 Responses 风格，避免 Codex CLI 解析失败、把错误当成"未知响应"反复重发。
  static buildCodexErrorResponse(errorBody: string, statusCode: number): { error: { message: string; type: string; code: string | null; param: string | null } } {
    let message = (errorBody || '').trim();
    let code: string | null = null;

    try {
      const parsed = JSON.parse(errorBody);
      // 常见形态：{error:{message,code}} / {error:"..."} / {message:"..."} / MiniMax {base_resp:{status_msg}}
      if (parsed?.error?.message) {
        message = String(parsed.error.message);
        if (parsed.error.code != null) code = String(parsed.error.code);
      } else if (typeof parsed?.error === 'string') {
        message = parsed.error;
      } else if (parsed?.message) {
        message = String(parsed.message);
        if (parsed.code != null) code = String(parsed.code);
      } else if (parsed?.base_resp?.status_msg) {
        message = String(parsed.base_resp.status_msg);
        if (parsed.base_resp.status_code != null) code = String(parsed.base_resp.status_code);
      }
    } catch {
      // 非 JSON：保留原始文本作为 message
    }

    if (!message) message = `上游返回 ${statusCode}`;

    // type 按状态码归类，贴近 OpenAI 错误语义
    let type = 'upstream_error';
    if (statusCode === 429) type = 'rate_limit_error';
    else if (statusCode >= 500) type = 'server_error';
    else if (statusCode === 401 || statusCode === 403) type = 'authentication_error';
    else if (statusCode >= 400) type = 'invalid_request_error';

    return { error: { message, type, code, param: null } };
  }

  private static shouldRectifyThinkingSignature(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    const lower = errorMessage.toLowerCase();
    return (
      (lower.includes('invalid') && lower.includes('signature') && lower.includes('thinking')) ||
      (lower.includes('thought signature') && (lower.includes('not valid') || lower.includes('invalid'))) ||
      lower.includes('must start with a thinking block') ||
      (lower.includes('expected') && (lower.includes('thinking') || lower.includes('redacted_thinking')) && lower.includes('found') && lower.includes('tool_use')) ||
      (lower.includes('signature') && lower.includes('field required')) ||
      (lower.includes('signature') && lower.includes('extra inputs are not permitted')) ||
      ((lower.includes('thinking') || lower.includes('redacted_thinking')) && lower.includes('cannot be modified'))
    );
  }

  private static rectifyAnthropicRequest(body: any): { applied: boolean; removedCount: number } {
    let applied = false;
    let removedCount = 0;

    if (!body.messages || !Array.isArray(body.messages)) return { applied, removedCount };

    for (const msg of body.messages) {
      if (!Array.isArray(msg.content)) continue;
      const original = msg.content.length;
      msg.content = msg.content.filter((block: any) => {
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
          removedCount++;
          return false;
        }
        if (block.signature) {
          delete block.signature;
          removedCount++;
        }
        return true;
      });
      if (msg.content.length !== original) applied = true;
    }

    // 兜底：如果最后一条 assistant 没有 thinking 前缀但有 tool_use，删除顶层 thinking
    if (body.thinking?.type === 'enabled') {
      const lastAssistant = [...(body.messages || [])].reverse().find((m: any) => m.role === 'assistant');
      if (lastAssistant && Array.isArray(lastAssistant.content)) {
        const firstType = lastAssistant.content[0]?.type;
        const hasToolUse = lastAssistant.content.some((b: any) => b.type === 'tool_use');
        if (firstType !== 'thinking' && firstType !== 'redacted_thinking' && hasToolUse) {
          delete body.thinking;
          applied = true;
        }
      }
    }

    return { applied, removedCount };
  }

  // ── Thinking 优化器 ──

  /** Claude Desktop 对下列模型启用 adaptive thinking。 */
  private static readonly CLAUDE_DESKTOP_ADAPTIVE_THINKING_MODELS = new Set([
    'claude-opus-4.8',
    'claude-opus-4.7',
    'claude-opus-4.6',
    'claude-sonnet-4.6',
    'claude-sonnet-5',
  ]);

  private static usesAdaptiveThinking(model: string): boolean {
    const normalized = model.replace(/\./g, '-').toLowerCase();
    return ['opus-4-8', 'opus-4-7', 'opus-4-6', 'sonnet-4-6', 'sonnet-5'].some(n => normalized.includes(n));
  }

  private static optimizeThinking(body: any): void {
    const model = (body.model || '').toLowerCase();
    if (!model) return;

    if (model.includes('haiku')) return;

    if (ProxyServer.usesAdaptiveThinking(model)) {
      body.thinking = { type: 'adaptive' };
      body.output_config = { effort: 'max' };
      return;
    }

    // legacy 模型
    const maxTokens = body.max_tokens || 16384;
    const budgetTarget = maxTokens - 1;
    const thinkingType = body.thinking?.type;

    if (!thinkingType || thinkingType === 'disabled') {
      body.thinking = { type: 'enabled', budget_tokens: budgetTarget };
    } else if (thinkingType === 'enabled') {
      const current = body.thinking.budget_tokens || 0;
      if (current < budgetTarget) {
        body.thinking.budget_tokens = budgetTarget;
      }
    }
  }

  // ── Media Sanitizer ──

  private static readonly TEXT_ONLY_PATTERNS = [
    'deepseek', 'qwen', 'glm', 'minimax', 'doubao', 'kimi', 'yi-',
    'baichuan', 'internlm', 'chatglm', 'spark', 'ernie',
  ];

  private static isTextOnlyModel(model: string): boolean {
    const lower = model.toLowerCase();
    return ProxyServer.TEXT_ONLY_PATTERNS.some(p => lower.includes(p));
  }

  private static sanitizeMediaInRequest(body: any): number {
    const model = body.model || '';
    if (!ProxyServer.isTextOnlyModel(model)) return 0;

    let replaced = 0;

    // Anthropic 格式 messages
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        for (let i = 0; i < msg.content.length; i++) {
          const block = msg.content[i];
          if (block.type === 'image' || block.type === 'image_url' ||
              (block.source && (block.source.type === 'base64' || block.source.type === 'url'))) {
            msg.content[i] = { type: 'text', text: '[Unsupported Image]' };
            replaced++;
          }
        }
      }
    }

    // Chat Completions 格式 messages
    if (Array.isArray(body.messages)) {
      for (const msg of body.messages) {
        if (!Array.isArray(msg.content)) continue;
        for (let i = 0; i < msg.content.length; i++) {
          const block = msg.content[i];
          if (block.type === 'image_url') {
            msg.content[i] = { type: 'text', text: '[Unsupported Image]' };
            replaced++;
          }
        }
      }
    }

    // Responses 格式 input
    if (Array.isArray(body.input)) {
      for (const item of body.input) {
        if (item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (let i = 0; i < item.content.length; i++) {
          const block = item.content[i];
          if (block.type === 'image' || block.type === 'image_url' || block.type === 'input_image') {
            item.content[i] = { type: 'text', text: '[Unsupported Image]' };
            replaced++;
          }
        }
      }
    }

    if (replaced > 0) {
      console.log(`[Media Sanitizer] Replaced ${replaced} image blocks for text-only model: ${model}`);
    }
    return replaced;
  }

  // 递归收集 Responses 请求 input 中 tool_search 动态加载的工具。
  // Codex 的浏览器工具等并不在初始 tools 里，而是客户端执行 tool_search 后，
  // 在后续请求的 input 里以 tool_search_output 节点的 tools[] 回传。
  // 不收集这些工具，上游就不知道它们存在，工具便无法被调用（chat 格式下浏览器工具启动失败的根因）。
  private static collectToolSearchOutputTools(value: any, acc: any[]): void {
    if (Array.isArray(value)) {
      for (const item of value) ProxyServer.collectToolSearchOutputTools(item, acc);
      return;
    }
    if (value && typeof value === 'object') {
      if (
        (value.type === 'tool_search_output' || value.type === 'tool_search_call_output') &&
        Array.isArray(value.tools)
      ) {
        for (const tool of value.tools) acc.push(tool);
      }
      for (const key of Object.keys(value)) {
        ProxyServer.collectToolSearchOutputTools(value[key], acc);
      }
    }
  }

  private convertResponsesToChatRequest(body: any): any {
    const messages: any[] = [];
    const toolNameMap = new Map<string, { kind: string; originalName: string; namespace?: string }>();
    const seenNames = new Set<string>();
    // 记录被丢弃的历史 tool_call id（namespace 子工具 / tool_search_call），
    // 用于把它们对应的 function_call_output / tool_search_call_output 也一并丢弃，
    // 避免上游收到 orphan tool 消息或未知工具名。
    const droppedCallIds = new Set<string>();
    // 顶层 namespace 子工具集合（历史 function_call.name 命中即丢弃）
    const namespaceSubNames = new Set<string>();
    if (Array.isArray(body.tools)) {
      for (const t of body.tools) {
        if (t?.type === 'namespace' && Array.isArray(t.tools)) {
          for (const sub of t.tools) if (sub?.name) namespaceSubNames.add(sub.name);
        }
      }
    }

    if (body.instructions) {
      const cleaned = ProxyServer.stripLeadingBillingHeader(body.instructions);
      if (cleaned) messages.push({ role: 'system', content: cleaned });
    }

    if (Array.isArray(body.input)) {
      let pendingToolCalls: any[] = [];
      let pendingReasoning: string | null = null;

      for (const item of body.input) {
        if (item.type === 'message') {
          if (pendingToolCalls.length > 0) {
            const assistantMsg: any = { role: 'assistant', tool_calls: pendingToolCalls };
            if (pendingReasoning) { assistantMsg.reasoning_content = pendingReasoning; pendingReasoning = null; }
            messages.push(assistantMsg);
            pendingToolCalls = [];
          }
          const content = Array.isArray(item.content)
            ? item.content.map((b: any) => b.text || '').join('')
            : (item.content || '');
          const role = item.role === 'developer' ? 'system' : (item.role || 'user');
          messages.push({ role, content });
        } else if (item.type === 'function_call') {
          // 命中 namespace 子工具则跳过（这些工具已从 tools 里剥离，上游不识别）
          if (item.namespace || namespaceSubNames.has(item.name)) {
            if (item.call_id) droppedCallIds.add(item.call_id);
            continue;
          }
          pendingToolCalls.push({
            id: item.call_id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: item.name,
              arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
            },
          });
        } else if (item.type === 'custom_tool_call') {
          const chatName = item.name || `custom_${Date.now()}`;
          pendingToolCalls.push({
            id: item.call_id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'function',
            function: {
              name: chatName,
              arguments: JSON.stringify({ [ProxyServer.CUSTOM_TOOL_INPUT_FIELD]: item.input || '' }),
            },
          });
        } else if (item.type === 'tool_search_call') {
          // 客户端本地行为，不转发；其 output 也一并跳过
          if (item.call_id) droppedCallIds.add(item.call_id);
          continue;
        } else if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output' || item.type === 'tool_search_call_output') {
          // 对应的 tool_call 已被丢弃时，输出也一并跳过，避免上游 tool 消息孤儿
          if (item.call_id && droppedCallIds.has(item.call_id)) {
            continue;
          }
          if (pendingToolCalls.length > 0) {
            const assistantMsg: any = { role: 'assistant', tool_calls: pendingToolCalls };
            if (pendingReasoning) { assistantMsg.reasoning_content = pendingReasoning; pendingReasoning = null; }
            messages.push(assistantMsg);
            pendingToolCalls = [];
          }
          const output = item.output ?? item.results ?? '';
          messages.push({
            role: 'tool',
            tool_call_id: item.call_id,
            content: typeof output === 'string' ? output : JSON.stringify(output),
          });
        } else if (item.type === 'reasoning') {
          const text = typeof item.content === 'string'
            ? item.content
            : Array.isArray(item.content)
              ? item.content.filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('')
              : '';
          if (text) pendingReasoning = (pendingReasoning || '') + text;
        }
      }

      if (pendingToolCalls.length > 0) {
        const assistantMsg: any = { role: 'assistant', tool_calls: pendingToolCalls };
        if (pendingReasoning) { assistantMsg.reasoning_content = pendingReasoning; pendingReasoning = null; }
        messages.push(assistantMsg);
      }
    }

    // 折叠 system messages 到头部（MiniMax 兼容）
    const systemParts: string[] = [];
    const nonSystemMessages: any[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemParts.push(msg.content || '');
      } else {
        nonSystemMessages.push(msg);
      }
    }
    const finalMessages = systemParts.length > 0
      ? [{ role: 'system', content: systemParts.join('\n\n') }, ...nonSystemMessages]
      : nonSystemMessages;

    const chatReq: any = {
      model: body.model,
      messages: finalMessages,
      stream: body.stream ?? false,
    };

    const caps = this.modelCaps(body.model || '');
    if (body.max_output_tokens != null) {
      if (caps.tokenParam === 'max_completion_tokens') {
        chatReq.max_completion_tokens = body.max_output_tokens;
      } else {
        chatReq.max_tokens = body.max_output_tokens;
      }
    }
    if (body.temperature != null) chatReq.temperature = body.temperature;
    if (body.top_p != null) chatReq.top_p = body.top_p;

    if (body.stream) {
      chatReq.stream_options = { include_usage: true };
    }

    // reasoning effort 映射
    const effort = ProxyServer.resolveReasoningEffort(body);
    if (effort && caps.reasoningEffort) {
      chatReq.reasoning_effort = effort;
    }

    // 工具转换：只保留顶层核心工具（function / custom），
    // 不再展开 namespace 子工具，也不合并 tool_search_output 里的动态工具。
    // namespace 名仅记录在 toolNameMap，用于响应侧回填 function_call.namespace。
    const allTools = Array.isArray(body.tools) ? body.tools : [];
    if (allTools.length > 0) {
      const chatTools: any[] = [];
      for (const tool of allTools) {
        if (tool.type === 'function') {
          const name = tool.name;
          if (!name || seenNames.has(name)) continue;
          seenNames.add(name);
          toolNameMap.set(name, { kind: 'function', originalName: tool.name });
          chatTools.push({
            type: 'function',
            function: {
              name,
              description: tool.description || '',
              parameters: tool.parameters || tool.input_schema || { type: 'object', properties: {} },
            },
          });
        } else if (tool.type === 'namespace' && Array.isArray(tool.tools)) {
          // 仅记录 sub→namespace 映射（供响应侧还原），不展开到 chatTools
          for (const sub of tool.tools) {
            if (sub?.name && !toolNameMap.has(sub.name)) {
              toolNameMap.set(sub.name, { kind: 'namespace', originalName: sub.name, namespace: tool.name });
            }
          }
        } else if (tool.type === 'custom') {
          const name = tool.name || `custom_${chatTools.length}`;
          if (seenNames.has(name)) continue;
          seenNames.add(name);
          toolNameMap.set(name, { kind: 'custom', originalName: name });
          chatTools.push({
            type: 'function',
            function: {
              name,
              description: `${tool.description || ''}\n\nOriginal tool definition:\n${JSON.stringify(tool.schema || {})}`.trim(),
              parameters: {
                type: 'object',
                properties: { [ProxyServer.CUSTOM_TOOL_INPUT_FIELD]: { type: 'string', description: 'Raw string input for the original custom tool.' } },
                required: [ProxyServer.CUSTOM_TOOL_INPUT_FIELD],
              },
            },
          });
        } else if (tool.type === 'tool_search') {
          // 上游不支持 tool_search 协议，剥离；不注册为 chat 工具
          continue;
        }
      }
      if (chatTools.length > 0) chatReq.tools = chatTools;
    }

    // 存储工具映射供响应反转使用
    (chatReq as any)._toolNameMap = toolNameMap;

    return chatReq;
  }

  private convertChatToResponsesResponse(chatResp: any, requestModel: string, toolNameMap?: Map<string, any>): any {
    const output: any[] = [];

    const choice = chatResp.choices?.[0];
    if (choice?.message) {
      const msg = choice.message;

      // reasoning_content → reasoning item
      const reasoning = msg.reasoning_content || msg.reasoning;
      if (reasoning) {
        const text = typeof reasoning === 'string' ? reasoning : (reasoning.content || '');
        if (text) {
          output.push({
            type: 'reasoning',
            id: `rs_${Date.now()}`,
            content: [{ type: 'text', text }],
          });
        }
      }

      // <think>...</think> 块提取
      if (msg.content && typeof msg.content === 'string' && msg.content.startsWith('<think>')) {
        const thinkEnd = msg.content.indexOf('</think>');
        if (thinkEnd > 0) {
          const thinkText = msg.content.substring(7, thinkEnd).trim();
          if (thinkText) {
            output.push({
              type: 'reasoning',
              id: `rs_${Date.now()}`,
              content: [{ type: 'text', text: thinkText }],
            });
          }
          msg.content = msg.content.substring(thinkEnd + 8).trim();
        }
      }

      if (msg.content) {
        output.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: msg.content }],
        });
      }

      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          const chatName = tc.function?.name || '';
          const spec = toolNameMap?.get(chatName);

          if (spec?.kind === 'custom') {
            let rawInput = tc.function?.arguments || '{}';
            try {
              const parsed = JSON.parse(rawInput);
              rawInput = parsed[ProxyServer.CUSTOM_TOOL_INPUT_FIELD] || rawInput;
            } catch { /* keep raw */ }
            output.push({
              type: 'custom_tool_call',
              call_id: tc.id,
              name: spec.originalName,
              input: rawInput,
            });
          } else if (spec?.kind === 'tool_search') {
            let args: any = {};
            try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { /* */ }
            output.push({
              type: 'tool_search_call',
              call_id: tc.id,
              status: 'completed',
              execution: 'client',
              arguments: args,
            });
          } else {
            const name = spec?.originalName || chatName;
            const item: any = {
              type: 'function_call',
              call_id: tc.id,
              name,
              arguments: tc.function?.arguments || '{}',
            };
            if (spec?.namespace) item.namespace = spec.namespace;
            output.push(item);
          }
        }
      }
    }

    const usage = chatResp.usage || {};
    const finishReason = chatResp.choices?.[0]?.finish_reason;
    return {
      id: chatResp.id ? `resp_${chatResp.id}` : `resp_${Date.now()}`,
      object: 'response',
      model: chatResp.model || requestModel,
      status: finishReason === 'length' ? 'incomplete' : 'completed',
      output,
      usage: {
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        total_tokens: (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
      },
    };
  }

  private convertChatStreamChunkToResponsesEvents(data: string, toolNameMap?: Map<string, any>): string[] {
    if (!data || data === '[DONE]') return [];

    let chunk: any;
    try { chunk = JSON.parse(data); } catch { return []; }

    const events: string[] = [];
    const delta = chunk.choices?.[0]?.delta;

    if (delta) {
      // reasoning_content 增量
      const reasoning = delta.reasoning_content || delta.reasoning;
      if (reasoning) {
        events.push(JSON.stringify({
          type: 'response.reasoning.delta',
          delta: typeof reasoning === 'string' ? reasoning : (reasoning.content || ''),
        }));
      }

      if (delta.content) {
        // <think> 块检测（流式中首个 chunk）
        if (delta.content.startsWith('<think>')) {
          events.push(JSON.stringify({
            type: 'response.reasoning.delta',
            delta: delta.content.replace('<think>', ''),
          }));
        } else if (delta.content.includes('</think>')) {
          const parts = delta.content.split('</think>');
          if (parts[0]) {
            events.push(JSON.stringify({ type: 'response.reasoning.delta', delta: parts[0] }));
          }
          if (parts[1]) {
            events.push(JSON.stringify({ type: 'response.output_text.delta', delta: parts[1] }));
          }
        } else {
          events.push(JSON.stringify({ type: 'response.output_text.delta', delta: delta.content }));
        }
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            const chatName = tc.function.name;
            const spec = toolNameMap?.get(chatName);
            const resolvedName = spec?.originalName || chatName;
            const event: any = {
              type: 'response.function_call_arguments.delta',
              call_id: tc.id || '',
              name: resolvedName,
              delta: tc.function.arguments || '',
            };
            if (spec?.namespace) event.namespace = spec.namespace;
            events.push(JSON.stringify(event));
          } else if (tc.function?.arguments) {
            events.push(JSON.stringify({
              type: 'response.function_call_arguments.delta',
              delta: tc.function.arguments,
            }));
          }
        }
      }
    }

    const finishReason = chunk.choices?.[0]?.finish_reason;
    if (finishReason) {
      events.push(JSON.stringify({ type: 'response.output_text.done' }));
    }

    if (chunk.usage) {
      events.push(JSON.stringify({
        type: 'response.completed',
        response: {
          id: chunk.id ? `resp_${chunk.id}` : `resp_${Date.now()}`,
          object: 'response',
          model: chunk.model || '',
          status: 'completed',
          output: [],
          usage: {
            input_tokens: chunk.usage.prompt_tokens ?? 0,
            output_tokens: chunk.usage.completion_tokens ?? 0,
            total_tokens: (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0),
          },
        },
      }));
    }

    return events;
  }

  private async handleCodexResponsesToChatConversion(
    req: Request,
    res: Response,
    startTime: number,
  ): Promise<void> {
    const codex = this.codexClient!;
    const requestBody = req.body || {};
    const isStreaming = requestBody.stream === true;

    // 模型解析（与 handleCodexPassthrough 一致：dongcc 默认模型覆盖会话锁定模型）
    const { rawModel: requestModel, resolvedModel } = this.resolveCodexModel(codex, requestBody);
    const loggedModel = resolvedModel || requestModel;

    const chatBody = this.convertResponsesToChatRequest(requestBody);
    const toolNameMap = (chatBody as any)._toolNameMap as Map<string, any> | undefined;
    delete (chatBody as any)._toolNameMap;
    this.applyMediaSanitizer(chatBody);
    ProxyServer.logCodexPayloadSize('Codex R→C (responses in)', requestBody);
    ProxyServer.logCodexPayloadSize('Codex R→C (chat out)', chatBody);
    const targetUrl = this.getTargetUrl(codex.baseUrl.replace(/\/$/, ''), '/chat/completions');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${codex.apiKey}`,
    };
    const traceId = req.headers['trace-id'] as string;
    if (traceId) headers['Trace-Id'] = traceId;
    const userInfo = getCachedUserInfo();
    if (userInfo?.erp) headers['x-llm-erp'] = userInfo.erp;

    ProxyServer.injectAppCodeHeader(headers, codex.baseUrl);
    ProxyServer.injectUserAgent(headers, 'Codex');
    ProxyServer.injectRequestId(headers, req);

    console.log(`[Codex R→C] responses→chat/completions, model=${requestModel}, stream=${isStreaming}, target=${targetUrl}`);

    const rcMaxRetries = 4;

    try {
      let upstream!: NodeFetchResponse;
      for (let attempt = 1; attempt <= rcMaxRetries; attempt++) {
        upstream = await nodeHttpFetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(chatBody),
        }, this.cookieInjection);

        if (upstream.ok) break;

        const errorBody = await upstream.text();

        // 上游瞬时故障(5xx)/限流(429)退避重试，与 anthropic 路径一致
        if (attempt < rcMaxRetries && ProxyServer.isRetriableUpstreamStatus(upstream.status)) {
          const delayMs = ProxyServer.computeRetryDelayMs(attempt, upstream.headers.get('retry-after'));
          console.warn(`[Codex R→C] 上游 ${upstream.status}，第 ${attempt}/${rcMaxRetries} 次重试，${delayMs}ms 后重发: ${errorBody.substring(0, 200)}`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }

        // 上游明确要求改用 /v1/responses（典型：gpt-5.5 在 /chat/completions 上不支持 函数工具+reasoning_effort）
        // → 回退为 responses 直通，保留 reasoning 与工具，符合网关指引；forcePassthrough 防止再退回本路径
        if (
          upstream.status === 400 &&
          /\/v1\/responses/i.test(errorBody) &&
          /(instead|not supported|unsupported|chat\/completions|不支持)/i.test(errorBody)
        ) {
          logger.info(`[Codex R→C] 上游要求改用 /v1/responses（model=${(chatBody as any).model}），回退为 responses 直通`);
          // 自学习:记住该模型需走 responses，下次直连、跳过这次注定失败的 chat 尝试(消除交替与 chat 全失败)
          const learnedModel = ((chatBody as any).model || requestBody.model || '').toLowerCase();
          if (learnedModel && !this.codexResponsesOnlyModels.has(learnedModel)) {
            this.codexResponsesOnlyModels.add(learnedModel);
            logger.info(`[Codex R→C] 已记住「${learnedModel}」需走 responses，后续请求将直连、不再尝试 chat`);
          }
          return this.handleCodexPassthrough(req, res, 'responses', true);
        }

        logger.error(`[Codex R→C] 上游返回 ${upstream.status}`, { response: errorBody.substring(0, 1000) });
        const rcDiag = ProxyServer.buildModelDiagnostics({
          errorBody,
          statusCode: upstream.status,
          rawModel: requestModel,
          resolvedModel: (chatBody as any).model || requestBody.model,
          availableModels: codex.models,
          defaultModel: codex.defaultModel,
          client: 'codex',
        });
        if (rcDiag) logger.error('[Model Diagnostics] ' + rcDiag.diagnostic, rcDiag.logMeta);
        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: upstream.status,
          duration: Date.now() - startTime, model: loggedModel,
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
          isStreaming, client: 'codex',
          error: rcDiag ? rcDiag.diagnostic : `上游返回 ${upstream.status}: ${errorBody.substring(0, 500)}`,
        });
        res.status(upstream.status).json(ProxyServer.buildCodexErrorResponse(errorBody, upstream.status));
        return;
      }

      if (isStreaming) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const reader = upstream.body?.getReader();
        if (!reader) throw new Error('无法获取响应流');
        const decoder = new TextDecoder();
        let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, cacheCreationTokens = 0;
        let buffer = '';

        const respId = `resp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const itemId = `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        let seq = 0;
        let headersSent = false;
        let fullText = '';
        let inThink = false;
        let reasoningText = '';
        // track tool calls across deltas: index → { id, name, arguments, outputIndex, itemId, announced }
        const tcMap = new Map<number, { id: string; name: string; namespace?: string; args: string; outputIndex: number; tcItemId: string; announced: boolean }>();
        let tcOutputBase = 1; // output_index 0 is for the message item

        const writeEvent = (eventType: string, payload: any) => {
          res.write(`event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`);
        };

        const sendHeaders = () => {
          if (headersSent) return;
          headersSent = true;
          writeEvent('response.created', {
            type: 'response.created',
            response: { id: respId, object: 'response', status: 'in_progress', model: requestBody.model, output: [] },
            sequence_number: seq++,
          });
          writeEvent('response.in_progress', {
            type: 'response.in_progress',
            response: { id: respId, object: 'response', status: 'in_progress', model: requestBody.model, output: [] },
            sequence_number: seq++,
          });
          writeEvent('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: 0,
            item: { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
            sequence_number: seq++,
          });
          writeEvent('response.content_part.added', {
            type: 'response.content_part.added',
            item_id: itemId,
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
            sequence_number: seq++,
          });
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.substring(6).trim();
              if (!data || data === '[DONE]') continue;

              let chatChunk: any;
              try { chatChunk = JSON.parse(data); } catch { continue; }

              if (chatChunk.usage) {
                inputTokens = chatChunk.usage.prompt_tokens ?? inputTokens;
                outputTokens = chatChunk.usage.completion_tokens ?? outputTokens;
                cacheReadTokens = chatChunk.usage.prompt_tokens_details?.cached_tokens ?? chatChunk.usage.input_tokens_details?.cached_tokens ?? cacheReadTokens;
                cacheCreationTokens = chatChunk.usage.cache_creation_input_tokens ?? cacheCreationTokens;
              }

              const delta = chatChunk.choices?.[0]?.delta;
              if (delta) {
                sendHeaders();

                // reasoning_content 字段
                const reasoning = delta.reasoning_content || delta.reasoning;
                if (reasoning) {
                  const text = typeof reasoning === 'string' ? reasoning : (reasoning.content || '');
                  reasoningText += text;
                  writeEvent('response.reasoning.delta', {
                    type: 'response.reasoning.delta',
                    item_id: itemId,
                    output_index: 0,
                    delta: text,
                    sequence_number: seq++,
                  });
                }

                if (delta.content) {
                  let textContent = delta.content;
                  // <think> 标签处理
                  if (!inThink && textContent.includes('<think>')) {
                    inThink = true;
                    textContent = textContent.replace('<think>', '');
                  }
                  if (inThink) {
                    if (textContent.includes('</think>')) {
                      const parts = textContent.split('</think>');
                      if (parts[0]) {
                        reasoningText += parts[0];
                        writeEvent('response.reasoning.delta', {
                          type: 'response.reasoning.delta', item_id: itemId, output_index: 0,
                          delta: parts[0], sequence_number: seq++,
                        });
                      }
                      inThink = false;
                      textContent = parts.slice(1).join('');
                    } else {
                      reasoningText += textContent;
                      writeEvent('response.reasoning.delta', {
                        type: 'response.reasoning.delta', item_id: itemId, output_index: 0,
                        delta: textContent, sequence_number: seq++,
                      });
                      textContent = '';
                    }
                  }

                  if (textContent) {
                    fullText += textContent;
                    writeEvent('response.output_text.delta', {
                      type: 'response.output_text.delta',
                      item_id: itemId,
                      output_index: 0,
                      content_index: 0,
                      delta: textContent,
                      sequence_number: seq++,
                    });
                  }
                }

                // tool calls
                if (Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx: number = tc.index ?? 0;
                    const chatName: string = tc.function?.name || '';
                    const spec = chatName ? toolNameMap?.get(chatName) : undefined;
                    const resolvedName = spec?.originalName || chatName;

                    if (!tcMap.has(idx)) {
                      const tcItemId = `fc_${Date.now().toString(36)}_${idx}`;
                      const outputIndex = tcOutputBase + tcMap.size;
                      tcMap.set(idx, { id: tc.id || `call_${idx}`, name: resolvedName, namespace: spec?.namespace, args: '', outputIndex, tcItemId, announced: false });
                    }
                    const entry = tcMap.get(idx)!;
                    if (tc.id) entry.id = tc.id;
                    if (resolvedName) entry.name = resolvedName;
                    if (spec?.namespace) entry.namespace = spec.namespace;
                    if (tc.function?.arguments) entry.args += tc.function.arguments;

                    // announce this tool call once we have its name
                    if (!entry.announced && entry.name) {
                      entry.announced = true;
                      const addedEvt: any = {
                        type: 'response.output_item.added',
                        output_index: entry.outputIndex,
                        item: { id: entry.tcItemId, type: 'function_call', status: 'in_progress', call_id: entry.id, name: entry.name, arguments: '' },
                        sequence_number: seq++,
                      };
                      if (spec?.namespace) addedEvt.item.namespace = spec.namespace;
                      writeEvent('response.output_item.added', addedEvt);
                    }

                    if (tc.function?.arguments) {
                      const deltaEvt: any = {
                        type: 'response.function_call_arguments.delta',
                        item_id: entry.tcItemId,
                        output_index: entry.outputIndex,
                        call_id: entry.id,
                        delta: tc.function.arguments,
                        sequence_number: seq++,
                      };
                      if (spec?.namespace) deltaEvt.namespace = spec.namespace;
                      writeEvent('response.function_call_arguments.delta', deltaEvt);
                    }
                  }
                }
              }

              const finishReason = chatChunk.choices?.[0]?.finish_reason;
              if (finishReason) {
                sendHeaders();

                // close text item
                writeEvent('response.output_text.done', {
                  type: 'response.output_text.done',
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  text: fullText,
                  sequence_number: seq++,
                });
                writeEvent('response.content_part.done', {
                  type: 'response.content_part.done',
                  item_id: itemId,
                  output_index: 0,
                  content_index: 0,
                  part: { type: 'output_text', text: fullText, annotations: [] },
                  sequence_number: seq++,
                });
                writeEvent('response.output_item.done', {
                  type: 'response.output_item.done',
                  output_index: 0,
                  item: { id: itemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: fullText, annotations: [] }] },
                  sequence_number: seq++,
                });

                // close each tool call item
                const outputItems: any[] = [
                  { id: itemId, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: fullText, annotations: [] }] },
                ];
                for (const [, entry] of tcMap) {
                  writeEvent('response.function_call_arguments.done', {
                    type: 'response.function_call_arguments.done',
                    item_id: entry.tcItemId,
                    output_index: entry.outputIndex,
                    call_id: entry.id,
                    name: entry.name,
                    arguments: entry.args,
                    sequence_number: seq++,
                  });
                  const doneItem: any = {
                    id: entry.tcItemId,
                    type: 'function_call',
                    status: 'completed',
                    call_id: entry.id,
                    name: entry.name,
                    arguments: entry.args,
                  };
                  if (entry.namespace) doneItem.namespace = entry.namespace;
                  writeEvent('response.output_item.done', {
                    type: 'response.output_item.done',
                    output_index: entry.outputIndex,
                    item: doneItem,
                    sequence_number: seq++,
                  });
                  outputItems.push(doneItem);
                }

                writeEvent('response.completed', {
                  type: 'response.completed',
                  response: {
                    id: respId,
                    object: 'response',
                    status: 'completed',
                    model: chatChunk.model || requestBody.model,
                    output: outputItems,
                    usage: {
                      input_tokens: inputTokens,
                      output_tokens: outputTokens,
                      total_tokens: inputTokens + outputTokens,
                    },
                  },
                  sequence_number: seq++,
                });
              }
            }
          }
        } finally {
          reader.releaseLock();
          if (!res.writableEnded) res.end();
        }

        // OpenAI 语义（chat/completions）：prompt_tokens 含缓存命中量，扣减为真实计费 input
        inputTokens = ProxyServer.netInputTokens(inputTokens, cacheReadTokens);

        let tokensSaved = 0;
        let compressionRatio = 0;
        if (this.headroomEnabled) {
          const hrStats = await this.fetchHeadroomSavings(requestModel, upstream.headers);
          tokensSaved = hrStats.tokensSaved;
          compressionRatio = hrStats.compressionRatio;
        }

        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: 200,
          duration: Date.now() - startTime, model: loggedModel,
          inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
          isStreaming: true, client: 'codex',
          tokensSaved,
          compressionRatio,
        });
      } else {
        const chatResp = await upstream.json() as any;
        const responsesResp = this.convertChatToResponsesResponse(chatResp, requestModel, toolNameMap);
        res.json(responsesResp);

        const usage = chatResp.usage || {};
        const inputTokensRaw = usage.prompt_tokens ?? 0;
        const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0;
        let tokensSavedNonStream = 0;
        let compressionRatioNonStream = 0;
        if (this.headroomEnabled) {
          const hrStats = await this.fetchHeadroomSavings(requestModel, upstream.headers);
          tokensSavedNonStream = hrStats.tokensSaved;
          compressionRatioNonStream = hrStats.compressionRatio;
        }
        this.logRequest(req, {
          method: 'POST', url: req.url, statusCode: 200,
          duration: Date.now() - startTime, model: loggedModel,
          inputTokens: ProxyServer.netInputTokens(inputTokensRaw, cacheReadTokens),
          outputTokens: usage.completion_tokens ?? 0,
          cacheReadTokens,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          isStreaming: false, client: 'codex',
          tokensSaved: tokensSavedNonStream,
          compressionRatio: compressionRatioNonStream,
        });
      }
    } catch (error: any) {
      logger.error('[Codex R→C] failed', { error: error.message });
      this.logRequest(req, {
        method: 'POST', url: req.url, statusCode: 502,
        duration: Date.now() - startTime, model: loggedModel,
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
        isStreaming, client: 'codex', error: error.message,
      });
      if (!res.headersSent) {
        res.status(502).json({ error: 'Codex Proxy Error', message: error.message });
      }
    }
  }
}
