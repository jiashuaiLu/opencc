import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';
import * as zlib from 'zlib';
import * as stream from 'stream';

const mkdir = promisify(fs.mkdir);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const pipeline = promisify(stream.pipeline);

export interface ZipInstallResult {
  id: string;
  name: string;
  description?: string;
  directory: string;
  apps: { claude: boolean };
  installedAt: number;
  sourceType: 'global';
}

export class ZipInstaller {
  private ssotDir: string;

  constructor() {
    this.ssotDir = path.join(os.homedir(), '.opencc', 'skills');
  }

  async installFromZip(
    zipPath: string,
    currentApp: 'claude' = 'claude'
  ): Promise<ZipInstallResult[]> {
    // Ensure SSOT directory exists
    if (!fs.existsSync(this.ssotDir)) {
      await mkdir(this.ssotDir, { recursive: true });
    }

    // Create a temporary directory for extraction
    const tempDir = path.join(os.tmpdir(), `opencc-zip-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      // Extract the ZIP file
      await this.extractZip(zipPath, tempDir);

      // Find all skill directories (directories containing SKILL.md)
      const skillDirs = await this.findSkillDirectories(tempDir);

      if (skillDirs.length === 0) {
        throw new Error('No valid skills found in ZIP file. Each skill must have a SKILL.md file.');
      }

      const installedSkills: ZipInstallResult[] = [];

      // Install each skill
      for (const skillDir of skillDirs) {
        const skill = await this.installSkillFromDirectory(skillDir, currentApp);
        installedSkills.push(skill);
      }

      return installedSkills;
    } finally {
      // Clean up temporary directory
      await this.removeDir(tempDir);
    }
  }

  private async extractZip(zipPath: string, destDir: string): Promise<void> {
    // Use Node.js built-in modules for ZIP extraction
    // For now, we'll use a simple approach that works with standard ZIP files
    const AdmZip = require('adm-zip');

    try {
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(destDir, true);
    } catch (error) {
      throw new Error(`Failed to extract ZIP file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async findSkillDirectories(dir: string): Promise<string[]> {
    const skillDirs: string[] = [];
    await this.scanForSkills(dir, skillDirs);
    return skillDirs;
  }

  private async scanForSkills(dir: string, skillDirs: string[]): Promise<void> {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stats = await stat(fullPath);

      if (!stats.isDirectory()) continue;

      // Check if this directory contains SKILL.md
      const skillMdPath = path.join(fullPath, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        skillDirs.push(fullPath);
      } else {
        // Recursively scan subdirectories
        await this.scanForSkills(fullPath, skillDirs);
      }
    }
  }

  private async installSkillFromDirectory(
    skillDir: string,
    currentApp: 'claude'
  ): Promise<ZipInstallResult> {
    // Read SKILL.md to extract metadata
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const content = await promisify(fs.readFile)(skillMdPath, 'utf-8');
    const metadata = this.parseSkillMetadata(content);

    const skillName = metadata.name || path.basename(skillDir);
    const directory = this.sanitizeDirectoryName(skillName);

    // Check if skill already exists
    const destPath = path.join(this.ssotDir, directory);
    if (fs.existsSync(destPath)) {
      // Remove existing installation
      await this.removeDir(destPath);
    }

    // Copy skill to SSOT directory
    await this.copyDir(skillDir, destPath);

    return {
      id: `zip:${directory}`,
      name: skillName,
      description: metadata.description,
      directory,
      apps: { [currentApp]: true },
      installedAt: Math.floor(Date.now() / 1000),
      sourceType: 'global',
    };
  }

  private sanitizeDirectoryName(name: string): string {
    // Remove or replace invalid characters
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private parseSkillMetadata(content: string): { name?: string; description?: string } {
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
          currentKey = '';
          currentValue = '';
        }
      }
    }

    if (currentKey) {
      result[currentKey] = currentValue.trim();
    }

    return result;
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
        await promisify(fs.copyFile)(srcPath, destPath);
      }
    }
  }

  private async removeDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) return;

    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stats = await stat(fullPath);
      if (stats.isDirectory()) {
        await this.removeDir(fullPath);
      } else {
        await unlink(fullPath);
      }
    }
    await promisify(fs.rmdir)(dir);
  }
}

export const zipInstaller = new ZipInstaller();
