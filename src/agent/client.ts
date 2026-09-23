import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { OPENAI_TOOLS, executeTool } from '../tools/fileTools.js';
import { SkillManager } from '../skills/skillManager.js';

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentCallbacks {
  onDeltaText?: (delta: string) => void;
  onToolStart?: (toolCall: { id: string; name: string; args: string }) => void;
  onToolComplete?: (toolCall: { id: string; name: string; result: string; isError: boolean }) => void;
  onStatusUpdate?: (status: string) => void;
  onSkillActivated?: (skillName: string) => void;
}

export class AgentClient {
  private static readonly SYSTEM_PROMPT = `You are M.I.K.E. (Machine-Integrated Koding Extension) running inside Visual Studio Code.
You have first-class access to native VS Code tools: write_file, read_file, delete_file, list_dir, grep_search, find_symbol, and get_diagnostics.
For all file creations and edits, ALWAYS call the 'write_file' tool directly.
For all file deletions and cleanups, ALWAYS call the 'delete_file' tool directly.
Never run terminal python scripts (python -c, write_files.py) or shell commands (del, rm, rmdir, cat >, echo >) to manage files.

You operate on the user's workspace using available tools:
- write_file: Writes full content directly to a workspace file. Automatically creates parent directories, creates a side-by-side diff snapshot (mike-diff://), and returns compiler/LSP diagnostics.
- read_file: Read files using native VS Code VFS.
- delete_file: Delete files or directories using native VS Code VFS.
- list_dir: List directory contents.
- find_symbol: Fast, indexed AST workspace symbol lookup (classes, functions, methods, interfaces). Use this instead of searching files manually.
- grep_search: Fast regex and string search across workspace files.
- get_diagnostics: Query Language Server compiler/linter diagnostics.
- list_skills & load_skill: Discover and load specialized skills.
- run_command: Execute unit tests, test suites, builds, or analysis/metric scripts (e.g., pytest, npm test, dotnet test, python scripts/...).

CRITICAL OPERATIONAL RULES:
1. STRICT BAN ON FILE I/O VIA SHELL: NEVER use run_command or shell commands (del, rm, rmdir, cat, echo, type, dir, ls, Set-Content, Get-Content, python -c, write_files.py, etc.) to read, write, create, delete, or list files. ALWAYS use write_file, read_file, delete_file, or list_dir.
2. USE run_command EXCLUSIVELY FOR EXECUTION: Use run_command only to run test suites, compilation/build commands, and metric/analysis scripts.
3. ZERO SHORTCUTS & 100% COMPLETENESS MANDATE: NEVER omit code, use lazy abbreviations, or write comments like '// TODO: implement', '// ... existing code ...', '/* ... */', 'pass', or partial stubs. ALWAYS generate 100% complete, fully functional, syntactically flawless code with zero typos, correct imports, and proper type definitions.
4. IMMEDIATE COMPILER SELF-CORRECTION: If write_file returns compiler errors or LSP diagnostic warnings, immediately inspect the issues and issue a corrected write_file call to achieve zero compiler errors.
5. SKILL ADHERENCE: When a skill is activated, strictly follow the specialized instructions, templates, and domain rules provided in that skill.
6. Be precise, concise, and professional in your communications.`;

  private static secretStorage?: vscode.SecretStorage;
  private static globalState?: vscode.Memento;
  public static lastWorkingEndpoint?: string;
  public static lastWorkingAuthHeader?: string;

  public static initializePersistence(secrets: vscode.SecretStorage, globalState: vscode.Memento): void {
    this.secretStorage = secrets;
    this.globalState = globalState;
  }

  public static setSecretStorage(storage: vscode.SecretStorage): void {
    this.secretStorage = storage;
  }

