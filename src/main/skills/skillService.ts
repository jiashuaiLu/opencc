import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

export interface SkillApps {
  claude: boolean;
}

export interface InstalledSkill {
  id: string;
  name: string;
  description?: string;
  directory: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  apps: SkillApps;
  installedAt: number;
  sourceType: 'global' | 'project';
  sourceProject?: string;
  preset?: boolean;   // 预置 skill(随 dongcc 打包,启动服务时自动装入),UI 禁止删除
}

export interface SkillRepo {
  owner: string;
  name: string;
  branch: string;
  enabled: boolean;
}

export interface UnmanagedSkill {
  directory: string;
  name: string;
  description?: string;
  path: string;
  sourceType: 'global' | 'project';
  sourceProject?: string;
  foundIn: string[];
}

export interface DiscoverableSkill {
  key: string;
  name: string;
  description: string;
  directory: string;
  readmeUrl?: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
}

export interface SkillMetadata {
  name?: string;
  description?: string;
}

export interface ProjectInfo {
  path: string;
  name: string;
  hasSkills: boolean;
}

const defaultRepos: SkillRepo[] = [
  {
    owner: 'anthropics',
    name: 'skills',
    branch: 'main',
    enabled: true,
  },
  {
    owner: 'ComposioHQ',
    name: 'awesome-claude-skills',
    branch: 'main',
    enabled: true,
  },
];

export interface CommunitySkill {
  id: string;
  name: string;
  description: string;
  author: string;
  authorName?: string;
  authorDepartment?: string;
  authorOrgFullPath?: string;
  authorPosition?: string;
  domain: string;
  tags: string[];
  npmPackage: string;
  installCommand: string;
  downloadCount: number;
  star: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommunitySkillQuery {
  keyword?: string;
  tags?: string;
  domain?: string;
  department?: string;
  sortBy?: 'latest' | 'star' | 'download';
  page?: number;
  pageSize?: number;
}

export interface CommunitySkillListResult {
  total: number;
  page: number;
  pageSize: number;
  list: CommunitySkill[];
}

export interface SetInstallDirResult {
  success?: boolean;
  error?: 'INVALID_PATH' | 'NOT_EXISTS' | 'PERMISSION_DENIED';
  message?: string;
}

export class SkillService {
  private claudeConfigPath: string;
  private ssotDir: string;
  private reposPath: string;
  private claudeProjectsDir: string;
  private skillConfigPath: string;
  private customClaudeSkillsDir: string | null = null;

