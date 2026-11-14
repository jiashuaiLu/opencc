// 预置 skill:随 dongcc 打包(resources/skills/),启动 claude/codex 服务时自动装入用户 skill 目录。
// 落地方式:符号链接优先(Windows 用 junction 免管理员权限),失败回退目录拷贝。全流程幂等。
// 归属:core 提供通用机制;具体 skill 由 internal 通过 AppOptions.presetSkillProvider 注入。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { skillService, InstalledSkill } from './skillService';
import type { DatabaseManager } from '../database';

export interface PresetSkillSpec {
  id: string;            // 稳定 id,建议 'preset:<directory>'
  directory: string;     // skill 目录名(= resources/skills 下的子目录名)
  name: string;
  description?: string;
  apps?: { claude?: boolean; codex?: boolean; opencode?: boolean };
}

type LogFn = (msg: string) => void;

/**
 * 各端"用户级 skill 目录"解析器。新增一端只需在此加一行。
 * 返回值经 path.resolve 去重后逐一投放(不同端指向同一目录时只链接一次)。
 * - claude:   ~/.claude/skills(可被安装目录设置覆盖)
 * - codex:    ~/.agents/skills(通用 Agent Skills 规范,Codex 官方推荐位)
 * - opencode: 复用 ~/.agents/skills —— OpenCode 会自动搜索 .agents/skills(及 .claude/skills),
 *             故无需投到其原生 ~/.config/opencode/skills;去重后与 codex 共用一条链接,
 *             也避免 o2 出现在多目录被 OpenCode 重复发现。
 */
const APP_SKILL_DIRS: Record<string, () => string> = {
  claude: () => skillService.getClaudeSkillsDir(),
  codex: () => path.join(os.homedir(), '.agents', 'skills'),
  opencode: () => path.join(os.homedir(), '.agents', 'skills'),
};

/**
 * 解析打包后的预置 skill 源目录。
 * 优先 process.resourcesPath/skills/<dir>(打包环境),dev 回退到仓库 resources/skills/<dir>。
 * 以是否存在 SKILL.md 作为有效性守卫。
 */
export function resolvePresetSourceDir(directory: string): string | null {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, 'skills', directory) : '',
    path.join(process.cwd(), 'resources', 'skills', directory),                 // dev:仓库根
    path.join(__dirname, '..', '..', '..', '..', 'resources', 'skills', directory), // dist/core/main/skills → 根
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'SKILL.md'))) return c;
  }
  return null;
}

/** dest 是否已是指向 expectedTarget 的 symlink/junction(两侧都过 realpath 归一,Windows 忽略大小写)。 */
function isLinkTo(dest: string, expectedTarget: string): boolean {
  try {
    if (!fs.lstatSync(dest).isSymbolicLink()) return false;
    const norm = (p: string) => {
      const real = fs.realpathSync(p);
      return process.platform === 'win32' ? path.resolve(real).toLowerCase() : path.resolve(real);
    };
    return norm(dest) === norm(expectedTarget);
  } catch {
    return false;
  }
}

/** 删除已存在的 dest:symlink 用 unlink(不动目标),真实目录用 rm -rf。 */
function removeExisting(dest: string): void {
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) fs.unlinkSync(dest);
    else fs.rmSync(dest, { recursive: true, force: true });
  } catch {
    /* dest 不存在,忽略 */
  }
}

/**
 * 把 src 目录暴露到 dest:符号链接优先(win=junction 免权限),失败回退拷贝。幂等。
 * 返回本次动作,便于日志/测试。
 */
export async function linkOrCopyDir(
  src: string,
  dest: string,
  log?: LogFn,
): Promise<'linked' | 'copied' | 'exists'> {
  if (isLinkTo(dest, src)) return 'exists';
  removeExisting(dest);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.symlinkSync(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
    log?.(`[预置Skill] 已链接 ${path.basename(dest)}`);
    return 'linked';
  } catch (e: any) {
    log?.(`[预置Skill] 链接失败(${e.code || e.message}),回退拷贝 ${path.basename(dest)}`);
    await skillService.copyDirectory(src, dest);
    return 'copied';
  }
}

