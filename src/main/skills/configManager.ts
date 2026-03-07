import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);
const mkdir = promisify(fs.mkdir);

export interface Skill {
  id: string;
  name: string;
  description?: string;
  content: string;
  enabled: boolean;
  category?: string;
  tags?: string[];
  author?: string;
  homepage?: string;
}

export class SkillConfigManager {
  private claudeConfigPath: string;
  private skillsDir: string;

  constructor() {
    this.claudeConfigPath = path.join(os.homedir(), '.claude', 'settings.json');
    this.skillsDir = path.join(os.homedir(), '.dongcc', 'skills');
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.skillsDir)) {
      await mkdir(this.skillsDir, { recursive: true });
    }
  }

  async syncSkillConfig(skills: Skill[]): Promise<void> {
    try {
      await this.initialize();
      
      const enabledSkills = skills.filter(s => s.enabled);
      
      if (enabledSkills.length === 0) {
        console.log('[Skills] No enabled skills to sync');
        return;
      }

      let config: any = {};
      
      if (fs.existsSync(this.claudeConfigPath)) {
        const content = await readFile(this.claudeConfigPath, 'utf-8');
        config = JSON.parse(content);
      }

      if (!config.skills) {
        config.skills = [];
      }

      for (const skill of enabledSkills) {
        const skillFileName = `${skill.id}.md`;
        const skillFilePath = path.join(this.skillsDir, skillFileName);
        
        await writeFile(skillFilePath, skill.content, 'utf-8');
        
        if (!config.skills.includes(skillFileName)) {
          config.skills.push(skillFileName);
        }
        
        console.log(`[Skills] Synced skill: ${skill.name} (${skill.id})`);
      }

      await writeFile(this.claudeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
      console.log(`[Skills] Successfully synced ${enabledSkills.length} skills to Claude Code`);
    } catch (error) {
      console.error('[Skills] Failed to sync skill config:', error);
      throw error;
    }
  }

  async removeSkillConfig(skillIds: string[]): Promise<void> {
    try {
      if (!fs.existsSync(this.claudeConfigPath)) {
        return;
      }

      const content = await readFile(this.claudeConfigPath, 'utf-8');
      const config = JSON.parse(content);

      if (!config.skills) {
        return;
      }

      for (const skillId of skillIds) {
        const skillFileName = `${skillId}.md`;
        const skillFilePath = path.join(this.skillsDir, skillFileName);
        
        if (fs.existsSync(skillFilePath)) {
          fs.unlinkSync(skillFilePath);
        }
        
        config.skills = config.skills.filter((s: string) => s !== skillFileName);
        console.log(`[Skills] Removed skill: ${skillId}`);
      }

      await writeFile(this.claudeConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      console.error('[Skills] Failed to remove skill config:', error);
      throw error;
    }
  }

  async importFromUrl(url: string): Promise<Skill> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch skill from ${url}`);
      }
      
      const content = await response.text();
      const name = path.basename(url, '.md');
      
      return {
        id: `imported_${Date.now()}`,
        name,
        content,
        enabled: false,
        author: 'Imported',
      };
    } catch (error) {
      console.error('[Skills] Failed to import skill:', error);
      throw error;
    }
  }
}