  constructor() {
    this.claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');
    this.ssotDir = path.join(os.homedir(), '.dongcc', 'skills');
    this.reposPath = path.join(os.homedir(), '.dongcc', 'skill-repos.json');
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    this.skillConfigPath = path.join(os.homedir(), '.dongcc', 'skill-config.json');
    this.loadSkillConfig();
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.ssotDir)) {
      await mkdir(this.ssotDir, { recursive: true });
    }
  }

  getSSOTDir(): string {
    return this.ssotDir;
  }

  getClaudeSkillsDir(): string {
    return this.customClaudeSkillsDir || path.join(os.homedir(), '.claude', 'skills');
  }

  setClaudeSkillsDir(dir: string): void {
    this.customClaudeSkillsDir = dir;
    this.saveSkillConfig();
  }

  resetClaudeSkillsDir(): void {
    this.customClaudeSkillsDir = null;
    this.saveSkillConfig();
  }

  validateInstallDir(dir: string): SetInstallDirResult {
    if (!dir || dir.trim() === '') {
      return { error: 'INVALID_PATH', message: '路径不能为空，请重新输入' };
    }

    const trimmed = dir.trim();

    if (trimmed.includes('\0') || trimmed.includes('..')) {
      return { error: 'INVALID_PATH', message: '路径包含非法字符，请重新输入' };
    }

    if (!path.isAbsolute(trimmed)) {
      return { error: 'INVALID_PATH', message: '请输入绝对路径，例如 /Users/xxx/skills' };
    }

    if (!fs.existsSync(trimmed)) {
      return { error: 'NOT_EXISTS', message: '目录不存在，请检查路径后重新输入' };
    }

    try {
      fs.accessSync(trimmed, fs.constants.W_OK);
    } catch {
      return { error: 'PERMISSION_DENIED', message: `权限不足，请执行: sudo chown $(whoami) ${trimmed}` };
    }

    return { success: true };
  }

  private loadSkillConfig(): void {
    try {
      if (fs.existsSync(this.skillConfigPath)) {
        const content = fs.readFileSync(this.skillConfigPath, 'utf-8');
        const config = JSON.parse(content);
        if (config.installDir && typeof config.installDir === 'string') {
          this.customClaudeSkillsDir = config.installDir;
        }
      }
    } catch (error) {
      console.error('[Skills] Failed to load skill config:', error);
    }
  }

  private saveSkillConfig(): void {
    try {
      const dir = path.dirname(this.skillConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const config = this.customClaudeSkillsDir
        ? { installDir: this.customClaudeSkillsDir }
        : {};
      fs.writeFileSync(this.skillConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Skills] Failed to save skill config:', error);
    }
  }

  getClaudeProjectsDir(): string {
    return this.claudeProjectsDir;
  }

  async getRepos(): Promise<SkillRepo[]> {
    try {
      if (fs.existsSync(this.reposPath)) {
        const content = await readFile(this.reposPath, 'utf-8');
        const repos = JSON.parse(content);
        return this.mergeWithDefaultRepos(repos);
      }
    } catch (error) {
      console.error('[Skills] Failed to load repos:', error);
    }
    return defaultRepos;
  }

  private mergeWithDefaultRepos(savedRepos: SkillRepo[]): SkillRepo[] {
    const merged = [...savedRepos];

    for (const defaultRepo of defaultRepos) {
      const exists = merged.some(
        r => r.owner === defaultRepo.owner && r.name === defaultRepo.name
      );
      if (!exists) {
        merged.push(defaultRepo);
      }
    }

    return merged;
  }

  async saveRepo(repo: SkillRepo): Promise<void> {
    const repos = await this.getRepos();
    const index = repos.findIndex(r => r.owner === repo.owner && r.name === repo.name);
    if (index >= 0) {
      repos[index] = repo;
    } else {
      repos.push(repo);
    }
    await writeFile(this.reposPath, JSON.stringify(repos, null, 2), 'utf-8');
  }

  async deleteRepo(owner: string, name: string): Promise<void> {
    const repos = await this.getRepos();
    const filtered = repos.filter(r => !(r.owner === owner && r.name === name));
    await writeFile(this.reposPath, JSON.stringify(filtered, null, 2), 'utf-8');
  }

  async syncToClaude(skill: InstalledSkill): Promise<void> {
    if (!skill.apps.claude) {
      return;
    }

    if (skill.directory.includes('..') || path.isAbsolute(skill.directory)) {
      console.error(`[Skills] Rejected unsafe directory: ${skill.directory}`);
      return;
    }

    await this.initialize();

    const sourceDir = path.join(this.ssotDir, skill.directory);
    const claudeSkillsDir = this.getClaudeSkillsDir();
    const destDir = path.join(claudeSkillsDir, skill.directory);

    if (!fs.existsSync(sourceDir)) {
      console.warn(`[Skills] Source not found, skip sync: ${skill.directory}`);
      return;
    }

    if (!fs.existsSync(claudeSkillsDir)) {
      await mkdir(claudeSkillsDir, { recursive: true });
    }

    await this.copyDir(sourceDir, destDir);
    console.log(`[Skills] Synced to Claude: ${skill.name}`);
  }

  async removeFromClaude(directory: string): Promise<void> {
    if (directory.includes('..') || path.isAbsolute(directory)) {
      console.error(`[Skills] Rejected unsafe directory: ${directory}`);
      return;
    }

    const claudeSkillsDir = this.getClaudeSkillsDir();
    const destDir = path.join(claudeSkillsDir, directory);

    if (fs.existsSync(destDir)) {
      await this.removeDir(destDir);
      console.log(`[Skills] Removed from Claude: ${directory}`);
    }
  }

  /** 供预置 skill 等外部复用的目录拷贝(递归、跳过 node_modules/.git 等)。 */
  async copyDirectory(src: string, dest: string): Promise<void> {
    return this.copyDir(src, dest);
  }

  private async copyDir(src: string, dest: string): Promise<void> {
    if (fs.existsSync(dest)) {
      await this.removeDir(dest);
    }
    await mkdir(dest, { recursive: true });

    const SKIP_DIRS = new Set(['node_modules', '.git', '.DS_Store', '.cache', '.claude', 'dist', 'build']);
    const entries = await readdir(src);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const stats = await stat(srcPath);

      if (stats.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }

  private async removeDir(dir: string): Promise<void> {
    if (fs.existsSync(dir)) {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  }

  parseSkillMetadata(content: string): SkillMetadata {
    const trimmed = content.trim().replace(/^\uFEFF/, '');
    const parts = trimmed.split('---');

    if (parts.length < 3) {
      return { name: undefined, description: undefined };
    }

    const frontMatter = parts[1].trim();
    try {
      const yaml = this.parseSimpleYaml(frontMatter);
      return {
        name: yaml.name,
        description: yaml.description,
      };
    } catch {
      return { name: undefined, description: undefined };
    }
  }

  private parseSimpleYaml(yaml: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let currentValue = '';
    let inMultiline = false;

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0 && !inMultiline) {
        if (currentKey) {
          result[currentKey] = currentValue.trim();
        }
        currentKey = line.slice(0, colonIndex).trim();
        currentValue = line.slice(colonIndex + 1).trim();
        if (currentValue.startsWith('|') || currentValue.startsWith('>')) {
          inMultiline = true;
          currentValue = '';
        }
      } else if (inMultiline) {
        if (line.startsWith('  ') || line.startsWith('\t')) {
          currentValue += (currentValue ? '\n' : '') + line.trim();
        } else {
          inMultiline = false;
          result[currentKey] = currentValue.trim();
          const newColonIndex = line.indexOf(':');
          if (newColonIndex > 0) {
            currentKey = line.slice(0, newColonIndex).trim();
            currentValue = line.slice(newColonIndex + 1).trim();
            if (currentValue.startsWith('|') || currentValue.startsWith('>')) {
              inMultiline = true;
              currentValue = '';
            }
          } else {
            currentKey = '';
            currentValue = '';
          }
        }
      }
    }

    if (currentKey) {
      result[currentKey] = currentValue.trim();
    }

    return result;
  }

  async readSkillFromDir(dir: string): Promise<{ name: string; description?: string } | null> {
    const skillMd = path.join(dir, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      const content = await readFile(skillMd, 'utf-8');
      const meta = this.parseSkillMetadata(content);
      return {
        name: meta.name || path.basename(dir),
        description: meta.description,
      };
    }
    return null;
  }

  async listProjectsWithSkills(): Promise<ProjectInfo[]> {
    const projects: ProjectInfo[] = [];

    if (!fs.existsSync(this.claudeProjectsDir)) {
      return projects;
    }

    const projectDirs = await readdir(this.claudeProjectsDir);
    for (const projectDir of projectDirs) {
      const projectPath = path.join(this.claudeProjectsDir, projectDir);
      const stats = await stat(projectPath);
      if (!stats.isDirectory()) continue;

      const skillsDir = path.join(projectPath, 'skills');
      if (fs.existsSync(skillsDir)) {
        const skillEntries = await readdir(skillsDir);
        const hasSkills = skillEntries.some(e => {
          const skillPath = path.join(skillsDir, e);
          return fs.statSync(skillPath).isDirectory() && fs.existsSync(path.join(skillPath, 'SKILL.md'));
        });

        if (hasSkills) {
          projects.push({
            path: this.decodeProjectPath(projectDir),
            name: path.basename(this.decodeProjectPath(projectDir)),
            hasSkills: true,
          });
        }
      }
    }

    return projects;
  }

  private decodeProjectPath(encodedPath: string): string {
    return encodedPath.replace(/-/g, '/');
  }

  private encodeProjectPath(projectPath: string): string {
    return projectPath.replace(/\//g, '-');
  }

  async scanUnmanagedSkills(installedSkills: InstalledSkill[]): Promise<UnmanagedSkill[]> {
    const installedDirs = new Set(installedSkills.map(s => s.directory));
    const unmanaged: UnmanagedSkill[] = [];
    const claudeSkillsDir = this.getClaudeSkillsDir();

    if (!fs.existsSync(claudeSkillsDir)) {
      return unmanaged;
    }

    const entries = await readdir(claudeSkillsDir);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      if (installedDirs.has(entry)) continue;

      const fullPath = path.join(claudeSkillsDir, entry);
      let stats;
      try {
        stats = await stat(fullPath);
      } catch {
        continue;
      }
      if (!stats.isDirectory()) continue;

      const skillMd = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        const info = await this.readSkillFromDir(fullPath);
        if (info) {
          unmanaged.push({
            directory: entry,
            name: info.name,
            description: info.description,
            path: fullPath,
            sourceType: 'global',
            foundIn: ['claude'],
          });
        }
      }
    }

    console.log(`[Skills] Unmanaged skills found: ${unmanaged.length}`);
    return unmanaged;
  }

  async importSkill(directory: string, currentApp: 'claude' = 'claude'): Promise<InstalledSkill | null> {
    await this.initialize();

    const claudeSkillsDir = this.getClaudeSkillsDir();
    const sourceDir = path.join(claudeSkillsDir, directory);

    if (!fs.existsSync(sourceDir)) {
      console.error(`[Skills] Source directory not found: ${sourceDir}`);
      return null;
    }

    const destDir = path.join(this.ssotDir, directory);
    if (!fs.existsSync(destDir)) {
      await this.copyDir(sourceDir, destDir);
    }

    const info = await this.readSkillFromDir(sourceDir);
    const skill: InstalledSkill = {
      id: `local:${directory}`,
      name: info?.name || directory,
      description: info?.description,
      directory,
      apps: { claude: true },
      installedAt: Math.floor(Date.now() / 1000),
      sourceType: 'global',
    };

    return skill;
  }

  async importSkillFromPath(sourcePath: string, sourceType: 'global' | 'project', sourceProject?: string): Promise<InstalledSkill | null> {
    await this.initialize();

    const directory = path.basename(sourcePath);

    if (!fs.existsSync(sourcePath)) {
      console.error(`[Skills] Source directory not found: ${sourcePath}`);
      return null;
    }

    const destDir = path.join(this.ssotDir, directory);
    await this.copyDir(sourcePath, destDir);

    const info = await this.readSkillFromDir(sourcePath);
    const skill: InstalledSkill = {
      id: sourceProject ? `project:${sourceProject}:${directory}` : `local:${directory}`,
      name: info?.name || directory,
      description: info?.description,
      directory,
      apps: { claude: true },
      installedAt: Math.floor(Date.now() / 1000),
      sourceType,
      sourceProject,
    };

    return skill;
  }



  async uninstallSkill(skill: InstalledSkill): Promise<void> {
    if (skill.apps.claude) {
      await this.removeFromClaude(skill.directory);
    }

    const ssotPath = path.join(this.ssotDir, skill.directory);
    if (fs.existsSync(ssotPath)) {
      await this.removeDir(ssotPath);
    }
  }

  async scanCustomProjectPath(projectPath: string): Promise<UnmanagedSkill[]> {
    const unmanaged: UnmanagedSkill[] = [];

    if (!fs.existsSync(projectPath)) {
      return unmanaged;
    }

    const scanSkillsDir = async (skillsDir: string, sourceProject: string) => {
      if (!fs.existsSync(skillsDir)) {
        return;
      }

      const entries = await readdir(skillsDir);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;

        const fullPath = path.join(skillsDir, entry);
        let stats;
        try {
          stats = await stat(fullPath);
        } catch {
          continue;
        }
        if (!stats.isDirectory()) continue;

        const skillMd = path.join(fullPath, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const info = await this.readSkillFromDir(fullPath);
          if (info) {
            unmanaged.push({
              directory: entry,
              name: info.name,
              description: info.description,
              path: fullPath,
              sourceType: 'project',
              sourceProject: sourceProject,
              foundIn: [sourceProject],
            });
          }
        }
      }
    };

    // Scan all possible skills directories in the project
    await scanSkillsDir(path.join(projectPath, 'skills'), projectPath);
    await scanSkillsDir(path.join(projectPath, '.claude', 'skills'), projectPath);
    await scanSkillsDir(path.join(projectPath, '.claude-plugin', 'skills'), projectPath);

    // 如果以上子目录都没找到 skill，直接扫描用户指定的路径本身
    // （用户可能直接指向了一个 skills 目录，里面直接包含 skill 子文件夹）
    if (unmanaged.length === 0) {
      await scanSkillsDir(projectPath, projectPath);
    }

    return unmanaged;
  }

  getSkillDirectory(skill: InstalledSkill): string {
    const ssotPath = path.join(this.ssotDir, skill.directory);
    if (fs.existsSync(ssotPath)) {
      return ssotPath;
    }

    const claudePath = path.join(this.getClaudeSkillsDir(), skill.directory);
    if (fs.existsSync(claudePath)) {
      return claudePath;
    }

    if (skill.sourceType === 'project' && skill.sourceProject) {
      const encodedPath = this.encodeProjectPath(skill.sourceProject);
      const projectPath = path.join(this.claudeProjectsDir, encodedPath, 'skills', skill.directory);
      if (fs.existsSync(projectPath)) {
        return projectPath;
      }
    }

    return ssotPath;
  }

  skillDirectoryExists(skill: InstalledSkill): boolean {
    const ssotPath = path.join(this.ssotDir, skill.directory);
    if (fs.existsSync(ssotPath)) {
      return true;
    }

    const claudePath = path.join(this.getClaudeSkillsDir(), skill.directory);
    if (fs.existsSync(claudePath)) {
      return true;
    }

    if (skill.sourceType === 'project' && skill.sourceProject) {
      const encodedPath = this.encodeProjectPath(skill.sourceProject);
      const projectPath = path.join(this.claudeProjectsDir, encodedPath, 'skills', skill.directory);
      if (fs.existsSync(projectPath)) {
        return true;
      }
    }

    return false;
  }

  buildSkillDocUrl(owner: string, repo: string, branch: string, docPath: string): string {
    return `https://github.com/${owner}/${repo}/blob/${branch}/${docPath}`;
  }

  async discoverAvailableSkills(repos: SkillRepo[]): Promise<DiscoverableSkill[]> {
    const skills: DiscoverableSkill[] = [];
    const seen = new Set<string>();

    for (const repo of repos) {
      if (!repo.enabled) continue;

      try {
        const repoSkills = await this.fetchSkillsFromGitHubRepo(repo);
        for (const skill of repoSkills) {
          const key = `${skill.directory}:${repo.owner}/${repo.name}`;
          if (!seen.has(key)) {
            seen.add(key);
            skills.push(skill);
          }
        }
      } catch (error) {
        console.error(`[Skills] Failed to fetch skills from repo ${repo.owner}/${repo.name}:`, error);
      }
    }

    return skills;
  }

  private async fetchSkillsFromGitHubRepo(repo: SkillRepo): Promise<DiscoverableSkill[]> {
    const skills: DiscoverableSkill[] = [];
    const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${repo.branch}?recursive=1`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'DongCC-App',
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();
      const skillMdFiles = data.tree.filter((item: any) =>
        item.type === 'blob' && item.path.endsWith('SKILL.md')
      );

      for (const file of skillMdFiles) {
        const skillDir = path.dirname(file.path);
        const skillName = path.basename(skillDir);

        // Fetch SKILL.md content to extract metadata
        const rawUrl = `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.branch}/${file.path}`;
        let skillNameFromMd = skillName;
        let description = '';

        try {
          const contentResponse = await fetch(rawUrl);
          if (contentResponse.ok) {
            const content = await contentResponse.text();
            const metadata = this.parseSkillMetadata(content);
            skillNameFromMd = metadata.name || skillName;
            description = metadata.description || '';
          }
        } catch (error) {
          console.warn(`[Skills] Failed to fetch SKILL.md content for ${skillDir}:`, error);
        }

        skills.push({
          key: `${skillDir}:${repo.owner}/${repo.name}`,
          name: skillNameFromMd,
          description,
          directory: skillDir,
          readmeUrl: this.buildSkillDocUrl(repo.owner, repo.name, repo.branch, file.path),
          repoOwner: repo.owner,
          repoName: repo.name,
          repoBranch: repo.branch,
        });
      }
    } catch (error) {
      console.error(`[Skills] Error fetching from GitHub:`, error);
    }

    return skills;
  }

  async installSkillFromRepo(
    skill: DiscoverableSkill,
    currentApp: 'claude' = 'claude'
  ): Promise<InstalledSkill> {
    await this.initialize();

    // Download skill from GitHub
    const downloadUrl = `https://github.com/${skill.repoOwner}/${skill.repoName}/archive/${skill.repoBranch}.tar.gz`;
    const tempDir = path.join(os.tmpdir(), `dongcc-skill-${Date.now()}`);
    const tempFile = path.join(os.tmpdir(), `skill-${Date.now()}.tar.gz`);

    try {
      // Create temp directory
      await mkdir(tempDir, { recursive: true });

      // Download tarball
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Failed to download skill: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(tempFile, buffer);

      // Extract tarball (simplified - you may want to use a proper tar library)
      const tar = require('tar');
      await tar.extract({
        file: tempFile,
        cwd: tempDir,
      });

      // Find the skill directory
      const repoDirName = `${skill.repoName}-${skill.repoBranch}`;
      const extractedSkillDir = path.join(tempDir, repoDirName, skill.directory);

      if (!fs.existsSync(extractedSkillDir)) {
        throw new Error(`Skill directory not found: ${skill.directory}`);
      }

      // Use basename only to avoid nested "skills/skills/..." paths
      const installDir = path.basename(skill.directory);

      // Copy to SSOT
      const destDir = path.join(this.ssotDir, installDir);
      if (fs.existsSync(destDir)) {
        await this.removeDir(destDir);
      }
      await this.copyDir(extractedSkillDir, destDir);

      // Read metadata
      const skillMdPath = path.join(destDir, 'SKILL.md');
      let metadata: { name?: string; description?: string } = { name: skill.name, description: skill.description };
      if (fs.existsSync(skillMdPath)) {
        const content = await readFile(skillMdPath, 'utf-8');
        const parsedMetadata = this.parseSkillMetadata(content);
        metadata = {
          name: parsedMetadata.name || skill.name,
          description: parsedMetadata.description || skill.description,
        };
      }

      return {
        id: `${skill.directory}:${skill.repoOwner}/${skill.repoName}`,
        name: metadata.name || skill.name,
        description: metadata.description || skill.description,
        directory: installDir,
        repoOwner: skill.repoOwner,
        repoName: skill.repoName,
        repoBranch: skill.repoBranch,
        readmeUrl: skill.readmeUrl,
        apps: { [currentApp]: true },
        installedAt: Math.floor(Date.now() / 1000),
        sourceType: 'global',
      };
    } finally {
      // Cleanup
      try {
        if (fs.existsSync(tempFile)) await promisify(fs.unlink)(tempFile);
        if (fs.existsSync(tempDir)) await this.removeDir(tempDir);
      } catch (error) {
        console.warn('[Skills] Cleanup error:', error);
      }
    }
  }

  // ===== Community Skills =====

  private static communityProvider: {
    fetch: (url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<any>;
  } | null = null;

  static setCommunityProvider(provider: typeof SkillService.communityProvider): void {
    SkillService.communityProvider = provider;
  }

  async fetchCommunitySkills(query: CommunitySkillQuery): Promise<CommunitySkillListResult> {
    if (!SkillService.communityProvider) {
      console.log('[Community] communityProvider 未注入，返回空列表');
      return { list: [], total: 0, page: query.page || 1, pageSize: query.pageSize || 20 };
    }
    const params = new URLSearchParams();
    if (query.keyword) params.set('keyword', query.keyword);
    if (query.tags) params.set('tags', query.tags);
    if (query.domain) params.set('domain', query.domain);
    if (query.department) params.set('department', query.department);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    params.set('page', String(query.page || 1));
    params.set('pageSize', String(query.pageSize || 20));

    const url = `?${params.toString()}`;
    try {
      const json: any = await SkillService.communityProvider.fetch(url);
      // API 返回 { code, data, message }，data 中包含 { total, page, pageSize, list }
      if (json.code && json.code !== 200 && json.code !== 0) {
        console.warn(`[Community] API 返回错误: code=${json.code}, message=${json.message}`);
        throw new Error(json.message || `API error: ${json.code}`);
      }
      const data = json.data || json;
      console.log(`[Community] 获取成功: total=${data.total}, list=${data.list?.length || 0}`);
      return data as CommunitySkillListResult;
    } catch (err: any) {
      console.error(`[Community] 获取社区 Skill 失败: ${err.message}`);
      throw err;
    }
  }

  async publishCommunitySkill(
    params: { name: string; description: string; npmPackage: string; installCommand: string; domain: string; tags: string[]; docUrl?: string; skillIconUrl?: string; authorAvatar?: string; authorName?: string; authorDepartment?: string; authorOrgFullPath?: string; authorPosition?: string },
    erp: string,
  ): Promise<CommunitySkill> {
    if (!SkillService.communityProvider) {
      throw new Error('Community API is not configured');
    }
    const json: any = await SkillService.communityProvider.fetch('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ERP': erp },
      body: JSON.stringify(params),
    });
    if (json.code === 409) {
      throw new Error(json.message || 'Skill 名称已存在，请更换名称');
    }
    if (json.code && json.code !== 200 && json.code !== 201 && json.code !== 0) {
      throw new Error(json.message || `发布失败: ${json.code}`);
    }
    return (json.data || json) as CommunitySkill;
  }

  async updateCommunitySkill(
    id: string,
    params: { name?: string; description?: string; domain?: string; tags?: string[]; docUrl?: string; skillIconUrl?: string; installCommand?: string },
    erp: string,
  ): Promise<CommunitySkill> {
    if (!SkillService.communityProvider) {
      throw new Error('Community API is not configured');
    }
    const json: any = await SkillService.communityProvider.fetch(`/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-ERP': erp },
      body: JSON.stringify(params),
    });
    if (json.code === 403) {
      throw new Error('只能修改自己发布的 Skill');
    }
    if (json.code === 404) {
      throw new Error('Skill 不存在');
    }
    if (json.code && json.code !== 200 && json.code !== 0) {
      throw new Error(json.message || `更新失败: ${json.code}`);
    }
    return (json.data || json) as CommunitySkill;
  }

  async deleteCommunitySkill(id: string, erp: string): Promise<void> {
    if (!SkillService.communityProvider) {
      throw new Error('Community API is not configured');
    }
    const json: any = await SkillService.communityProvider.fetch(`/${id}`, {
      method: 'DELETE',
      headers: { 'X-ERP': erp },
    });
    if (json.code === 403) {
      throw new Error('只能删除自己发布的 Skill');
    }
    if (json.code === 404) {
      throw new Error('Skill 不存在');
    }
    if (json.code && json.code !== 200 && json.code !== 0) {
      throw new Error(json.message || `删除失败: ${json.code}`);
    }
  }

  async incrementCommunityDownload(id: string, erp: string): Promise<number> {
    if (!SkillService.communityProvider) {
      return 0;
    }
    const json: any = await SkillService.communityProvider.fetch(`/${id}/download`, {
      method: 'POST',
      headers: { 'X-ERP': erp },
    });
    if (json.code && json.code !== 200 && json.code !== 0) {
      return 0;
    }
    return json?.data?.downloadCount ?? json?.downloadCount ?? 0;
  }

  async starCommunitySkill(id: string, erp: string): Promise<number> {
    if (!SkillService.communityProvider) return 0;
    const json: any = await SkillService.communityProvider.fetch(`/${id}/star`, {
      method: 'POST',
      headers: { 'X-ERP': erp },
    });
    if (json.code && json.code !== 200 && json.code !== 0) return 0;
    return json?.data?.star ?? 0;
  }

  async unstarCommunitySkill(id: string, erp: string): Promise<number> {
    if (!SkillService.communityProvider) return 0;
    const json: any = await SkillService.communityProvider.fetch(`/${id}/star`, {
      method: 'DELETE',
      headers: { 'X-ERP': erp },
    });
    if (json.code && json.code !== 200 && json.code !== 0) return 0;
    return json?.data?.star ?? 0;
  }
}

export const skillService = new SkillService();
