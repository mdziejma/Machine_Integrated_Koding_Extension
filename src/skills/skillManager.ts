import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  filePath: string;
  source: 'workspace' | 'global';
}

export class SkillManager {
  private static skillsCache: SkillMetadata[] = [];
  private static isScanning = false;

  /**
   * Discovers all available skills across workspace and global customization directories,
   * including Poolside (~/.config/poolside/skills), M.I.K.E. (~/.config/mike/skills), and ARCANA.
   */
  public static async discoverSkills(): Promise<SkillMetadata[]> {
    if (this.isScanning) {
      return this.skillsCache;
    }
    this.isScanning = true;

    const skills: SkillMetadata[] = [];
    const visitedPaths = new Set<string>();

    try {
      // 1. Workspace Skill Directories (.agent/skills, .skills, skills)
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        for (const folder of workspaceFolders) {
          const workspaceRoots = [
            vscode.Uri.joinPath(folder.uri, '.agent', 'skills'),
            vscode.Uri.joinPath(folder.uri, '.skills'),
            vscode.Uri.joinPath(folder.uri, 'skills'),
            vscode.Uri.joinPath(folder.uri, '.config', 'poolside', 'skills'),
            vscode.Uri.joinPath(folder.uri, '.config', 'mike', 'skills')
          ];

          for (const dirUri of workspaceRoots) {
            await this.scanDirectoryDirect(dirUri, 'workspace', skills, visitedPaths);
          }
        }
      }

      // 2. Global Skill Directories (Poolside, M.I.K.E., Gemini, ARCANA)
      const userHome = os.homedir();
      const globalRoots = [
        path.join(userHome, '.config', 'poolside', 'skills'),
        path.join(userHome, '.config', 'mike', 'skills'),
        path.join(userHome, '.poolside', 'skills'),
        path.join(userHome, '.config', 'poolside', 'plugins'),
        path.join(userHome, '.gemini', 'config', 'skills'),
        path.join(userHome, '.gemini', 'config', 'plugins'),
        path.join(userHome, '.agent', 'skills'),
        path.join(userHome, '.skills')
      ];

      const config = vscode.workspace.getConfiguration('mike');
      const customPaths = config.get<string[]>('customSkillPaths') || [];
      for (const customPath of customPaths) {
        const resolved = customPath.replace(/^~/, userHome);
        globalRoots.push(resolved);
      }

      for (const rootPath of globalRoots) {
        const rootUri = vscode.Uri.file(rootPath);
        await this.scanDirectoryDirect(rootUri, 'global', skills, visitedPaths);
      }

      skills.sort((a, b) => a.id.localeCompare(b.id));
      this.skillsCache = skills;
    } catch (err) {
      console.error('[M.I.K.E. SkillManager] Error discovering skills:', err);
    } finally {
      this.isScanning = false;
    }