/** SSOT 是否需要从打包源刷新(以 SKILL.md 内容为准,缺失或不同即刷新)。 */
function needsRefresh(src: string, ssotDir: string): boolean {
  const b = path.join(ssotDir, 'SKILL.md');
  if (!fs.existsSync(b)) return true;
  try {
    return fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8') !== fs.readFileSync(b, 'utf8');
  } catch {
    return true;
  }
}

/**
 * 确保所有预置 skill 就绪。幂等,可在每次服务启动时调用。
 * 流程(每个 spec):打包源 →(内容变化才)刷新 SSOT ~/.dongcc/skills/<dir>
 *   → 链接/拷贝到 ~/.claude/skills/<dir> → DB upsert(保留用户开关,标记 preset)。
 */
export async function installPresetSkills(
  specs: PresetSkillSpec[] | undefined,
  database: DatabaseManager,
  log?: LogFn,
): Promise<void> {
  if (!specs || specs.length === 0) return;
  await skillService.initialize();
  const ssotRoot = skillService.getSSOTDir();
  const existing = await database.getSkills();

  let ready = 0;
  for (const spec of specs) {
    try {
      if (spec.directory.includes('..') || path.isAbsolute(spec.directory)) {
        log?.(`[预置Skill] 非法目录名,跳过: ${spec.directory}`);
        continue;
      }
      const src = resolvePresetSourceDir(spec.directory);
      if (!src) {
        log?.(`[预置Skill] 未找到打包资源,跳过: ${spec.directory}`);
        continue;
      }

      // 1. 刷新 SSOT(稳定副本,symlink 指向它而非会被更新替换的应用安装目录)
      const ssotDir = path.join(ssotRoot, spec.directory);
      if (needsRefresh(src, ssotDir)) {
        await skillService.copyDirectory(src, ssotDir);
        log?.(`[预置Skill] 已更新本地副本 ${spec.directory}`);
      }

      // 2. 按 apps 投放到各端用户级 skill 目录(经 APP_SKILL_DIRS 解析并去重)。
      //    路径都基于 os.homedir(),Mac/Windows 自动适配,无需分支。
      const apps = spec.apps ?? { claude: true };
      const dirs = new Set<string>();
      for (const [app, on] of Object.entries(apps)) {
        if (!on) continue;
        const resolver = APP_SKILL_DIRS[app];
        if (resolver) dirs.add(path.resolve(resolver()));
        else log?.(`[预置Skill] 未知目标端 "${app}",跳过`);
      }
      for (const baseDir of dirs) {
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
        await linkOrCopyDir(ssotDir, path.join(baseDir, spec.directory), log);
      }

      // 3. DB upsert:保留用户对该 skill 的开关(apps.claude),标记为预置。
      //    (DB 的 SkillApps 目前只跟踪 claude;codex/opencode 投放由文件系统 + spec 决定,不入 DB)
      const prev = existing.find((s) => s.id === spec.id);
      const record: InstalledSkill = {
        id: spec.id,
        name: spec.name || prev?.name || spec.directory,
        description: spec.description ?? prev?.description,
        directory: spec.directory,
        apps: { claude: prev?.apps?.claude ?? (spec.apps?.claude ?? true) },
        installedAt: prev?.installedAt ?? Math.floor(Date.now() / 1000),
        sourceType: 'global',
        preset: true,
      };
      await database.saveSkill(record);
      ready++;
    } catch (e: any) {
      log?.(`[预置Skill] 安装 ${spec.directory} 失败: ${e.message}`);
    }
  }
  if (ready > 0) log?.(`[预置Skill] ${ready} 个预置 Skill 已就绪`);
}
