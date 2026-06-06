import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as dns from 'dns';
import * as TOML from '@iarna/toml';

const execAsync = promisify(exec);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

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

function getShellEnv(): { env: NodeJS.ProcessEnv; shell: string } {
  const shell = process.env.SHELL || '/bin/zsh';
  
  try {
    console.log('[Environment] Attempting to get PATH via shell login mode...');
    const pathOutput = execSync(
      `${shell} -l -c 'echo $PATH'`,
      { encoding: 'utf-8', timeout: 5000 }
    ).trim();
    
    console.log('[Environment] PATH obtained:', pathOutput);
    
    const env = {
      ...process.env,
      PATH: pathOutput,
      HOME: os.homedir(),
    };

    // 确保常用路径始终包含
    const extraPaths = [
      path.join(os.homedir(), '.local/bin'),
      path.join(os.homedir(), '.npm-global/bin'),
      path.join(os.homedir(), '.yarn/bin'),
      path.join(os.homedir(), '.volta/bin'),
      path.join(os.homedir(), '.fnm/aliases/default/bin'),
      path.join(os.homedir(), 'Library/pnpm'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];
    const currentPaths = (env.PATH || '').split(':');
    for (const p of extraPaths) {
      if (!currentPaths.includes(p)) {
        currentPaths.push(p);
      }
    }
    env.PATH = currentPaths.join(':');

    return { env, shell };
  } catch (error: any) {
    console.error('[Environment] Failed to get PATH via shell login:', error.message);
    
    const fallbackPaths = [
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      '/opt/homebrew/bin',
      path.join(os.homedir(), '.nvm/versions/node'),
      path.join(os.homedir(), '.local/bin'),
      process.env.PATH || ''
    ].filter(Boolean);
    
    const env = {
      ...process.env,
      PATH: fallbackPaths.join(':'),
      HOME: os.homedir(),
    };
    
    console.log('[Environment] Using fallback PATH:', env.PATH);
    
    return { env, shell };
  }
}

function findExecutableInPath(executable: string, env: NodeJS.ProcessEnv): string | null {
  const pathEnv = env.PATH || '';
  const paths = pathEnv.split(':');

  // Also check well-known global install locations that may not be in PATH
  const home = os.homedir();
  const extraDirs = [
    // npm global (various node version managers)
    path.join(home, '.nvm/versions/node'),  // handled specially below
    path.join(home, '.local/bin'),
    path.join(home, '.npm-global/bin'),
    path.join(home, '.yarn/bin'),
    path.join(home, '.config/yarn/global/node_modules/.bin'),
    path.join(home, '.pnpm-global/bin'),
    path.join(home, 'Library/pnpm'),
    // volta & fnm
    path.join(home, '.volta/bin'),
    path.join(home, '.fnm/aliases/default/bin'),
    // homebrew
    '/opt/homebrew/bin',
    '/usr/local/bin',
    // common Linux
    '/usr/bin',
    '/snap/bin',
  ];

  const allDirs = [...new Set([...paths, ...extraDirs])];

  for (const dir of allDirs) {
    const fullPath = path.join(dir, executable);
    try {
      if (fs.existsSync(fullPath)) {
        console.log(`[FindExecutable] Found ${executable} at: ${fullPath}`);
        return fullPath;
      }
    } catch {
      // Ignore errors
    }
  }

  // Special: scan nvm versions directory for any installed node version
  const nvmDir = path.join(home, '.nvm/versions/node');
  try {
    if (fs.existsSync(nvmDir)) {
      const versions = fs.readdirSync(nvmDir).sort().reverse();
      for (const ver of versions) {
        const binPath = path.join(nvmDir, ver, 'bin', executable);
        if (fs.existsSync(binPath)) {
          console.log(`[FindExecutable] Found ${executable} via nvm at: ${binPath}`);
          return binPath;
        }
      }
    }
  } catch {}

  console.log(`[FindExecutable] ${executable} not found in any known path`);
  return null;
}

export interface CheckResult {
  installed: boolean;
  version?: string;
  path?: string;
  valid?: boolean;
  message?: string;
}

export interface EnvironmentStatus {
  claudeCode: CheckResult;
  nodejs: CheckResult;
  port: { available: boolean; usedBy?: string };
  config: { exists: boolean; valid: boolean; path?: string };
}

export type CheckLevel = 'pass' | 'warn' | 'fail';

export interface CheckItem {
  id: string;
  title: string;
  level: CheckLevel;
  detail?: string;
  problem?: string;
  fix?: string;
}

export interface ConnectionTestReport {
  items: CheckItem[];
  overall: CheckLevel;
}

export class SystemChecker {
  private codexOriginal: { model_provider?: string; model?: string } | null = null;

  // 在用户的登录 shell 中执行命令，确保 nvm 等环境管理器已加载
  private async execInLoginShell(cmd: string): Promise<string> {
    const shell = process.env.SHELL || '/bin/zsh';
    const homeDir = os.homedir();

    // Strategy 1: interactive login shell (loads .zshrc/.bashrc fully)
    try {
      const { stdout } = await execAsync(`${shell} -l -i -c '${cmd}'`, {
        env: { ...process.env, HOME: homeDir },
        shell,
        timeout: 8000,
      });
      if (stdout.trim()) return stdout.trim();
    } catch {}

    // Strategy 2: login shell without -i (avoids tty issues, still loads profile)
    try {
      const { stdout } = await execAsync(`${shell} -l -c '${cmd}'`, {
        env: { ...process.env, HOME: homeDir },
        shell,
        timeout: 5000,
      });
      if (stdout.trim()) return stdout.trim();
    } catch {}

    // Strategy 3: source nvm/fnm explicitly then run
    const nvmInit = `[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null;`;
    const fnmInit = `command -v fnm >/dev/null && eval "$(fnm env)" 2>/dev/null;`;
    const voltaSetup = `export PATH="$HOME/.volta/bin:$PATH";`;
    try {
      const { stdout } = await execAsync(
        `${shell} -c '${nvmInit} ${fnmInit} ${voltaSetup} ${cmd}'`,
        { env: { ...process.env, HOME: homeDir }, shell, timeout: 5000 }
      );
      if (stdout.trim()) return stdout.trim();
    } catch {}

    throw new Error(`Command not found: ${cmd}`);
  }

  // 检查 Claude Code 是否安装
  async checkClaudeCode(): Promise<CheckResult> {
    // Try `which` first, then `command -v`
    for (const locateCmd of ['which claude', 'command -v claude']) {
      try {
        const claudePath = await this.execInLoginShell(locateCmd);
        if (claudePath) {
          try {
            const version = await this.execInLoginShell('claude --version');
            return { installed: true, version, path: claudePath, valid: true };
          } catch {
            return { installed: true, path: claudePath, valid: true, message: 'Claude Code 已安装' };
          }
        }
      } catch { /* not found via this method */ }
    }

    // fallback: 直接在常见路径中查找
    const { env } = getShellEnv();
    const claudePath = findExecutableInPath('claude', env);
    if (claudePath) {
      return { installed: true, path: claudePath, valid: true, message: 'Claude Code 已安装' };
    }

    return {
      installed: false,
      message: 'Claude Code 未安装',
    };
  }

  // 检查 Node.js 版本
  async checkNodeJS(): Promise<CheckResult> {
    console.log('[CheckNodeJS] Starting check...');
    
    try {
      const { env, shell } = getShellEnv();
      
      // 方法1: 使用 node --version 命令
      try {
        const { stdout } = await execAsync('node --version', { 
          env,
          shell 
        });
        const version = stdout.trim();
        const majorVersion = parseInt(version.replace('v', '').split('.')[0]);

        console.log('[CheckNodeJS] Found via command:', version);
        return {
          installed: true,
          version,
          valid: majorVersion >= 16,
          message: majorVersion >= 16 ? undefined : 'Node.js 版本过低，建议升级到 v16 或更高版本',
        };
      } catch (cmdError: any) {
        console.error('[CheckNodeJS] node command failed:', cmdError.message);
      }
      
      // 方法2: 直接在 PATH 中查找
      const nodePath = findExecutableInPath('node', env);
      if (nodePath) {
        console.log('[CheckNodeJS] Found via direct search:', nodePath);
        return {
          installed: true,
          path: nodePath,
          valid: true,
          message: 'Node.js 已安装',
        };
      }
      
      console.log('[CheckNodeJS] Node.js not found');
      return {
        installed: false,
        message: 'Node.js 未安装',
      };
    } catch (error: any) {
      console.error('[CheckNodeJS] Check failed:', error.message);
      return {
        installed: false,
        message: 'Node.js 未安装',
      };
    }
  }

  // 检查端口占用
  async checkPort(port: number): Promise<{ available: boolean; usedBy?: string }> {
    try {
      const { env, shell } = getShellEnv();
      const { stdout } = await execAsync(`lsof -i :${port}`, { env, shell });
      return {
        available: false,
        usedBy: stdout.trim(),
      };
    } catch {
      return {
        available: true,
      };
    }
  }

  // 检查 Claude 配置文件
  async checkClaudeConfig(): Promise<{ exists: boolean; valid: boolean; path?: string; config?: any }> {
    const configPath = path.join(os.homedir(), '.claude', 'settings.json');

    try {
      const exists = await this.fileExists(configPath);

      if (!exists) {
        return {
          exists: false,
          valid: false,
          path: configPath,
        };
      }

      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);
      const valid = this.validateClaudeConfig(config);

      return {
        exists: true,
        valid,
        path: configPath,
        config,
      };
    } catch (error) {
      return {
        exists: false,
        valid: false,
        path: configPath,
      };
    }
  }

  // 验证 Claude 配置
  private validateClaudeConfig(config: any): boolean {
    if (!config || typeof config !== 'object') {
      return false;
    }

    if (!config.env || typeof config.env !== 'object') {
      return false;
    }

    const hasAuthToken = config.env.ANTHROPIC_AUTH_TOKEN && typeof config.env.ANTHROPIC_AUTH_TOKEN === 'string';
    const hasBaseUrl = config.env.ANTHROPIC_BASE_URL && typeof config.env.ANTHROPIC_BASE_URL === 'string';

    return hasAuthToken && hasBaseUrl;
  }

  // 自动配置 Claude
  async autoConfigureClaude(
    port: number,
    apiKey: string,
    models?: Array<{ id: string; name: string; modelId: string }>,
    defaultModel?: string,
    apiFormat?: 'chat-completions' | 'responses' | 'anthropic',
    baseUrl?: string
  ): Promise<void> {
    const configPath = path.join(os.homedir(), '.claude', 'settings.json');
    const configDir = path.dirname(configPath);

    await this.ensureDir(configDir);

    let existing: any = {};
    try {
      const content = await readFile(configPath, 'utf-8');
      existing = JSON.parse(content);
    } catch {
      // file doesn't exist or is invalid JSON
    }

    existing.env = {
      ...(existing.env || {}),
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    };

    if (apiFormat === 'anthropic') {
      const isRetailGateway = baseUrl?.includes('llm-gw.jd.local');
      if (isRetailGateway) {
        existing.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'Claude-Sonnet-4.6-joybuilder';
        existing.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = 'Claude-Sonnet-4.6-joybuilder';
        existing.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'Claude-Opus-4.6-joybuilder';
        existing.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = 'Claude-Opus-4.6-joybuilder';
        existing.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'Claude-Opus-4.7-joybuilder';
        existing.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = 'Claude-Opus-4.7-joybuilder';
      } else {
        existing.env.ANTHROPIC_DEFAULT_SONNET_MODEL = 'Claude-Sonnet-4.6';
        existing.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME = 'Claude-Sonnet-4.6';
        existing.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = 'Claude-Opus-4.6';
        existing.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME = 'Claude-Opus-4.6';
        existing.env.ANTHROPIC_DEFAULT_OPUS_MODEL = 'Claude-Opus-4.7';
        existing.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME = 'Claude-Opus-4.7';
      }
    }

    if (models && models.length > 0) {
      const resolvedDefaultModel = defaultModel
        ? models.find(m => m.id === defaultModel)?.modelId || models[0].modelId
        : models[0].modelId;

      // Claude Code 通过顶层 model 字段决定启动时的默认模型
      existing.model = resolvedDefaultModel;
    }

    try {
      await writeFile(configPath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(
          `无权限写入 ${configPath}，请在终端执行: sudo chown $(whoami) ${configPath} && chmod 644 ${configPath} 后重试`
        );
      }
      throw error;
    }
  }

  // 还原 Claude 配置
  async restoreClaudeConfig(): Promise<void> {
    const configPath = path.join(os.homedir(), '.claude', 'settings.json');
    
    try {
      const exists = await this.fileExists(configPath);
      
      if (exists) {
        const content = await readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        
        if (config.env) {
          delete config.env.ANTHROPIC_AUTH_TOKEN;
          delete config.env.ANTHROPIC_BASE_URL;
          delete config.env.ANTHROPIC_API_KEY;
          delete config.env.ANTHROPIC_DEFAULT_SONNET_MODEL;
          delete config.env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME;
          delete config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
          delete config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME;
          delete config.env.ANTHROPIC_DEFAULT_OPUS_MODEL;
          delete config.env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME;
        }

        // 保留 model 配置（默认模型）

        await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch (error) {
      console.error('Failed to restore Claude config:', error);
    }
  }

  // 自动配置 Codex CLI: 写 ~/.codex/config.toml
  async autoConfigureCodex(
    port: number,
    codexCfg?: {
      apiKey: string;
      apiFormat: 'chat-completions' | 'responses' | 'anthropic';
      models?: Array<{ id: string; name: string; modelId: string }>;
      defaultModel?: string;
    }
  ): Promise<void> {
    if (!codexCfg || !codexCfg.apiKey) return;
    if (codexCfg.apiFormat === 'anthropic') {
      // Codex 不支持 anthropic 协议
      return;
    }

    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    await this.ensureDir(path.dirname(configPath));

    let existing: any = {};
    try {
      const content = await readFile(configPath, 'utf-8');
      existing = TOML.parse(content) as any;

      // 备份用户原有的 model_provider 和 model，供 restore 时还原
      if (!this.codexOriginal) {
        this.codexOriginal = {
          model_provider: existing.model_provider,
          model: existing.model,
        };
      }
    } catch {
      // file doesn't exist or unparseable
      this.codexOriginal = {};
    }

    // 注意：Codex CLI 当前已不支持 wire_api = "chat"，统一写 "responses"
    // 即使用户选了 chat-completions 协议，也通过 responses 协议接入 dongcc，
    // 由 dongcc 路由层负责适配上游
    const wireApi = 'responses';
    const resolvedModelId = codexCfg.defaultModel && codexCfg.models
      ? codexCfg.models.find(m => m.id === codexCfg.defaultModel)?.modelId
        || codexCfg.models[0]?.modelId
        || ''
      : codexCfg.models?.[0]?.modelId || '';

    existing.model_provider = 'dongcc';
    if (resolvedModelId) {
      existing.model = resolvedModelId;
    }

    existing.model_providers = existing.model_providers || {};
    existing.model_providers.dongcc = {
      name: 'DongCC Proxy',
      base_url: `http://127.0.0.1:${port}/v1`,
      wire_api: wireApi,
      experimental_bearer_token: codexCfg.apiKey,
    };

    try {
      await writeFile(configPath, TOML.stringify(existing), 'utf-8');
    } catch (error: any) {
      if (error.code === 'EACCES') {
        throw new Error(
          `无权限写入 ${configPath}，请在终端执行: sudo chown $(whoami) ${configPath} && chmod 644 ${configPath} 后重试`
        );
      }
      throw error;
    }
  }

  // 还原 Codex 配置: 删除 [model_providers.dongcc] 表，并恢复用户原有的 model_provider/model
  async restoreCodexConfig(): Promise<void> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    try {
      const exists = await this.fileExists(configPath);
      if (!exists) return;

      const content = await readFile(configPath, 'utf-8');
      const config = TOML.parse(content) as any;

      if (config.model_providers && config.model_providers.dongcc) {
        delete config.model_providers.dongcc;
        if (Object.keys(config.model_providers).length === 0) {
          delete config.model_providers;
        }
      }

      if (config.model_provider === 'dongcc') {
        // 还原用户原有的值，没有则删除
        if (this.codexOriginal?.model_provider) {
          config.model_provider = this.codexOriginal.model_provider;
        } else {
          delete config.model_provider;
        }

        if (this.codexOriginal?.model) {
          config.model = this.codexOriginal.model;
        } else {
          delete config.model;
        }
      }

      this.codexOriginal = null;
      await writeFile(configPath, TOML.stringify(config), 'utf-8');
    } catch (error) {
      console.error('Failed to restore Codex config:', error);
    }
  }

  // 完整的环境检查
  async checkEnvironment(port: number = 8787): Promise<EnvironmentStatus> {
    const [claudeCode, nodejs, portCheck, configCheck] = await Promise.all([
      this.checkClaudeCode(),
      this.checkNodeJS(),
      this.checkPort(port),
      this.checkClaudeConfig(),
    ]);

    return {
      claudeCode,
      nodejs,
      port: portCheck,
      config: configCheck,
    };
  }

  // 生成环境报告
  generateReport(status: EnvironmentStatus): string {
    const lines: string[] = ['环境检查报告', '='.repeat(50)];

    // Claude Code
    lines.push('\n[Claude Code]');
    if (status.claudeCode.installed) {
      lines.push(`✅ 已安装: ${status.claudeCode.version || '未知版本'}`);
      if (status.claudeCode.path) {
        lines.push(`   路径: ${status.claudeCode.path}`);
      }
    } else {
      lines.push(`❌ 未安装: ${status.claudeCode.message || ''}`);
    }

    // Node.js
    lines.push('\n[Node.js]');
    if (status.nodejs.installed) {
      lines.push(`✅ 已安装: ${status.nodejs.version}`);
      if (status.nodejs.valid) {
        lines.push('   版本符合要求');
      } else {
        lines.push(`   ⚠️  ${status.nodejs.message || ''}`);
      }
    } else {
      lines.push(`❌ 未安装: ${status.nodejs.message || ''}`);
    }

    // 端口
    lines.push('\n[端口检查]');
    if (status.port.available) {
      lines.push('✅ 端口可用');
    } else {
      lines.push('❌ 端口已被占用');
      if (status.port.usedBy) {
        lines.push(`   占用信息: ${status.port.usedBy}`);
      }
    }

    // 配置文件
    lines.push('\n[Claude 配置]');
    if (status.config.exists) {
      lines.push('✅ 配置文件存在');
      if (status.config.valid) {
        lines.push('   配置格式正确');
      } else {
        lines.push('   ⚠️  配置格式不正确');
      }
      if (status.config.path) {
        lines.push(`   路径: ${status.config.path}`);
      }
    } else {
      lines.push('❌ 配置文件不存在');
    }

    return lines.join('\n');
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  // ========================== Connection Test ==========================

  /**
   * 运行完整的连通性自检，返回结构化报告。
   * clientType='claude' 时检查 settings.json + claude CLI 等；
   * clientType='codex'  时检查 config.toml + codex CLI 等。
   */
  async runConnectionTest(
    clientType: 'claude' | 'codex',
    port: number,
    clientCfg: {
      apiKey: string;
      baseUrl: string;
      apiFormat: 'chat-completions' | 'responses' | 'anthropic';
    }
  ): Promise<ConnectionTestReport> {
    const tasks: Promise<CheckItem>[] = [
      this.checkCliInstalled(clientType),
      this.checkPortStatus(port),
      this.checkProxyHealth(port),
      this.checkShellRc(clientType),
      clientType === 'claude'
        ? this.checkClaudeConfigFile(port, clientCfg.apiKey)
        : this.checkCodexConfigFile(port, clientCfg.apiKey, clientCfg.apiFormat),
      this.checkUpstream(clientCfg),
    ];

    const settled = await Promise.allSettled(tasks);
    const items: CheckItem[] = settled.map((r, idx) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        id: `task-${idx}`,
        title: '内部错误',
        level: 'fail',
        problem: r.reason?.message || String(r.reason),
      };
    });

    const overall: CheckLevel = items.some(i => i.level === 'fail')
      ? 'fail'
      : items.some(i => i.level === 'warn') ? 'warn' : 'pass';

    return { items, overall };
  }

  private async checkCliInstalled(clientType: 'claude' | 'codex'): Promise<CheckItem> {
    if (clientType === 'claude') {
      const r = await this.checkClaudeCode();
      if (r.installed && r.valid) {
        return {
          id: 'cli-installed',
          title: 'Claude Code CLI',
          level: 'pass',
          detail: `已安装${r.version ? ` (${r.version})` : ''}${r.path ? ` · ${r.path}` : ''}`,
        };
      }
      return {
        id: 'cli-installed',
        title: 'Claude Code CLI',
        level: 'fail',
        problem: r.message || '未检测到 claude 命令',
        fix: '请安装 Claude Code：\nnpm install -g @anthropic-ai/claude-code\n安装后重新打开终端再试',
      };
    }
    // codex
    return await this.checkCodexCli();
  }

  private async checkCodexCli(): Promise<CheckItem> {
    for (const locateCmd of ['which codex', 'command -v codex']) {
      try {
        const codexPath = await this.execInLoginShell(locateCmd);
        if (codexPath) {
          let version = '';
          try { version = await this.execInLoginShell('codex --version'); } catch {}
          return {
            id: 'cli-installed',
            title: 'Codex CLI',
            level: 'pass',
            detail: `已安装${version ? ` (${version})` : ''} · ${codexPath}`,
          };
        }
      } catch { /* not found via this method */ }
    }

    // fallback
    const { env } = getShellEnv();
    const direct = findExecutableInPath('codex', env);
    if (direct) {
      return { id: 'cli-installed', title: 'Codex CLI', level: 'pass', detail: `已安装 · ${direct}` };
    }

    return {
      id: 'cli-installed',
      title: 'Codex CLI',
      level: 'fail',
      problem: '未检测到 codex 命令',
      fix: '请安装 Codex CLI：\nnpm install -g @openai/codex\n安装后重新打开终端再试',
    };
  }

  private async checkPortStatus(port: number): Promise<CheckItem> {
    const r = await this.checkPort(port);
    if (r.available) {
      return {
        id: 'port',
        title: `端口 ${port}`,
        level: 'warn',
        detail: '端口当前未被占用（DongCC 代理服务可能未启动，请确认是否已点开始服务）',
      };
    }
    // 占用 — 看是不是 DongCC 自己
    const usedBy = r.usedBy || '';
    const isDongCC = /DongCC|dongcc|node|electron/i.test(usedBy);
    if (isDongCC) {
      return {
        id: 'port',
        title: `端口 ${port}`,
        level: 'pass',
        detail: '已被代理服务占用',
      };
    }
    // 提取一行 PID
    const lines = usedBy.split('\n').filter(Boolean);
    let pid = '';
    let cmd = '';
    if (lines.length >= 2) {
      const cols = lines[1].split(/\s+/);
      cmd = cols[0] || '';
      pid = cols[1] || '';
    }
    return {
      id: 'port',
      title: `端口 ${port}`,
      level: 'fail',
      problem: `端口被其他进程占用${cmd ? `：${cmd}（PID ${pid}）` : ''}`,
      fix: pid
        ? `kill -9 ${pid}  # 谨慎：会强制结束 ${cmd} 进程`
        : `请在终端运行 lsof -i :${port} 查找占用进程后手动结束`,
    };
  }

  private async checkProxyHealth(port: number): Promise<CheckItem> {
    const url = `http://127.0.0.1:${port}/health`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!resp.ok) {
        return {
          id: 'proxy-health',
          title: 'DongCC 代理服务',
          level: 'fail',
          problem: `/health 返回 ${resp.status}`,
          fix: '请重启 DongCC 服务（点击页面顶部 开始 / 停止 服务按钮）',
        };
      }
      const data: any = await resp.json();
      if (data.running) {
        return {
          id: 'proxy-health',
          title: 'DongCC 代理服务',
          level: 'pass',
          detail: `运行中 · 端口 ${port}`,
        };
      }
      return {
        id: 'proxy-health',
        title: 'DongCC 代理服务',
        level: 'fail',
        problem: '/health 返回 running=false',
        fix: '请点击 开始服务',
      };
    } catch (e: any) {
      const msg = e?.message || String(e);
      const isAbort = e?.name === 'AbortError';
      return {
        id: 'proxy-health',
        title: 'DongCC 代理服务',
        level: 'fail',
        problem: isAbort ? `连接 ${url} 超时` : `无法连接 ${url}：${msg}`,
        fix: '请确认 DongCC 服务已启动，或端口配置是否正确',
      };
    }
  }

  private async checkShellRc(clientType: 'claude' | 'codex'): Promise<CheckItem> {
    const home = os.homedir();
    const candidates = ['.zshrc', '.zprofile', '.bashrc', '.bash_profile', '.profile'];
    const targetVars = clientType === 'claude'
      ? ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']
      : ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];

    const conflicts: { file: string; line: number; raw: string; varName: string }[] = [];

    for (const fname of candidates) {
      const fpath = path.join(home, fname);
      if (!await this.fileExists(fpath)) continue;
      try {
        const content = await readFile(fpath, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((rawLine, idx) => {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) return;
          // export FOO=... or FOO=...
          const m = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/);
          if (!m) return;
          const v = m[1];
          if (targetVars.includes(v)) {
            conflicts.push({ file: fpath, line: idx + 1, raw: rawLine, varName: v });
          }
        });
      } catch {
        // ignore unreadable rc files
      }
    }

    if (conflicts.length === 0) {
      return {
        id: 'shell-rc',
        title: 'Shell 环境变量',
        level: 'pass',
        detail: clientType === 'claude'
          ? '~/.zshrc 等文件未发现 ANTHROPIC_* 变量冲突'
          : '~/.zshrc 等文件未发现 OPENAI_* 变量冲突',
      };
    }

    // 整合修复建议
    const lines = conflicts.map(c => `${c.file}:${c.line}  →  ${c.raw.trim()}`);
    const editFixes = Array.from(new Set(conflicts.map(c => `编辑 ${c.file}：注释或删除第 ${c.line} 行（${c.varName}）`)));
    const unsetCmds = Array.from(new Set(conflicts.map(c => `unset ${c.varName}`))).join(' && ');

    // claude tab 下这些变量会**覆盖** settings.json 里的 env，必须 fail
    // codex tab 下我们用 experimental_bearer_token 直存 toml，OPENAI_API_KEY 不影响认证，仅 warn
    const level: CheckLevel = clientType === 'claude' ? 'fail' : 'warn';

    return {
      id: 'shell-rc',
      title: 'Shell 环境变量',
      level,
      problem: clientType === 'claude'
        ? `发现 ${conflicts.length} 处与 DongCC 冲突的环境变量，会覆盖 settings.json 配置：\n${lines.join('\n')}`
        : `发现 ${conflicts.length} 处 OpenAI 相关 export，DongCC Codex 配置使用 toml 直存 token 不受影响，但若你在终端切到非 DongCC provider 时仍会用到这些变量：\n${lines.join('\n')}`,
      fix: [
        '永久解决：',
        ...editFixes,
        '',
        '当前终端临时清除（仅本次会话有效）：',
        unsetCmds,
        '',
        '修改 rc 文件后请新开终端窗口生效',
      ].join('\n'),
    };
  }

  private async checkClaudeConfigFile(port: number, apiKey: string): Promise<CheckItem> {
    const configPath = path.join(os.homedir(), '.claude', 'settings.json');

    if (!await this.fileExists(configPath)) {
      return {
        id: 'config-file',
        title: 'Claude settings.json',
        level: 'fail',
        problem: `${configPath} 不存在`,
        fix: '请先点 开始服务（自动创建写入），或手动启动一次 DongCC 代理',
      };
    }

    // 读写权限
    try {
      fs.accessSync(configPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return {
        id: 'config-file',
        title: 'Claude settings.json',
        level: 'fail',
        problem: `无读写权限：${configPath}`,
        fix: `sudo chown $(whoami) ${configPath} && chmod 644 ${configPath}`,
      };
    }

    let cfg: any;
    try {
      cfg = JSON.parse(await readFile(configPath, 'utf-8'));
    } catch (e: any) {
      return {
        id: 'config-file',
        title: 'Claude settings.json',
        level: 'fail',
        problem: `JSON 解析失败：${e.message}`,
        fix: `请打开 ${configPath} 手动检查并修复 JSON 语法`,
      };
    }

    const env = cfg.env || {};
    const expectedBaseUrl = `http://127.0.0.1:${port}`;
    const issues: string[] = [];
    if (env.ANTHROPIC_BASE_URL !== expectedBaseUrl) {
      issues.push(`ANTHROPIC_BASE_URL 应为 ${expectedBaseUrl}，当前为 ${env.ANTHROPIC_BASE_URL || '未设置'}`);
    }
    if (!env.ANTHROPIC_AUTH_TOKEN) {
      issues.push('ANTHROPIC_AUTH_TOKEN 为空');
    } else if (apiKey && env.ANTHROPIC_AUTH_TOKEN !== apiKey) {
      issues.push('ANTHROPIC_AUTH_TOKEN 与当前 DongCC 配置的 API Key 不一致');
    }

    if (issues.length === 0) {
      return {
        id: 'config-file',
        title: 'Claude settings.json',
        level: 'pass',
        detail: `${configPath} · 已指向 ${expectedBaseUrl}`,
      };
    }
    return {
      id: 'config-file',
      title: 'Claude settings.json',
      level: 'fail',
      problem: issues.join('；'),
      fix: '请重启 DongCC 服务（停止后再开始）以重新写入正确的配置',
    };
  }

  private async checkCodexConfigFile(
    port: number,
    apiKey: string,
    apiFormat: 'chat-completions' | 'responses' | 'anthropic'
  ): Promise<CheckItem> {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    if (apiFormat === 'anthropic') {
      return {
        id: 'config-file',
        title: 'Codex config.toml',
        level: 'fail',
        problem: 'Codex 不支持 Anthropic 协议',
        fix: '在 Codex Tab 选择 chat-completions 或 responses 协议格式',
      };
    }

    if (!await this.fileExists(configPath)) {
      return {
        id: 'config-file',
        title: 'Codex config.toml',
        level: 'fail',
        problem: `${configPath} 不存在`,
        fix: '请点 开始服务（DongCC 会自动写入 ~/.codex/config.toml）',
      };
    }

    try {
      fs.accessSync(configPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return {
        id: 'config-file',
        title: 'Codex config.toml',
        level: 'fail',
        problem: `无读写权限：${configPath}`,
        fix: `sudo chown $(whoami) ${configPath} && chmod 644 ${configPath}`,
      };
    }

    let toml: any;
    try {
      const content = await readFile(configPath, 'utf-8');
      toml = TOML.parse(content);
    } catch (e: any) {
      return {
        id: 'config-file',
        title: 'Codex config.toml',
        level: 'fail',
        problem: `TOML 解析失败：${e.message}`,
        fix: `请打开 ${configPath} 手动检查并修复 TOML 语法`,
      };
    }

    const issues: string[] = [];
    if (toml.model_provider !== 'dongcc') {
      issues.push(`model_provider 应为 "dongcc"，当前为 ${toml.model_provider || '未设置'}`);
    }
    const dongcc = toml.model_providers?.dongcc;
    if (!dongcc) {
      issues.push('[model_providers.dongcc] 未定义');
    } else {
      const expectedBase = `http://127.0.0.1:${port}/v1`;
      if (dongcc.base_url !== expectedBase) {
        issues.push(`model_providers.dongcc.base_url 应为 ${expectedBase}，当前为 ${dongcc.base_url || '未设置'}`);
      }
      const expectedWire = 'responses';
      if (dongcc.wire_api !== expectedWire) {
        issues.push(`model_providers.dongcc.wire_api 应为 "${expectedWire}"，当前为 ${dongcc.wire_api || '未设置'}（Codex CLI 已不再支持 "chat"，请重启 DongCC 服务重写配置）`);
      }
      if (!dongcc.experimental_bearer_token) {
        issues.push('experimental_bearer_token 为空');
      } else if (apiKey && dongcc.experimental_bearer_token !== apiKey) {
        issues.push('experimental_bearer_token 与当前 DongCC 配置的 API Key 不一致');
      }
    }

    if (issues.length === 0) {
      return {
        id: 'config-file',
        title: 'Codex config.toml',
        level: 'pass',
        detail: `${configPath} · model_provider=dongcc · wire_api=${dongcc?.wire_api}`,
      };
    }
    return {
      id: 'config-file',
      title: 'Codex config.toml',
      level: 'fail',
      problem: issues.join('；'),
      fix: '请重启 DongCC 服务（停止后再开始）以重新写入正确的配置',
    };
  }

  private async checkUpstream(cfg: {
    apiKey: string;
    baseUrl: string;
    apiFormat: 'chat-completions' | 'responses' | 'anthropic';
  }): Promise<CheckItem> {
    if (!cfg.baseUrl) {
      return { id: 'upstream', title: '上游连通性', level: 'fail', problem: 'baseUrl 为空', fix: '在「高级设置」中填写 baseUrl，或选择一个预设默认模型自动填充' };
    }
    if (!cfg.apiKey) {
      return { id: 'upstream', title: '上游连通性', level: 'fail', problem: 'API Key 为空', fix: '在 Tab 顶部填写 API Key' };
    }

    const baseTrim = cfg.baseUrl.replace(/\/$/, '');

    try {
      const parsed = new URL(baseTrim);
      const mod = parsed.protocol === 'https:' ? require('https') : require('http');
      const port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);

      // TCP + HTTP HEAD 测试：只测网络可达性，不依赖特定端点
      const statusCode = await new Promise<number>((resolve, reject) => {
        const req = mod.request({
          method: 'HEAD',
          hostname: parsed.hostname,
          port,
          path: parsed.pathname || '/',
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          timeout: 5000,
          lookup: customDnsLookup as any,
        }, (res: any) => {
          resolve(res.statusCode);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.end();
      });

      // 任何 HTTP 响应都说明网络可达
      if (statusCode === 401 || statusCode === 403) {
        return { id: 'upstream', title: '上游连通性', level: 'fail', problem: `网络可达，但 API Key 鉴权失败（HTTP ${statusCode}）`, fix: '请到对应平台重新申请或确认 API Key 是否过期/无权限' };
      }
      return { id: 'upstream', title: '上游连通性', level: 'pass', detail: `${baseTrim} 网络可达` };
    } catch (e: any) {
      const code = e?.code || '';
      if (e?.message === 'timeout') {
        return { id: 'upstream', title: '上游连通性', level: 'fail', problem: `请求 ${baseTrim} 超时（5s）`, fix: '请检查是否在内网环境（llm-gw.jd.local 等内网域名需要 VPN/办公网络）' };
      }
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return { id: 'upstream', title: '上游连通性', level: 'fail', problem: `DNS 解析失败：${cfg.baseUrl}`, fix: '请检查 baseUrl 拼写，或确认是否需要连接内网（VPN）' };
      }
      if (code === 'ECONNREFUSED') {
        return { id: 'upstream', title: '上游连通性', level: 'fail', problem: `${cfg.baseUrl} 拒绝连接`, fix: '上游服务可能未运行，或 baseUrl 端口配置错误' };
      }
      return { id: 'upstream', title: '上游连通性', level: 'fail', problem: `请求 ${baseTrim} 失败：${e?.message || String(e)}`, fix: '请检查网络连接或 baseUrl 是否正确' };
    }
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code === 'EEXIST') return;
      if (error.code === 'EACCES') {
        throw new Error(
          `无权限创建目录 ${dirPath}，请在终端执行: sudo chown $(whoami) ${path.dirname(dirPath)} && chmod 755 ${dirPath} 后重试`
        );
      }
      throw error;
    }
  }
}