    return this.skillsCache;
  }

  public static async getSkills(): Promise<SkillMetadata[]> {
    if (this.skillsCache.length === 0) {
      return await this.discoverSkills();
    }
    return this.skillsCache;
  }

  public static async findSkill(query: string): Promise<SkillMetadata | undefined> {
    const skills = await this.getSkills();
    const clean = query.trim().toLowerCase().replace(/^\/+/, '');
    return skills.find(
      (s) =>
        s.id.toLowerCase() === clean ||
        s.name.toLowerCase() === clean ||
        s.id.toLowerCase().replace(/[-_]/g, '') === clean.replace(/[-_]/g, '')
    );
  }

  public static async loadSkillContent(skill: SkillMetadata): Promise<string> {
    const fileUri = vscode.Uri.file(skill.filePath);
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    return Buffer.from(bytes).toString('utf8');
  }

  /**
   * Fast scan handling both directory skills (<name>/SKILL.md) and direct file skills (<name>.md)
   */
  private static async scanDirectoryDirect(
    dirUri: vscode.Uri,
    source: 'workspace' | 'global',
    results: SkillMetadata[],
    visitedPaths: Set<string>
  ): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(dirUri);

      // Check if this directory itself has a SKILL.md
      const selfSkill = entries.find(([name]) => name.toLowerCase() === 'skill.md');
      if (selfSkill) {
        const skillUri = vscode.Uri.joinPath(dirUri, selfSkill[0]);
        if (!visitedPaths.has(skillUri.fsPath)) {
          visitedPaths.add(skillUri.fsPath);
          const meta = await this.parseSkillFile(skillUri, source);
          if (meta) results.push(meta);
        }
      }

      for (const [name, fileType] of entries) {
        // 1. Direct single-file skills (e.g. skills/my_skill.md)
        if (fileType === vscode.FileType.File && name.endsWith('.md') && name.toLowerCase() !== 'skill.md' && name.toLowerCase() !== 'readme.md') {
          const skillFileUri = vscode.Uri.joinPath(dirUri, name);
          if (!visitedPaths.has(skillFileUri.fsPath)) {
            visitedPaths.add(skillFileUri.fsPath);
            const meta = await this.parseSkillFile(skillFileUri, source);
            if (meta) results.push(meta);
          }
          continue;
        }

        // 2. Directory skills (e.g. skills/my_skill/SKILL.md)
        if (
          fileType === vscode.FileType.Directory &&
          !name.startsWith('.') &&
          name !== 'node_modules' &&
          name !== 'out' &&
          name !== 'dist'
        ) {
          const subDirUri = vscode.Uri.joinPath(dirUri, name);
          try {
            const subEntries = await vscode.workspace.fs.readDirectory(subDirUri);
            const subSkill = subEntries.find(([n]) => n.toLowerCase() === 'skill.md' || n.toLowerCase() === 'readme.md');
            if (subSkill) {
              const skillUri = vscode.Uri.joinPath(subDirUri, subSkill[0]);
              if (!visitedPaths.has(skillUri.fsPath)) {
                visitedPaths.add(skillUri.fsPath);
                const meta = await this.parseSkillFile(skillUri, source);
                if (meta) results.push(meta);
              }
            } else {
              // Nested plugin check (e.g. plugins/plugin_name/skills/skill_name/SKILL.md)
              const skillsNestedDir = subEntries.find(([n, type]) => n.toLowerCase() === 'skills' && type === vscode.FileType.Directory);
              if (skillsNestedDir) {
                const nestedSkillsUri = vscode.Uri.joinPath(subDirUri, skillsNestedDir[0]);
                const nestedEntries = await vscode.workspace.fs.readDirectory(nestedSkillsUri);
                for (const [nestedName, nestedType] of nestedEntries) {
                  if (nestedType === vscode.FileType.Directory) {
                    const candidateDir = vscode.Uri.joinPath(nestedSkillsUri, nestedName);
                    try {
                      const candEntries = await vscode.workspace.fs.readDirectory(candidateDir);
                      const candSkill = candEntries.find(([n]) => n.toLowerCase() === 'skill.md' || n.toLowerCase() === 'readme.md');
                      if (candSkill) {
                        const skillUri = vscode.Uri.joinPath(candidateDir, candSkill[0]);
                        if (!visitedPaths.has(skillUri.fsPath)) {
                          visitedPaths.add(skillUri.fsPath);
                          const meta = await this.parseSkillFile(skillUri, source);
                          if (meta) results.push(meta);
                        }
                      }
                    } catch {}
                  }
                }
              }
            }
          } catch {}
        }
      }
    } catch {
      // Directory doesn't exist or not readable; ignore
    }
  }

  private static async parseSkillFile(
    fileUri: vscode.Uri,
    source: 'workspace' | 'global'
  ): Promise<SkillMetadata | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(fileUri);
      const text = Buffer.from(bytes).toString('utf8');

      let id = path.basename(fileUri.fsPath, path.extname(fileUri.fsPath));
      if (id.toLowerCase() === 'skill' || id.toLowerCase() === 'readme') {
        id = path.basename(path.dirname(fileUri.fsPath));
      }
      let name = id;
      let description = '';

      const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatterMatch) {
        const yamlContent = frontmatterMatch[1];
        const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
        const descMatch = yamlContent.match(/^description:\s*(.+)$/m);

        if (nameMatch) {
          name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
        if (descMatch) {
          description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
        }
      } else {
        const headerMatch = text.match(/^#\s+(.+)$/m);
        if (headerMatch) {
          name = headerMatch[1].trim();
        }
      }

      return {
        id,
        name,
        description: description || `Skill defined in ${id}`,
        filePath: fileUri.fsPath,
        source
      };
    } catch {
      return null;
    }
  }
}
