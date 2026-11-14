import { randomUUID } from 'crypto';

/**
 * DongCC 日志上报的基础字段工具(PRD《DongCC 日志上报》4.1)。
 * 本文件只提供**纯函数/类型**,不做任何 I/O 或代理链路改动,供后续
 * 「字段组装 + 上报」阶段消费。
 */

/** PRD 4.1.5 error_type 枚举定义 */
export type ErrorType =
  | 'timeout'            // 请求超时:上游无响应/读超时
  | 'rate_limit'         // 限流:HTTP 429 / 上游 rate limit
  | 'auth_failure'       // 鉴权失败:HTTP 401/403 / API Key 无效或过期
  | 'upstream_error'     // 上游网关报错:HTTP 5xx / 上游内部错误
  | 'connection_failure'; // 连接失败:DNS 解析失败 / TCP 被拒 / TLS 握手失败

/** 生成请求唯一标识(UUID v4),贯穿 客户端 → DongCC → 上游网关 全链路。 */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * 上游错误 message 截断到 256 字符(PRD:仅保留业务层简短错误,
 * 禁止写入完整 Response Body / 异常堆栈,防止日志膨胀与敏感信息泄露)。
 */
export function truncateUpstreamErrorMessage(msg?: string | null): string | undefined {
  if (msg == null) return undefined;
  const s = String(msg);
  return s.length > 256 ? s.slice(0, 256) : s;
}

// 脱敏默认开启;设 DONGCC_LOG_MASK_OFF=1 可关闭(不建议)。
const MASK_ENABLED = (() => {
  try { return typeof process !== 'undefined' && process.env && process.env.DONGCC_LOG_MASK_OFF === '1' ? false : true; }
  catch { return true; }
})();

/**
 * 脱敏(PRD 4.5):upstream_error_message 中若含 API Key / Token / 手机号 / 身份证 / 邮箱 / IP
 * 等敏感信息,替换为 ***。默认开启,防敏感信息随日志外泄。
 */
export function maskSensitive(text?: string | null): string | undefined {
  if (text == null) return undefined;
  if (!MASK_ENABLED) return String(text);
  let s = String(text);
  try {
    // Bearer / key=value 形式的凭证
    s = s.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1***');
    s = s.replace(/((?:api[_-]?key|token|password|passwd|secret|authorization)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1***');
    // sk-/pk- 前缀的 API Key
    s = s.replace(/\b(sk|pk)-[A-Za-z0-9_\-]{6,}/g, '$1-***');
    // 邮箱
    s = s.replace(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, '***@***');
    // 中国手机号(11 位)
    s = s.replace(/\b1[3-9]\d{9}\b/g, '***');
    // 身份证(18 位,末位可 X)
    s = s.replace(/\b\d{17}[\dXx]\b/g, '***');
    // IPv4
    s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '***');
  } catch {
    /* 脱敏失败不阻塞,原样返回截断即可 */
  }
  return s;
}

/**
 * 从上游错误负载里抽取「上游自身的错误码」(PRD 4.1.5 upstream_error_code)。
 * 代理层把上游原始 body 以 `上游返回 <status>: {json}` 形式拼进了 error 文本,
 * JD 网关 body 形如 `{"error":{"code":429,...},"requestId":"...","result":null}`,
 * 故优先按 JSON 解析 `error.code`/`code`,失败再正则兜底匹配首个 `"code": <num|"str">`。
 * ⚠️ 必须对**脱敏/截断前**的原始 body 调用:截断到 256 字符可能把 code 切掉。
 * 未能识别(如 502「socket hang up」这类无结构化 body)返回 null。
 */
export function extractUpstreamErrorCode(raw?: unknown): string | null {
  if (raw == null) return null;
  // 已是对象:直接取 error.code / code
  if (typeof raw === 'object') {
    const o = raw as { error?: { code?: unknown }; code?: unknown };
    const c = o?.error?.code ?? o?.code;
    return c == null || c === '' ? null : String(c);
  }
  const s = String(raw);
  // 1) 从文本里截出首个 JSON 对象并解析(代理把上游 body 拼进了 `上游返回 XXX: {json}`)
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(s.slice(start, end + 1)) as { error?: { code?: unknown }; code?: unknown };
      const c = obj?.error?.code ?? obj?.code;
      if (c != null && c !== '') return String(c);
    } catch {
      /* body 被截断/非 JSON,落到正则兜底 */
    }
  }
  // 2) 正则兜底:匹配首个 "code": <数字|"字符串">(body 被截断时仍能命中,code 通常靠前)
  const m = s.match(/"code"\s*:\s*(?:"([^"]+)"|(\d+))/);
  if (m) return m[1] ?? m[2] ?? null;
  return null;
}

