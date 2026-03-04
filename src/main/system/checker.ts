import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

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
  
  for (const dir of paths) {
    const fullPath = path.join(dir, executable);
    try {
      if (fs.existsSync(fullPath)) {
        console.log(`[FindExecutable] Found ${executable} at: ${fullPath}`);
        return fullPath;
      }
    } catch (error) {
      // Ignore errors
    }
  }
  
  console.log(`[FindExecutable] ${executable} not found in PATH`);
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

export class SystemChecker {
  // 检查 Claude Code 是否安装
  async checkClaudeCode(): Promise<CheckResult> {
    console.log('[CheckClaudeCode] Starting check...');
    
    try {
      const { env, shell } = getShellEnv();
      
      // 方法1: 使用 which 命令
      try {
        const { stdout } = await execAsync('which claude', { 
          env,
          shell 
        });
        const claudePath = stdout.trim();

        if (claudePath) {
          console.log('[CheckClaudeCode] Found via which:', claudePath);
          
          try {
            const { stdout: versionOutput } = await execAsync('claude --version', { 
              env,
              shell 
            });
            const version = versionOutput.trim();

            return {
              installed: true,
              version,
              path: claudePath,
              valid: true,
            };
          } catch (versionError: any) {
            console.error('[CheckClaudeCode] Failed to get version:', versionError.message);
            return {
              installed: true,
              path: claudePath,
              valid: false,
              message: 'Claude Code 已安装，但无法获取版本信息',
            };
          }
        }
      } catch (whichError: any) {
        console.error('[CheckClaudeCode] which command failed:', whichError.message);
      }
      
      // 方法2: 直接在 PATH 中查找
      const claudePath = findExecutableInPath('claude', env);
      if (claudePath) {
        console.log('[CheckClaudeCode] Found via direct search:', claudePath);
        return {
          installed: true,
          path: claudePath,
          valid: true,
          message: 'Claude Code 已安装',
        };
      }
      
      console.log('[CheckClaudeCode] Claude Code not found');
      return {
        installed: false,
        message: 'Claude Code 未安装',
      };
    } catch (error: any) {
      console.error('[CheckClaudeCode] Check failed:', error.message);
      return {
        installed: false,
        message: 'Claude Code 未安装',
      };
    }
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
    defaultModel?: string
  ): Promise<void> {
    const configPath = path.join(os.homedir(), '.claude', 'settings.json');
    const configDir = path.dirname(configPath);

    await this.ensureDir(configDir);

    const settings: any = {
      env: {
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_BASE_URL: `http://localhost:${port}`,
      },
    };

    // 如果有模型配置，添加到配置文件（使用官方标准格式）
    if (models && models.length > 0) {
      settings.llm = {
        defaultModel: defaultModel 
          ? models.find(m => m.id === defaultModel)?.modelId || models[0].modelId
          : models[0].modelId,
        models: models.map(m => ({
          modelId: m.modelId,
          displayName: m.name,
          provider: 'openai',
          apiEndpoint: `http://localhost:${port}/v1`,
          apiKey: apiKey,
          isEnabled: true,
          parameters: {},
        })),
      };
    }

    await writeFile(configPath, JSON.stringify(settings, null, 2), 'utf-8');
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
          // 只删除代理相关的配置，保留模型配置
          delete config.env.ANTHROPIC_AUTH_TOKEN;
          delete config.env.ANTHROPIC_BASE_URL;
          delete config.env.ANTHROPIC_API_KEY;
        }
        
        // 保留 llm 配置（模型列表和默认模型）
        
        await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      }
    } catch (error) {
      console.error('Failed to restore Claude config:', error);
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

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