  public static async savePersistentConfig(config: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    commandMode?: 'prompt' | 'auto' | 'deny';
    temperature?: number;
    maxTokens?: number;
  }): Promise<void> {
    if (config.baseUrl && config.baseUrl.trim()) {
      const cleanUrl = config.baseUrl.trim();
      await this.globalState?.update('mike.baseUrl', cleanUrl);
      this.lastWorkingEndpoint = this.resolveEndpoint(cleanUrl);
    }
    if (config.model && config.model.trim()) {
      const cleanModel = config.model.trim();
      await this.globalState?.update('mike.model', cleanModel);

      // Maintain recent model history
      const existingRecent: string[] = this.globalState?.get<string[]>('mike.recentModels') || [];
      const updatedRecent = [cleanModel, ...existingRecent.filter((m) => m !== cleanModel)].slice(0, 20);
      await this.globalState?.update('mike.recentModels', updatedRecent);
    }
    if (config.commandMode) {
      await this.globalState?.update('mike.commandMode', config.commandMode);
    }
    if (config.temperature !== undefined) {
      await this.globalState?.update('mike.temperature', Number(config.temperature));
    }
    if (config.maxTokens !== undefined) {
      await this.globalState?.update('mike.maxTokens', Number(config.maxTokens));
    }
    if (config.apiKey !== undefined && config.apiKey.trim() !== '') {
      await this.secretStorage?.store('mike.apiKey', config.apiKey.trim());
    }

    // Also attempt to update VS Code configuration if permitted
    try {
      const vsConfig = vscode.workspace.getConfiguration('mike');
      if (config.baseUrl) {
        await vsConfig.update('baseUrl', config.baseUrl.trim(), vscode.ConfigurationTarget.Global);
      }
      if (config.model) {
        await vsConfig.update('model', config.model.trim(), vscode.ConfigurationTarget.Global);
      }
      if (config.commandMode) {
        await vsConfig.update('commandMode', config.commandMode, vscode.ConfigurationTarget.Global);
      }
      if (config.temperature !== undefined) {
        await vsConfig.update('temperature', Number(config.temperature), vscode.ConfigurationTarget.Global);
      }
      if (config.maxTokens !== undefined) {
        await vsConfig.update('maxTokens', Number(config.maxTokens), vscode.ConfigurationTarget.Global);
      }
    } catch {
      // Ignored if global settings.json is write-protected; globalState & secretStorage handle it
    }
  }

  /**
   * Returns known models aggregated from server discovery, recent user inputs, and standard defaults.
   */
  public static async getKnownModels(): Promise<string[]> {
    const discovered: string[] = this.globalState?.get<string[]>('mike.discoveredModels') || [];
    const recent: string[] = this.globalState?.get<string[]>('mike.recentModels') || [];

    const modelSet = new Set<string>();
    discovered.forEach((m) => m && modelSet.add(m.trim()));
    recent.forEach((m) => m && modelSet.add(m.trim()));

    // Only inject default fallback models if nothing has been discovered or configured yet
    if (modelSet.size === 0) {
      const defaults = [
        'qwen2.5-coder',
        'deepseek-coder',
        'gpt-4o',
        'gpt-4o-mini',
        'claude-3-5-sonnet',
        'laguna-s-2.1-p5.en-es',
        'laguna_S'
      ];
      defaults.forEach((m) => m && modelSet.add(m.trim()));
    }

    return Array.from(modelSet).filter(Boolean);
  }

  /**
   * Queries the server's /models or /v1/models endpoint to auto-discover available LLM models.
   */
  public static async fetchAvailableModels(
    overrideBaseUrl?: string,
    overrideApiKey?: string
  ): Promise<{ models: string[]; sourceUrl?: string }> {
    const config = await this.getConfig();
    const rawBase = (overrideBaseUrl || config.baseUrl || 'http://localhost:11434/v1').trim().replace(/\/+$/, '');
    const apiKey = overrideApiKey !== undefined && overrideApiKey.trim() !== '' ? overrideApiKey.trim() : config.apiKey;

    const baseWithProto = rawBase.startsWith('http') ? rawBase : `https://${rawBase}`;
    const candidates = new Set<string>();

    try {
      const parsed = new URL(baseWithProto);
      const root = `${parsed.protocol}//${parsed.host}`;
      candidates.add(`${root}/v1/models`);
      candidates.add(`${root}/openai/v1/models`);
      candidates.add(`${root}/models`);
      candidates.add(`${root}/api/v1/models`);
    } catch {}

    if (baseWithProto.endsWith('/chat/completions')) {
      candidates.add(baseWithProto.replace(/\/chat\/completions$/, '/models'));
    } else if (baseWithProto.endsWith('/completions')) {
      candidates.add(baseWithProto.replace(/\/completions$/, '/models'));
    } else {
      candidates.add(`${baseWithProto}/models`);
      candidates.add(`${baseWithProto}/v1/models`);
    }

    const headerVariants: { name: string; headers: Record<string, string> }[] = [
      {
        name: 'Bearer Token',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        }
      },
      {
        name: 'X-API-Key',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey } : {})
        }
      }
    ];

    for (const targetUrl of candidates) {
      for (const variant of headerVariants) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          const res = await fetch(targetUrl, {
            method: 'GET',
            headers: variant.headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data: any = await res.json();
            const discovered: string[] = [];

            if (Array.isArray(data)) {
              for (const item of data) {
                if (typeof item === 'string') discovered.push(item);
                else if (item && typeof item.id === 'string') discovered.push(item.id);
                else if (item && typeof item.name === 'string') discovered.push(item.name);
              }
            } else if (data && Array.isArray(data.data)) {
              for (const item of data.data) {
                if (typeof item === 'string') discovered.push(item);
                else if (item && typeof item.id === 'string') discovered.push(item.id);
                else if (item && typeof item.name === 'string') discovered.push(item.name);
              }
            } else if (data && Array.isArray(data.models)) {
              for (const item of data.models) {
                if (typeof item === 'string') discovered.push(item);
                else if (item && typeof item.id === 'string') discovered.push(item.id);
                else if (item && typeof item.name === 'string') discovered.push(item.name);
              }
            }

            const cleanDiscovered = Array.from(new Set(discovered.map((s) => s.trim()).filter(Boolean)));
            if (cleanDiscovered.length > 0) {
              await this.globalState?.update('mike.discoveredModels', cleanDiscovered);
              return { models: cleanDiscovered, sourceUrl: targetUrl };
            }
          }
        } catch {
          // Probe next URL candidate
        }
      }
    }

    return { models: await this.getKnownModels() };
  }

  public static getSystemPrompt(): string {
    return this.SYSTEM_PROMPT;
  }

  public static async getConfig(): Promise<{
    baseUrl: string;
    apiKey: string;
    model: string;
    commandMode: 'prompt' | 'auto' | 'deny';
    temperature: number;
    maxTokens: number;
  }> {
    const config = vscode.workspace.getConfiguration('mike');

    // 1. Base URL priority: globalState -> settings -> env -> default
    const baseUrl = (
      this.globalState?.get<string>('mike.baseUrl') ||
      config.get<string>('baseUrl') ||
      process.env.MIKE_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.POOLSIDE_BASE_URL ||
      'http://localhost:11434/v1'
    ).replace(/\/+$/, '');

    // 2. API Key priority: SecretStorage -> env -> settings
    let apiKey = '';
    if (this.secretStorage) {
      apiKey = (await this.secretStorage.get('mike.apiKey')) || '';
    }

    if (!apiKey) {
      apiKey =
        process.env.MIKE_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.POOLSIDE_API_KEY ||
        config.get<string>('apiKey') ||
        '';
    }

    // 3. Model priority: globalState -> settings -> env -> default
    const model =
      this.globalState?.get<string>('mike.model') ||
      config.get<string>('model') ||
      process.env.MIKE_MODEL ||
      process.env.OPENAI_MODEL ||
      process.env.POOLSIDE_MODEL ||
      'qwen2.5-coder';

    // 4. Command Mode priority: globalState -> settings -> 'prompt'
    const commandMode: 'prompt' | 'auto' | 'deny' =
      this.globalState?.get<'prompt' | 'auto' | 'deny'>('mike.commandMode') ||
      config.get<'prompt' | 'auto' | 'deny'>('commandMode') ||
      'prompt';

    // 5. Temperature priority: globalState -> settings -> 0.0 (Deterministic code generation)
    const storedTemp = this.globalState?.get<number>('mike.temperature');
    const configTemp = config.get<number>('temperature');
    const temperature = storedTemp !== undefined ? storedTemp : (configTemp !== undefined ? configTemp : 0.0);

    // 6. Max Output Tokens priority: globalState -> settings -> 8192
    const storedMaxTokens = this.globalState?.get<number>('mike.maxTokens');
    const configMaxTokens = config.get<number>('maxTokens');
    const maxTokens = storedMaxTokens !== undefined ? storedMaxTokens : (configMaxTokens !== undefined ? configMaxTokens : 8192);

    return { baseUrl, apiKey, model, commandMode, temperature, maxTokens };
  }

  /**
   * Dynamically builds the system prompt by aggregating:
   * 1. Core M.I.K.E. directives
   * 2. Global AGENTS.md (~/.config/poolside/AGENTS.md or ~/.config/mike/AGENTS.md)
   * 3. Workspace AGENTS.md / MIKE.md (.agent/AGENTS.md, AGENTS.md, MIKE.md, CLAUDE.md)
   */
  public static async buildSystemPrompt(): Promise<string> {
    const promptParts: string[] = [this.SYSTEM_PROMPT];
    const userHome = os.homedir();
    const MAX_DIRECTIVE_CHARS = 25000;

    // 1. Check Global AGENTS.md
    const globalAgentsPaths = [
      path.join(userHome, '.config', 'poolside', 'AGENTS.md'),
      path.join(userHome, '.config', 'mike', 'AGENTS.md'),
      path.join(userHome, '.poolside', 'AGENTS.md')
    ];

    for (const p of globalAgentsPaths) {
      try {
        const fileUri = vscode.Uri.file(p);
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        let text = Buffer.from(bytes).toString('utf8').trim();
        if (text) {
          if (text.length > MAX_DIRECTIVE_CHARS) {
            text = text.slice(0, MAX_DIRECTIVE_CHARS) + '\n...[Directives truncated for context safety]';
          }
          promptParts.push(`\n[GLOBAL AGENT OPERATIONAL DIRECTIVES (${path.basename(path.dirname(p))}/AGENTS.md)]\n${text}`);
          break;
        }
      } catch {}
    }

    // 2. Check Workspace AGENTS.md / MIKE.md / CLAUDE.md / .cursorrules
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const candidateWorkspaceFiles = [
          vscode.Uri.joinPath(folder.uri, 'AGENTS.md'),
          vscode.Uri.joinPath(folder.uri, '.agent', 'AGENTS.md'),
          vscode.Uri.joinPath(folder.uri, 'MIKE.md'),
          vscode.Uri.joinPath(folder.uri, '.mike', 'AGENTS.md'),
          vscode.Uri.joinPath(folder.uri, 'CLAUDE.md'),
          vscode.Uri.joinPath(folder.uri, '.cursorrules')
        ];

        for (const fUri of candidateWorkspaceFiles) {
          try {
            const bytes = await vscode.workspace.fs.readFile(fUri);
            let text = Buffer.from(bytes).toString('utf8').trim();
            if (text) {
              if (text.length > MAX_DIRECTIVE_CHARS) {
                text = text.slice(0, MAX_DIRECTIVE_CHARS) + '\n...[Directives truncated for context safety]';
              }
              promptParts.push(`\n[WORKSPACE AGENT DIRECTIVES (${path.basename(fUri.fsPath)})]\n${text}`);
              break;
            }
          } catch {}
        }
      }
    }

    return promptParts.join('\n\n');
  }

  public static async preprocessUserPrompt(
    prompt: string,
    callbacks?: AgentCallbacks
  ): Promise<{ expandedPrompt: string; activatedSkillName?: string }> {
    let trimmed = prompt.trim();

    // Check for @editor / @selection mentions and inject active editor context
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const doc = activeEditor.document;
      const relPath = vscode.workspace.asRelativePath(doc.uri);

      if (trimmed.includes('@selection')) {
        const selection = activeEditor.selection;
        const selectedText = doc.getText(selection);
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const contextBlock = `\n\n[ACTIVE SELECTION: ${relPath} (Lines ${startLine}-${endLine})]\n\`\`\`\n${selectedText || '(No text selected)'}\n\`\`\``;
        trimmed = trimmed.replace(/@selection/g, '').trim() + contextBlock;
      }
      if (trimmed.includes('@editor')) {
        const fullDocText = doc.getText();
        const maxDocChars = 15000;
        const docSlice = fullDocText.length > maxDocChars ? fullDocText.slice(0, maxDocChars) + '\n...[Content truncated]' : fullDocText;
        const contextBlock = `\n\n[ACTIVE FILE: ${relPath}]\n\`\`\`\n${docSlice}\n\`\`\``;
        trimmed = trimmed.replace(/@editor/g, '').trim() + contextBlock;
      }
    }

    // Check for @terminal / @output mentions and inject terminal context
    if (trimmed.includes('@terminal') || trimmed.includes('@output')) {
      const activeTerminal = vscode.window.activeTerminal;
      const terminalName = activeTerminal ? activeTerminal.name : 'Terminal';
      let terminalContent = '';

      try {
        const priorClipboard = await vscode.env.clipboard.readText();
        await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
        const copied = await vscode.env.clipboard.readText();
        if (copied && copied !== priorClipboard) {
          terminalContent = copied;
        }
      } catch {
        // Fallback if terminal copy is unsupported
      }

      const maxChars = 15000;
      const termSlice = terminalContent.length > maxChars
        ? terminalContent.slice(0, maxChars) + '\n...[Content truncated]'
        : (terminalContent || '(No active terminal selection captured. Please highlight the desired terminal output text with your mouse or cursor before using @terminal)');

      const contextBlock = `\n\n[ACTIVE TERMINAL / OUTPUT: ${terminalName}]\n\`\`\`\n${termSlice}\n\`\`\``;
      trimmed = trimmed.replace(/@terminal/g, '').replace(/@output/g, '').trim() + contextBlock;
    }

    const slashMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);

    if (!slashMatch) {
      return { expandedPrompt: trimmed };
    }

    const skillId = slashMatch[1];
    const userMessage = slashMatch[2] || 'Apply and execute this skill according to its instructions.';

    const skill = await SkillManager.findSkill(skillId);
    if (!skill) {
      return { expandedPrompt: trimmed };
    }

    callbacks?.onSkillActivated?.(skill.name);
    callbacks?.onStatusUpdate?.(`Activated Skill: ${skill.name}`);

    try {
      const skillContent = await SkillManager.loadSkillContent(skill);
      const expandedPrompt = `[SPECIALIZED SKILL ACTIVATED: ${skill.name} (${skill.id})]
${skillContent}

[USER TASK FOR THIS SKILL]
${userMessage}`;

      return {
        expandedPrompt,
        activatedSkillName: skill.name
      };
    } catch {
      return { expandedPrompt: trimmed };
    }
  }

  /**
   * Smart Endpoint Resolver that auto-handles full URLs, /v1, /openai/v1, /v0 suffixes, and missing protocols
   */
  public static resolveEndpoint(rawBaseUrl: string): string {
    let clean = rawBaseUrl.trim().replace(/\/+$/, '');
    if (!clean) {
      return 'http://localhost:11434/v1/chat/completions';
    }

    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `http://${clean}`;
    }

    if (clean.endsWith('/chat/completions') || clean.endsWith('/completions')) {
      return clean;
    }

    if (clean.endsWith('/v1') || clean.endsWith('/openai/v1') || clean.endsWith('/v0') || clean.endsWith('/api/v1')) {
      return `${clean}/chat/completions`;
    }

    // Default: append /v1/chat/completions
    return `${clean}/v1/chat/completions`;
  }

  /**
   * Probes candidate OpenAI-compatible endpoints and authorization headers.
   * If overrideConfig is provided, it tests with those values.
   * On success, it automatically saves the confirmed working configuration globally.
   */
  public static async testConnection(overrideConfig?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  }): Promise<{
    success: boolean;
    workingEndpoint?: string;
    discoveredModels?: string[];
    details: string;
  }> {
    const savedConfig = await this.getConfig();
    const rawBaseUrl = overrideConfig?.baseUrl?.trim() || savedConfig.baseUrl;
    const apiKey =
      overrideConfig?.apiKey !== undefined && overrideConfig.apiKey.trim() !== ''
        ? overrideConfig.apiKey.trim()
        : savedConfig.apiKey;
    const model = overrideConfig?.model?.trim() || savedConfig.model;

    let cleanBase = rawBaseUrl.trim().replace(/\/+$/, '');
    if (!cleanBase) {
      cleanBase = 'http://localhost:11434/v1';
    }
    const baseWithProto = cleanBase.startsWith('http') ? cleanBase : `http://${cleanBase}`;

    const candidates = new Set<string>();
    candidates.add(this.resolveEndpoint(baseWithProto));

    try {
      const parsed = new URL(baseWithProto);
      const root = `${parsed.protocol}//${parsed.host}`;
      candidates.add(`${root}/v1/chat/completions`);
      candidates.add(`${root}/openai/v1/chat/completions`);
      candidates.add(`${root}/v0/chat/completions`);
      candidates.add(`${root}/api/v1/chat/completions`);
      candidates.add(`${root}/chat/completions`);
    } catch {}

    const logs: string[] = [];
    const modelToUse = model || 'qwen2.5-coder';

    for (const targetUrl of candidates) {
      logs.push(`Testing URL: ${targetUrl}`);

      const headerVariants: { name: string; headers: Record<string, string> }[] = [
        {
          name: 'Bearer Token',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey.trim()}` } : {})
          }
        },
        {
          name: 'X-API-Key',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'X-API-Key': apiKey.trim() } : {})
          }
        },
        {
          name: 'api-key',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'api-key': apiKey.trim() } : {})
          }
        },
        {
          name: 'Poolside-Token',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Poolside-Token': apiKey.trim() } : {})
          }
        }
      ];

      for (const variant of headerVariants) {
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: variant.headers,
            body: JSON.stringify({
              model: modelToUse,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 5,
              stream: false
            })
          });

          let bodyText = '';
          try {
            bodyText = await res.text();
          } catch {
            bodyText = res.statusText;
          }

          logs.push(`  [${variant.name}] -> HTTP ${res.status}: ${bodyText.slice(0, 150)}`);

          if (res.ok || res.status === 200) {
            this.lastWorkingEndpoint = targetUrl;
            this.lastWorkingAuthHeader = variant.name;

            // Automatically persist confirmed working credentials globally across folders
            await this.savePersistentConfig({
              baseUrl: targetUrl,
              apiKey: apiKey,
              model: modelToUse
            });

            // Automatically auto-discover available models from /models in background
            const discoveredResult = await this.fetchAvailableModels(targetUrl, apiKey);
            const discoveredList = discoveredResult.models || [];
            const discoveredMsg = discoveredList.length > 0
              ? `\nAuto-discovered ${discoveredList.length} server models:\n- ${discoveredList.slice(0, 6).join('\n- ')}${discoveredList.length > 6 ? '\n- ...' : ''}`
              : '';

            return {
              success: true,
              workingEndpoint: targetUrl,
              discoveredModels: discoveredList,
              details: `Connected successfully! (HTTP 200)\nWorking Endpoint: ${targetUrl}\nAuth: ${variant.name}\nActive Model: ${modelToUse}${discoveredMsg}`
            };
          }
        } catch (err: unknown) {
          logs.push(`  [${variant.name}] -> Network Error: ${(err as Error).message}`);
        }
      }
    }

    return {
      success: false,
      details: logs.join('\n')
    };
  }

  /**
   * Prunes and bounds messages payload to prevent exceeding the LLM context window (262k tokens).
   */
  public static pruneMessages(messages: ChatMessage[], maxTotalChars = 400000): ChatMessage[] {
    if (messages.length <= 2) {
      return messages.map((m) => this.sanitizeMessage(m));
    }

    const sanitized = messages.map((m) => this.sanitizeMessage(m));
    let totalChars = sanitized.reduce(
      (sum, m) => sum + (m.content?.length || 0) + JSON.stringify(m.tool_calls || '').length,
      0
    );

    if (totalChars <= maxTotalChars) {
      return sanitized;
    }

    // Keep system prompt at index 0
    const systemPrompt = sanitized[0].role === 'system' ? sanitized[0] : null;
    let rest = systemPrompt ? sanitized.slice(1) : [...sanitized];

    // Remove oldest messages until within char limits
    while (rest.length > 2 && totalChars > maxTotalChars) {
      const removed = rest.shift();
      if (removed) {
        totalChars -= (removed.content?.length || 0) + JSON.stringify(removed.tool_calls || '').length;
      }
    }

    // Ensure the first non-system message is not an orphaned 'tool' role response
    while (rest.length > 0 && rest[0].role === 'tool') {
      rest.shift();
    }

    return systemPrompt ? [systemPrompt, ...rest] : rest;
  }

  private static sanitizeMessage(msg: ChatMessage): ChatMessage {
    const MAX_MSG_CHARS = 40000;
    if (msg.content && msg.content.length > MAX_MSG_CHARS) {
      return {
        ...msg,
        content:
          msg.content.slice(0, MAX_MSG_CHARS) +
          `\n\n... [TRUNCATED by M.I.K.E.: Content exceeded ${MAX_MSG_CHARS} characters (~10k tokens) to prevent context limit overflow]`
      };
    }
    return msg;
  }

  /**
   * Main multi-turn agentic execution loop with streaming & non-streaming fallback.
   */
  public static async runAgentLoop(
    history: ChatMessage[],
    callbacks: AgentCallbacks,
    abortSignal: AbortSignal
  ): Promise<ChatMessage[]> {
    const { baseUrl, apiKey, model, temperature, maxTokens } = await this.getConfig();
    const endpoint = this.lastWorkingEndpoint || this.resolveEndpoint(baseUrl);

    const workingHistory: ChatMessage[] = [...history];
    if (workingHistory.length === 0 || workingHistory[0].role !== 'system') {
      const dynamicSystemPrompt = await this.buildSystemPrompt();
      workingHistory.unshift({ role: 'system', content: dynamicSystemPrompt });
    }

    const MAX_TURNS = 20;
    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
      if (abortSignal.aborted) {
        throw new Error('Agent execution cancelled by user.');
      }

      turnCount++;
      callbacks.onStatusUpdate?.('Thinking...');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (apiKey && apiKey.trim().length > 0) {
        if (this.lastWorkingAuthHeader === 'X-API-Key') {
          headers['X-API-Key'] = apiKey.trim();
        } else {
          headers['Authorization'] = `Bearer ${apiKey.trim()}`;
        }
      }

      // Safely bound and prune context before network dispatch
      const prunedMessages = this.pruneMessages(workingHistory);

      // 1. First attempt: Stream request with tools
      let response: Response;
      let isStreaming = true;

      const payloadWithTools = {
        model,
        messages: prunedMessages,
        tools: OPENAI_TOOLS,
        temperature: temperature !== undefined ? temperature : 0.0,
        max_tokens: maxTokens || 8192,
        stream: true
      };

      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payloadWithTools),
          signal: abortSignal
        });
      } catch (err: unknown) {
        if (abortSignal.aborted) {
          throw new Error('Agent execution cancelled by user.');
        }
        throw new Error(`Failed to connect to LLM endpoint (${endpoint}): ${(err as Error).message}`);
      }

      // If streaming / tools returned 400 or 405, fallback to non-streaming
      if (!response.ok && (response.status === 400 || response.status === 405 || response.status === 404)) {
        try {
          const fallbackPayload = {
            model,
            messages: prunedMessages,
            temperature: temperature !== undefined ? temperature : 0.0,
            max_tokens: maxTokens || 8192,
            stream: false
          };

          const fallbackRes = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(fallbackPayload),
            signal: abortSignal
          });

          if (fallbackRes.ok) {
            response = fallbackRes;
            isStreaming = false;
          }
        } catch {
          // Keep original response for error handling below
        }
      }

      if (!response.ok) {
        let errText = '';
        try {
          errText = await response.text();
        } catch {
          errText = response.statusText;
        }

        let hint = '';
        if (response.status === 405) {
          hint = `\n\n[HTTP 405 Method Not Allowed] Target URL: ${endpoint}\nPlease click ⚙️ Config -> Test to auto-detect the exact working URL.`;
        } else if (errText.includes('context length') || errText.includes('tokens') || response.status === 400) {
          hint = `\n\n[Context Safety Notice] The active conversation exceeded the server context limit. Click "Clear" in the sidebar to reset the session.`;
        }

        throw new Error(`LLM API returned HTTP ${response.status} (${response.statusText}): ${errText || 'No response body'}${hint}`);
      }

      let accumulatedText = '';
      const emittedToolCalls: ToolCall[] = [];

      if (isStreaming && response.body) {
        const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        try {
          while (true) {
            if (abortSignal.aborted) {
              reader.cancel();
              throw new Error('Agent execution cancelled by user.');
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':') || trimmed === 'data: [DONE]') {
                continue;
              }

              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                try {
                  const parsed = JSON.parse(jsonStr);
                  const choice = parsed.choices?.[0];
                  if (!choice) continue;

                  const delta = choice.delta;
                  if (!delta) continue;

                  if (typeof delta.content === 'string' && delta.content.length > 0) {
                    accumulatedText += delta.content;
                    callbacks.onDeltaText?.(delta.content);
                  }

                  if (Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                      const idx = tc.index ?? 0;
                      if (!toolCallsMap.has(idx)) {
                        toolCallsMap.set(idx, {
                          id: tc.id || '',
                          name: tc.function?.name || '',
                          args: tc.function?.arguments || ''
                        });
                      } else {
                        const entry = toolCallsMap.get(idx)!;
                        if (tc.id) entry.id += tc.id;
                        if (tc.function?.name) entry.name += tc.function.name;
                        if (tc.function?.arguments) entry.args += tc.function.arguments;
                      }
                    }
                  }
                } catch {}
              }
            }
          }
        } finally {
          reader.releaseLock();
        }

        Array.from(toolCallsMap.values()).forEach((item, index) => {
          emittedToolCalls.push({
            id: item.id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: { name: item.name, arguments: item.args }
          });
        });
      } else {
        // Non-streaming JSON response
        const json = await response.json();
        const choice = json.choices?.[0];
        if (choice?.message) {
          accumulatedText = choice.message.content || '';
          if (accumulatedText) {
            callbacks.onDeltaText?.(accumulatedText);
          }
          if (Array.isArray(choice.message.tool_calls)) {
            choice.message.tool_calls.forEach((tc: any) => {
              emittedToolCalls.push({
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.function.name,
                  arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments)
                }
              });
            });
          }
        }
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: accumulatedText || null,
        tool_calls: emittedToolCalls.length > 0 ? emittedToolCalls : undefined
      };
      workingHistory.push(assistantMessage);

      if (emittedToolCalls.length === 0) {
        callbacks.onStatusUpdate?.('Ready');
        break;
      }

      for (const toolCall of emittedToolCalls) {
        if (abortSignal.aborted) {
          throw new Error('Agent execution cancelled by user.');
        }

        callbacks.onToolStart?.({
          id: toolCall.id,
          name: toolCall.function.name,
          args: toolCall.function.arguments
        });
        callbacks.onStatusUpdate?.(`Executing ${toolCall.function.name}...`);

        let toolOutput = '';
        let isError = false;

        try {
          toolOutput = await executeTool(toolCall.function.name, toolCall.function.arguments);
        } catch (err: unknown) {
          isError = true;
          toolOutput = `Tool execution error: ${(err as Error).message}`;
        }

        callbacks.onToolComplete?.({
          id: toolCall.id,
          name: toolCall.function.name,
          result: toolOutput,
          isError
        });

        workingHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: toolOutput
        });
      }
    }

    callbacks.onStatusUpdate?.('Ready');
    return workingHistory;
  }

  /**
   * Fast, direct in-editor code transformation without multi-turn tool loops.
   * Takes user instruction, selected code, and surrounding context; returns replacement code.
   */
  public static async generateInlineTransform(
    params: {
      instruction: string;
      filePath: string;
      languageId: string;
      selectedCode: string;
      prefixContext: string;
      suffixContext: string;
    },
    abortSignal?: AbortSignal
  ): Promise<string> {
    const config = await this.getConfig();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (config.apiKey && config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const systemPrompt = `You are M.I.K.E. (Machine-Integrated Koding Extension) In-Editor Inline Code Transformer.
Your task is to transform the provided user code selection according to the user's instructions.
CRITICAL OUTPUT RULES:
1. Output ONLY the replacement code that should directly replace the provided target selection.
2. DO NOT include conversational chit-chat, explanations, preamble, or markdown notes before or after.
3. If you format the output in markdown code fences (\`\`\`lang ... \`\`\`), output NOTHING ELSE outside the fences.
4. Maintain indentation and coding style matching the surrounding context.
5. Ensure valid syntax and type correctness.`;

    const userPrompt = `File: ${params.filePath} (${params.languageId})
Instruction: ${params.instruction}

Context Before Selection:
${params.prefixContext}

Target Selection to Transform:
${params.selectedCode}

Context After Selection:
${params.suffixContext}`;

    const endpoint = this.lastWorkingEndpoint || this.resolveEndpoint(config.baseUrl);

    const bodyPayload: Record<string, unknown> = {
      model: config.model || 'laguna_S',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: config.temperature !== undefined ? config.temperature : 0.0,
      max_tokens: config.maxTokens || 8192
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      signal: abortSignal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API returned HTTP ${response.status} (${response.statusText}): ${errText.slice(0, 300)}`);
    }

    let rawOutput = '';
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream') && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          if (abortSignal?.aborted) {
            throw new Error('Inline transformation cancelled by user.');
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) {
                  rawOutput += delta;
                }
              } catch {
                // Ignore parse errors on partial lines
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } else {
      const json: any = await response.json();
      rawOutput = json.choices?.[0]?.message?.content || '';
    }

    return this.cleanTransformedCode(rawOutput);
  }

  /**
   * Helper to strip markdown code blocks and extract raw replacement code.
   */
  public static cleanTransformedCode(raw: string): string {
    let clean = raw.trim();
    if (clean.startsWith('```')) {
      const firstNewline = clean.indexOf('\n');
      if (firstNewline !== -1) {
        clean = clean.slice(firstNewline + 1);
      } else {
        clean = clean.replace(/^```[a-zA-Z0-9_-]*/, '');
      }
      if (clean.endsWith('```')) {
        clean = clean.slice(0, -3);
      }
      clean = clean.trim();
    }
    return clean;
  }
}