/**
 * 归类 error_type。
 * - 请求成功(无状态或 2xx/3xx)→ 返回 null(PRD:2xx 时 error_type 留空);
 * - 拿到 HTTP 错误响应 → 按状态码归类;
 * - 未拿到响应(网络层抛异常)→ 按异常归类为 timeout / connection_failure。
 */
export function classifyErrorType(input: {
  httpStatus?: number | null;
  caughtError?: unknown;
}): ErrorType | null {
  const { httpStatus, caughtError } = input;

  // 1) 网络层异常(未到达上游/未拿到响应)
  if (caughtError) {
    const e = caughtError as { name?: string; code?: string; message?: string };
    const name = e?.name || '';
    const code = e?.code || '';
    const msg = (e?.message || '').toLowerCase();
    if (name === 'AbortError' || code === 'ETIMEDOUT' || msg.includes('timeout') || msg.includes('timed out')) {
      return 'timeout';
    }
    // ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ECONNRESET/TLS 握手等一律归为连接失败
    return 'connection_failure';
  }

  // 2) 有 HTTP 状态码
  if (httpStatus == null || httpStatus < 400) return null; // 成功
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus === 401 || httpStatus === 403) return 'auth_failure';
  if (httpStatus >= 500) return 'upstream_error';
  // 其它 4xx(400/404 等):PRD 未单列,归为 upstream_error(上游返回的业务错误)
  return 'upstream_error';
}

/**
 * 一条完整的网关级上报日志(PRD 4.2 Schema,去掉已删除的 provider)。
 * 代理层可组装的字段在此;user_erp / user_department 由 internal 上报器补齐。
 */
export interface RequestLog {
  // 4.1.1 请求唯一标识
  request_id?: string;
  // 4.1.2 时间
  request_start_time: number;
  latency_ms: number;
  response_time: number;
  // 4.1.3 用户身份(由 internal 上报器补齐)
  user_erp?: string;
  user_department?: string;
  // 4.1.4 调度策略(provider 已按新版 PRD 删除)
  base_url?: string;
  model_name: string;
  routing_rule: string;
  // 4.1.5 网络与状态
  http_status_code: number;
  error_type: ErrorType | null;
  upstream_error_code?: string | null;
  upstream_error_message?: string;
  // 4.1.6 用量
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  stream: boolean;
  // 4.1.7 实例
  instance_id?: string | null;
  dongcc_version?: string;
}

/**
 * 把代理内部的 `request` 事件负载映射为一条 RequestLog(代理层可见字段)。
 * 复用现有 on('request') 已带的 statusCode/tokens/model/stream/error,补齐 error_type、
 * 时间三元组、base_url、routing_rule 占位、实例信息。user_erp/部门留给上报器补。
 */
export function buildRequestLog(
  data: any,
  extra: { requestId?: string; baseUrl?: string; instanceId?: string | null; dongccVersion?: string }
): RequestLog {
  const status = typeof data?.statusCode === 'number' ? data.statusCode : 0;
  const duration = typeof data?.duration === 'number' ? data.duration : 0;
  const responseTime = Date.now();
  const prompt = data?.inputTokens || 0;
  const completion = data?.outputTokens || 0;
  const errMsg = data?.errorMessage ?? data?.error;

  return {
    request_id: extra.requestId,
    request_start_time: responseTime - duration,
    latency_ms: duration,
    response_time: responseTime,
    base_url: extra.baseUrl,
    model_name: data?.model || 'unknown',
    // 占位:DongCC 当前为「每客户端单上游」透明代理,无多路由(load_balance/failover/priority_group),
    // 待独立后端后引入真实路由能力时再回填(PRD routing_rule)。
    routing_rule: 'single',
    http_status_code: status,
    error_type: classifyErrorType({ httpStatus: status }),
    // 优先用代理显式给的 upstreamErrorCode;否则从原始 body 兜底解析(脱敏/截断前)。
    upstream_error_code:
      data?.upstreamErrorCode != null && data.upstreamErrorCode !== ''
        ? String(data.upstreamErrorCode)
        : status >= 400
          ? extractUpstreamErrorCode(errMsg)
          : null,
    // 仅失败时保留,先脱敏再截断到 256 字符
    upstream_error_message: status >= 400 ? truncateUpstreamErrorMessage(maskSensitive(errMsg)) : undefined,
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    stream: !!data?.isStreaming,
    instance_id: extra.instanceId ?? null,
    dongcc_version: extra.dongccVersion,
  };
}

