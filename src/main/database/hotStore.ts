import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

function localTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

// 单条 conversation 中 request/response JSON 的最大体积，避免再次膨胀爆库
const MAX_PAYLOAD_BYTES = 256 * 1024;

function safeStringify(value: any): string | null {
  if (value === undefined || value === null) return null;
  try {
    const s = JSON.stringify(value);
    if (s.length > MAX_PAYLOAD_BYTES) {
      return JSON.stringify({ truncated: true, originalSize: s.length });
    }
    return s;
  } catch {
    return null;
  }
}

function safeParse(value: string | null): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export interface LogRow {
  timestamp: string;
  level?: string;
  message?: string;
  [k: string]: any;
}

export interface RequestRow {
  timestamp: string;
  method?: string;
  url?: string;
  statusCode?: number;
  duration?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  isStreaming?: boolean;
  success?: boolean;
  tokensSaved?: number;
  compressionRatio?: number;
  errorMessage?: string;
}

export interface ConversationRow {
  id: string;
  timestamp: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  duration?: number;
  request?: any;
  response?: any;
}

export class HotStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT,
        message TEXT,
        extra TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);

      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        method TEXT,
        url TEXT,
        status_code INTEGER,
        duration INTEGER,
        model TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_creation_tokens INTEGER DEFAULT 0,
        is_streaming INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1,
        tokens_saved INTEGER DEFAULT 0,
        compression_ratio REAL DEFAULT 1,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_model ON requests(model);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        model TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_creation_tokens INTEGER DEFAULT 0,
        duration INTEGER DEFAULT 0,
        request TEXT,
        response TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_ts ON conversations(timestamp);
    `);
  }

  close(): void {
    try { this.db.close(); } catch { /* ignore */ }
  }

  // ----- Logs -----

  insertLog(log: any): void {
    const { timestamp, level, message, ...rest } = log;
    const ts = timestamp || localTimestamp();
    const extra = Object.keys(rest).length ? safeStringify(rest) : null;
    this.db.prepare(
      'INSERT INTO logs (timestamp, level, message, extra) VALUES (?, ?, ?, ?)'
    ).run(ts, level || null, message || null, extra);
  }

  trimLogs(maxRows: number, keepRows: number): void {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM logs').get() as { c: number };
    if (row.c > maxRows) {
      const removeCount = row.c - keepRows;
      this.db.prepare(
        'DELETE FROM logs WHERE id IN (SELECT id FROM logs ORDER BY id ASC LIMIT ?)'
      ).run(removeCount);
    }
  }

  queryLogs(filter: { level?: string; search?: string; limit?: number }): any[] {
    const where: string[] = [];
    const params: any[] = [];
    if (filter?.level) {
      where.push('level = ?');
      params.push(filter.level);
    }
    if (filter?.search) {
      where.push('message LIKE ?');
      params.push(`%${filter.search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filter?.limit && filter.limit > 0 ? filter.limit : 1000;
    const sql = `SELECT id, timestamp, level, message, extra FROM logs ${whereSql} ORDER BY id DESC LIMIT ?`;
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: `log_${r.id}`,
      timestamp: r.timestamp,
      level: r.level,
      message: r.message,
      ...(safeParse(r.extra) || {}),
    }));
  }

  clearLogs(): void {
    this.db.exec('DELETE FROM logs');
  }

  deleteLogsBefore(cutoff: string): number {
    const res = this.db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoff);
    return res.changes as number;
  }

  // ----- Requests -----

  insertRequest(req: any): void {
    this.db.prepare(`
      INSERT INTO requests (
        timestamp, method, url, status_code, duration, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        is_streaming, success, tokens_saved, compression_ratio, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.timestamp || localTimestamp(),
      req.method || null,
      req.url || null,
      req.statusCode ?? null,
      req.duration ?? null,
      req.model || null,
      req.inputTokens || 0,
      req.outputTokens || 0,
      req.cacheReadTokens || 0,
      req.cacheCreationTokens || 0,
      req.isStreaming ? 1 : 0,
      req.success === false ? 0 : 1,
      req.tokensSaved || 0,
      req.compressionRatio ?? 1,
      req.errorMessage || null
    );
  }

  trimRequests(maxRows: number, keepRows: number): void {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM requests').get() as { c: number };
    if (row.c > maxRows) {
      const removeCount = row.c - keepRows;
      this.db.prepare(
        'DELETE FROM requests WHERE id IN (SELECT id FROM requests ORDER BY id ASC LIMIT ?)'
      ).run(removeCount);
    }
  }

  deleteRequestsBefore(cutoff: string): number {
    const res = this.db.prepare('DELETE FROM requests WHERE timestamp < ?').run(cutoff);
    return res.changes as number;
  }

  private mapRequestRow(r: any): any {
    return {
      timestamp: r.timestamp,
      method: r.method,
      url: r.url,
      statusCode: r.status_code,
      duration: r.duration,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      isStreaming: !!r.is_streaming,
      success: !!r.success,
      tokensSaved: r.tokens_saved,
      compressionRatio: r.compression_ratio,
      errorMessage: r.error_message || undefined,
      id: r.id,
    };
  }

  queryRequests(filters: {
    model?: string;
    statusCode?: number;
    startDate?: number; // unix seconds
    endDate?: number;   // unix seconds
  }): { total: number; sql: string; params: any[] } {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.model) {
      where.push('LOWER(model) LIKE ?');
      params.push(`%${filters.model.toLowerCase()}%`);
    }
    if (filters.statusCode) {
      where.push('status_code = ?');
      params.push(filters.statusCode);
    }
    if (filters.startDate) {
      const start = localTimestamp(new Date(filters.startDate * 1000));
      where.push('timestamp >= ?');
      params.push(start);
    }
    if (filters.endDate) {
      const end = localTimestamp(new Date(filters.endDate * 1000));
      where.push('timestamp <= ?');
      params.push(end);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.prepare(`SELECT COUNT(*) as c FROM requests ${whereSql}`).all(...params)[0] as { c: number };
    return { total: totalRow.c, sql: whereSql, params };
  }

  pageRequests(whereSql: string, params: any[], page: number, pageSize: number): any[] {
    const sql = `SELECT * FROM requests ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params, pageSize, page * pageSize) as any[];
    return rows.map((r) => this.mapRequestRow(r));
  }

  aggregateRequestsSince(startTs: string): {
    totalRequests: number;
    successRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    totalTokensSaved: number;
    totalDuration: number;
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS totalRequests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successRequests,
        SUM(input_tokens) AS totalInputTokens,
        SUM(output_tokens) AS totalOutputTokens,
        SUM(cache_read_tokens) AS totalCacheReadTokens,
        SUM(cache_creation_tokens) AS totalCacheCreationTokens,
        SUM(tokens_saved) AS totalTokensSaved,
        SUM(duration) AS totalDuration
      FROM requests
      WHERE timestamp >= ?
    `).get(startTs) as any;
    return {
      totalRequests: row.totalRequests || 0,
      successRequests: row.successRequests || 0,
      totalInputTokens: row.totalInputTokens || 0,
      totalOutputTokens: row.totalOutputTokens || 0,
      totalCacheReadTokens: row.totalCacheReadTokens || 0,
      totalCacheCreationTokens: row.totalCacheCreationTokens || 0,
      totalTokensSaved: row.totalTokensSaved || 0,
      totalDuration: row.totalDuration || 0,
    };
  }

  aggregateRequestsBetween(startTs: string, endTs: string): {
    totalRequests: number;
    successRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    totalTokensSaved: number;
  } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS totalRequests,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS successRequests,
        SUM(input_tokens) AS totalInputTokens,
        SUM(output_tokens) AS totalOutputTokens,
        SUM(cache_read_tokens) AS totalCacheReadTokens,
        SUM(cache_creation_tokens) AS totalCacheCreationTokens,
        SUM(tokens_saved) AS totalTokensSaved
      FROM requests
      WHERE timestamp >= ? AND timestamp <= ?
    `).get(startTs, endTs) as any;
    return {
      totalRequests: row.totalRequests || 0,
      successRequests: row.successRequests || 0,
      totalInputTokens: row.totalInputTokens || 0,
      totalOutputTokens: row.totalOutputTokens || 0,
      totalCacheReadTokens: row.totalCacheReadTokens || 0,
      totalCacheCreationTokens: row.totalCacheCreationTokens || 0,
      totalTokensSaved: row.totalTokensSaved || 0,
    };
  }

  requestsBetween(startTs: string, endTs: string): any[] {
    const rows = this.db.prepare(
      'SELECT * FROM requests WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC'
    ).all(startTs, endTs) as any[];
    return rows.map((r) => this.mapRequestRow(r));
  }

  modelStatsAll(): Array<{ model: string; requestCount: number; totalTokens: number }> {
    const rows = this.db.prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        COUNT(*) AS requestCount,
        SUM(input_tokens + output_tokens) AS totalTokens
      FROM requests
      GROUP BY model
      ORDER BY requestCount DESC
    `).all() as any[];
    return rows.map((r) => ({
      model: r.model,
      requestCount: r.requestCount || 0,
      totalTokens: r.totalTokens || 0,
    }));
  }

  incrementalUsage(sinceTs: string, untilTs: string): {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    modelBreakdown: Array<{
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
    }>;
  } {
    const totalRow = this.db.prepare(`
      SELECT
        COUNT(*) AS totalRequests,
        SUM(input_tokens) AS totalInputTokens,
        SUM(output_tokens) AS totalOutputTokens,
        SUM(cache_read_tokens) AS totalCacheReadTokens,
        SUM(cache_creation_tokens) AS totalCacheCreationTokens
      FROM requests
      WHERE timestamp >= ? AND timestamp < ?
    `).get(sinceTs, untilTs) as any;

    const modelRows = this.db.prepare(`
      SELECT
        COALESCE(model, 'unknown') AS model,
        COUNT(*) AS requests,
        SUM(input_tokens) AS inputTokens,
        SUM(output_tokens) AS outputTokens,
        SUM(cache_read_tokens) AS cacheReadTokens,
        SUM(cache_creation_tokens) AS cacheCreationTokens
      FROM requests
      WHERE timestamp >= ? AND timestamp < ?
      GROUP BY model
    `).all(sinceTs, untilTs) as any[];

    return {
      totalRequests: totalRow.totalRequests || 0,
      totalInputTokens: totalRow.totalInputTokens || 0,
      totalOutputTokens: totalRow.totalOutputTokens || 0,
      totalCacheReadTokens: totalRow.totalCacheReadTokens || 0,
      totalCacheCreationTokens: totalRow.totalCacheCreationTokens || 0,
      modelBreakdown: modelRows.map((r) => ({
        model: r.model,
        requests: r.requests || 0,
        inputTokens: r.inputTokens || 0,
        outputTokens: r.outputTokens || 0,
        cacheReadTokens: r.cacheReadTokens || 0,
        cacheCreationTokens: r.cacheCreationTokens || 0,
      })),
    };
  }

  clearRequests(): void {
    this.db.exec('DELETE FROM requests');
  }

  // ----- Conversations -----

  insertConversation(conv: any): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO conversations (
        id, timestamp, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        duration, request, response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conv.id,
      conv.timestamp || localTimestamp(),
      conv.model || null,
      conv.inputTokens || 0,
      conv.outputTokens || 0,
      conv.cacheReadTokens || 0,
      conv.cacheCreationTokens || 0,
      conv.duration || 0,
      safeStringify(conv.request),
      safeStringify(conv.response)
    );
  }

  trimConversations(maxRows: number, keepRows: number): void {
    const row = this.db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number };
    if (row.c > maxRows) {
      const removeCount = row.c - keepRows;
      this.db.prepare(
        `DELETE FROM conversations WHERE id IN (
          SELECT id FROM conversations ORDER BY timestamp ASC LIMIT ?
        )`
      ).run(removeCount);
    }
  }

  deleteConversationsBefore(cutoff: string): number {
    const res = this.db.prepare('DELETE FROM conversations WHERE timestamp < ?').run(cutoff);
    return res.changes as number;
  }

  listConversations(limit?: number): any[] {
    const sql = limit && limit > 0
      ? 'SELECT * FROM conversations ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM conversations ORDER BY timestamp DESC';
    const rows = (limit && limit > 0
      ? this.db.prepare(sql).all(limit)
      : this.db.prepare(sql).all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      model: r.model,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      duration: r.duration,
      request: safeParse(r.request),
      response: safeParse(r.response),
    }));
  }

  deleteConversation(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  clearConversations(): void {
    this.db.exec('DELETE FROM conversations');
  }

  // ----- Bulk import (migration) -----

  bulkInsertLogs(logs: any[]): void {
    const stmt = this.db.prepare(
      'INSERT INTO logs (timestamp, level, message, extra) VALUES (?, ?, ?, ?)'
    );
    const tx = this.db.transaction((items: any[]) => {
      for (const log of items) {
        const { timestamp, level, message, ...rest } = log || {};
        const extra = Object.keys(rest).length ? safeStringify(rest) : null;
        stmt.run(timestamp || localTimestamp(), level || null, message || null, extra);
      }
    });
    tx(logs);
  }

  bulkInsertRequests(requests: any[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO requests (
        timestamp, method, url, status_code, duration, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        is_streaming, success, tokens_saved, compression_ratio, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: any[]) => {
      for (const r of items) {
        if (!r) continue;
        stmt.run(
          r.timestamp || localTimestamp(),
          r.method || null,
          r.url || null,
          r.statusCode ?? null,
          r.duration ?? null,
          r.model || null,
          r.inputTokens || 0,
          r.outputTokens || 0,
          r.cacheReadTokens || 0,
          r.cacheCreationTokens || 0,
          r.isStreaming ? 1 : 0,
          r.success === false ? 0 : 1,
          r.tokensSaved || 0,
          r.compressionRatio ?? 1,
          r.errorMessage || null
        );
      }
    });
    tx(requests);
  }

  bulkInsertConversations(conversations: any[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO conversations (
        id, timestamp, model,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        duration, request, response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: any[]) => {
      for (const c of items) {
        if (!c || !c.id) continue;
        stmt.run(
          c.id,
          c.timestamp || localTimestamp(),
          c.model || null,
          c.inputTokens || 0,
          c.outputTokens || 0,
          c.cacheReadTokens || 0,
          c.cacheCreationTokens || 0,
          c.duration || 0,
          safeStringify(c.request),
          safeStringify(c.response)
        );
      }
    });
    tx(conversations);
  }
}
