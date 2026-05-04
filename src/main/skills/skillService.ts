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

export class SkillService {
  private claudeConfigPath: string;
  private ssotDir: string;
  private reposPath: string;
  private claudeProjectsDir: string;

  constructor() {
    this.claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');
    this.ssotDir = path.join(os.homedir(), '.opencc', 'skills');
    this.reposPath = path.join(os.homedir(), '.opencc', 'skill-repos.json');
    this.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
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
    return path.join(os.homedir(), '.claude', 'commands');
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

    if (!fs.existsSync(claudeSkillsDir)) {
      await mkdir(claudeSkillsDir, { recursive: true });
    }

    if (fs.existsSync(sourceDir)) {
      await this.copyDir(sourceDir, destDir);
      console.log(`[Skills] Synced to Claude: ${skill.name}`);
    }
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

  private async copyDir(src: string, dest: string): Promise<void> {
    if (fs.existsSync(dest)) {
      await this.removeDir(dest);
    }
    await mkdir(dest, { recursive: true });

    const entries = await readdir(src);
    for (const entry of entries) {
      const srcPath = path.join(src, entry);
      const destPath = path.join(dest, entry);
      const stats = await stat(srcPath);

      if (stats.isDirectory()) {
        await this.copyDir(srcPath, destPath);
      } else {
        const content = await readFile(srcPath);
        await writeFile(destPath, content);
      }
    }
  }

  private async removeDir(dir: string): Promise<void> {
    if (fs.existsSync(dir)) {
      const entries = await readdir(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          await this.removeDir(fullPath);
        } else {
          fs.unlinkSync(fullPath);
        }
      }
      fs.rmdirSync(dir);
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

    const scanDir = async (dir: string, sourceType: 'global' | 'project', sourceProject?: string) => {
      console.log(`[Skills] Scanning directory: ${dir}`);
      if (!fs.existsSync(dir)) {
        console.log(`[Skills] Directory does not exist: ${dir}`);
        return;
      }
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        if (installedDirs.has(entry)) continue;

        const fullPath = path.join(dir, entry);
        const stats = await stat(fullPath);
        if (!stats.isDirectory()) continue;

        const skillMd = path.join(fullPath, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
          const info = await this.readSkillFromDir(fullPath);
          if (info) {
            const existing = unmanaged.find(u => u.directory === entry);
            if (existing) {
              existing.foundIn.push(sourceType === 'global' ? 'claude' : sourceProject || 'project');
            } else {
              unmanaged.push({
                directory: entry,
                name: info.name,
                description: info.description,
                path: fullPath,
                sourceType,
                sourceProject,
                foundIn: [sourceType === 'global' ? 'claude' : sourceProject || 'project'],
              });
              console.log(`[Skills] Found skill: ${info.name} at ${fullPath}`);
            }
          }
        }
      }
    };

    // 1. Scan Claude Code global plugins directory (~/.claude/commands/)
    await scanDir(this.getClaudeSkillsDir(), 'global');

    // 2. Scan SSOT directory
    await scanDir(this.ssotDir, 'global');

    // 3. Scan Claude projects directory for project-specific skills
    const projects = await this.listProjectsWithSkills();
    for (const project of projects) {
      const encodedPath = this.encodeProjectPath(project.path);
      const projectSkillsDir = path.join(this.claudeProjectsDir, encodedPath, 'skills');
      await scanDir(projectSkillsDir, 'project', project.path);
    }

    // 4. Scan current working directory (极简模式: project/skills/)
    const cwd = process.cwd();
    const cwdSimpleSkillsDir = path.join(cwd, 'skills');
    await scanDir(cwdSimpleSkillsDir, 'project', cwd);

    // 5. Scan current working directory (.claude/skills/)
    const cwdClaudeSkillsDir = path.join(cwd, '.claude', 'skills');
    await scanDir(cwdClaudeSkillsDir, 'project', cwd);

    // 6. Scan current working directory (.claude-plugin/skills/)
    const cwdPluginSkillsDir = path.join(cwd, '.claude-plugin', 'skills');
    await scanDir(cwdPluginSkillsDir, 'project', cwd);

    console.log(`[Skills] Total unmanaged skills found: ${unmanaged.length}`);
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
    const destDir = path.join(this.ssotDir, directory);

    if (!fs.existsSync(sourcePath)) {
      console.error(`[Skills] Source directory not found: ${sourcePath}`);
      return null;
    }

    if (!fs.existsSync(destDir)) {
      await this.copyDir(sourcePath, destDir);
    }

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
        const stats = await stat(fullPath);
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
          'User-Agent': 'OpenCC-App',
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
    const tempDir = path.join(os.tmpdir(), `opencc-skill-${Date.now()}`);
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

      // Copy to SSOT
      const destDir = path.join(this.ssotDir, skill.directory);
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
        directory: skill.directory,
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
}

export const skillService = new SkillService();
