import * as vscode from 'vscode';
import {
  AgentClient,
  ChatMessage,
  captureActiveTerminalOutput,
  estimateMessageTokens,
  getModelContextLimit
} from '../agent/client.js';
import { SkillManager, SkillMetadata } from '../skills/skillManager.js';
import { CheckpointManager } from '../tools/checkpointManager.js';
import { SessionManager } from '../agent/sessionManager.js';
import { killRunningToolProcess } from '../tools/fileTools.js';
import { getSidebarHtml } from './sidebarHtml.js';

export class MikeSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'mike-assistant.sidebar';

  private _view?: vscode.WebviewView;
  private _history: ChatMessage[] = [];
  private _abortController: AbortController | null = null;
  private static _outputChannel: vscode.OutputChannel;

  constructor(private readonly _extensionUri: vscode.Uri) {
    if (!MikeSidebarProvider._outputChannel) {
      MikeSidebarProvider._outputChannel = vscode.window.createOutputChannel('M.I.K.E.');
    }
  }

  public static log(msg: string): void {
    MikeSidebarProvider._outputChannel?.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = getSidebarHtml(webviewView.webview, this._extensionUri);
    MikeSidebarProvider.log('Webview resolved and HTML set.');

    // Subscribe to CheckpointManager events to keep session rollback bar synced
    CheckpointManager.onDidChangeCheckpoints(() => {
      this._postMessage({
        type: 'checkpointsUpdated',
        files: CheckpointManager.getModifiedFiles()
      });
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      MikeSidebarProvider.log(`Extension received webview message: ${data.type}`);
      switch (data.type) {
        case 'ready':
        case 'getSkills': {
          const skills = await SkillManager.getSkills();
          this._postMessage({ type: 'skillsLoaded', skills });
          const config = await AgentClient.getConfig();
          this._postMessage({ type: 'configLoaded', config });
          const knownModels = await AgentClient.getKnownModels();
          this._postMessage({ type: 'modelsLoaded', models: knownModels });
          this._postMessage({
            type: 'checkpointsUpdated',
            files: CheckpointManager.getModifiedFiles()
          });

          // Restore active persistent thread
          const activeThread = SessionManager.getActiveThread();
          this._history = [...activeThread.messages];
          this._postMessage({
            type: 'historyLoaded',
            thread: activeThread,
            threads: SessionManager.getAllThreads()
          });
          await this._sendTokenUpdate();
          break;
        }
        case 'getConfig': {
          const config = await AgentClient.getConfig();
          this._postMessage({ type: 'configLoaded', config });
          const knownModels = await AgentClient.getKnownModels();
          this._postMessage({ type: 'modelsLoaded', models: knownModels });
          await this._sendTokenUpdate();
          break;
        }
        case 'getModels': {
          const models = await AgentClient.getKnownModels();
          this._postMessage({ type: 'modelsLoaded', models });
          break;
        }
        case 'discoverModels': {
          const result = await AgentClient.fetchAvailableModels(data.baseUrl, data.apiKey);
          this._postMessage({
            type: 'modelsDiscovered',
            models: result.models,
            sourceUrl: result.sourceUrl
          });
          break;
        }
        case 'getThreads': {
          this._postMessage({
            type: 'threadsUpdated',
            threads: SessionManager.getAllThreads()
          });
          break;
        }
        case 'newThread': {
          const newThread = await SessionManager.createNewThread();
          this._history = [];
          CheckpointManager.clearCheckpoints();
          this._postMessage({
            type: 'historyLoaded',
            thread: newThread,
            threads: SessionManager.getAllThreads()
          });
          this._postMessage({ type: 'checkpointsUpdated', files: [] });
          await this._sendTokenUpdate();
          break;
        }
        case 'switchThread': {
          const thread = await SessionManager.switchThread(data.threadId);
          if (thread) {
            this._history = [...thread.messages];
            this._postMessage({
              type: 'historyLoaded',
              thread,
              threads: SessionManager.getAllThreads()
            });
            await this._sendTokenUpdate();
          }
          break;
        }
        case 'deleteThread': {
          await SessionManager.deleteThread(data.threadId);
          const active = SessionManager.getActiveThread();
          this._history = [...active.messages];
          this._postMessage({
            type: 'historyLoaded',
            thread: active,
            threads: SessionManager.getAllThreads()
          });
          await this._sendTokenUpdate();
          break;
        }
        case 'saveConfig': {
          await this._handleSaveConfig(data.config);
          break;
        }
        case 'testConnection': {
          if (data.config) {
            await AgentClient.savePersistentConfig(data.config);
          }
          const result = await AgentClient.testConnection(data.config);
          this._postMessage({ type: 'testResult', result });
          break;
        }
        case 'sendMessage': {
          await this._handleSendMessage(data.text);
          break;
        }
        case 'revertAll': {
          const result = await CheckpointManager.revertAll();
          vscode.window.showInformationMessage(
            `⏪ M.I.K.E. Rollback: Reverted ${result.revertedCount} modified files and deleted ${result.deletedCount} new files.`
          );
          this._postMessage({ type: 'checkpointsUpdated', files: [] });
          break;
        }
        case 'revertFile': {
          const success = await CheckpointManager.revertFile(data.file);
          if (success) {
            vscode.window.showInformationMessage(`⏪ Reverted ${data.file} to pre-session baseline.`);
          }
          break;
        }
        case 'acceptCheckpoints': {
          CheckpointManager.clearCheckpoints();
          vscode.window.showInformationMessage('✓ Kept session changes.');
          this._postMessage({ type: 'checkpointsUpdated', files: [] });
          break;
        }
        case 'abort': {
          if (this._abortController) {
            MikeSidebarProvider.log('Aborting active agent execution.');
            this._abortController.abort();
            this._abortController = null;
          }
          killRunningToolProcess();
          break;
        }
        case 'killRunningTool': {
          MikeSidebarProvider.log(`Killing running tool process: ${data.toolId || 'all'}`);
          killRunningToolProcess(data.toolId);
          break;
        }
        case 'clear': {
          this._history = [];
          if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
          }
          await SessionManager.saveActiveMessages([]);
          CheckpointManager.clearCheckpoints();
          this._postMessage({ type: 'cleared' });
          this._postMessage({ type: 'checkpointsUpdated', files: [] });
          this._postMessage({ type: 'threadsUpdated', threads: SessionManager.getAllThreads() });
          await this._sendTokenUpdate();
          MikeSidebarProvider.log('Conversation history cleared.');
          break;
        }
        case 'pickSkill': {
          await this.showSkillQuickPick();
          break;
        }
        case 'insertTerminal': {
          const { name, content } = await captureActiveTerminalOutput(10000);

          if (content) {
            this._postMessage({
              type: 'insertText',
              text: `\n\`\`\`terminal [${name}]\n${content}\n\`\`\`\n`
            });
          } else {
            vscode.window.showInformationMessage('💡 Tip: Open a terminal with output or highlight text in the terminal.');
            this._postMessage({
              type: 'insertTag',
              tag: '@terminal '
            });
          }
          break;
        }
      }
    });
  }

  private async _sendTokenUpdate(): Promise<void> {
    try {
      const usedTokens = estimateMessageTokens(this._history);
      const config = await AgentClient.getConfig();
      const maxTokens = getModelContextLimit(config.model);
      this._postMessage({
        type: 'tokenUpdate',
        usedTokens,
        maxTokens,
        model: config.model || 'Default'
      });
    } catch {
      // ignore
    }
  }

  private async _handleSaveConfig(config: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    commandMode?: 'prompt' | 'auto' | 'deny';
    temperature?: number;
    maxTokens?: number;
    maxTurns?: number;
    autoContinue?: boolean;
    customAgentsMdPath?: string;
  }): Promise<void> {
    if (!config) return;

    try {
      await AgentClient.savePersistentConfig(config);
      const savedConfig = await AgentClient.getConfig();
      this._postMessage({ type: 'configSaved', success: true });
      this._postMessage({ type: 'configLoaded', config: savedConfig });
      await this._sendTokenUpdate();
    } catch (err: any) {
      this._postMessage({ type: 'configSaved', success: false, error: err.message });
    }
  }

  public async showSkillQuickPick(): Promise<void> {
    const skills = await SkillManager.getSkills();
    if (skills.length === 0) {
      vscode.window.showInformationMessage('No skills discovered. Create a SKILL.md in .agent/skills/<name>/');
      return;
    }

    const items: (vscode.QuickPickItem & { skill: SkillMetadata })[] = skills.map((s) => ({
      label: `/${s.id}`,
      description: s.name,
      detail: s.description,
      skill: s
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a skill to invoke directly in M.I.K.E....',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      this.insertSkillCommand(`/${selected.skill.id} `);
    }
  }

  public insertSkillCommand(skillPrefix: string): void {
    this._postMessage({ type: 'insertText', text: skillPrefix });
  }

  /**
   * Dispatches a user prompt programmatically (from context menus or CodeActions)
   */
  public async executeUserPrompt(prompt: string): Promise<void> {
    await vscode.commands.executeCommand('mike-assistant.sidebar.focus');
    if (!this._view) {
      await new Promise((r) => setTimeout(r, 250));
    }
    await this._handleSendMessage(prompt);
  }

  private _postMessage(message: unknown): void {
    this._view?.webview.postMessage(message);
  }

  private async _handleSendMessage(rawPrompt: string): Promise<void> {
    if (!rawPrompt || rawPrompt.trim() === '') {
      return;
    }

    const trimmed = rawPrompt.trim();
    MikeSidebarProvider.log(`Handling user prompt: "${trimmed.slice(0, 80)}"`);

    let activatedSkillName: string | undefined = undefined;

    const slashMatch = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
    if (slashMatch) {
      const skill = await SkillManager.findSkill(slashMatch[1]);
      if (skill) {
        activatedSkillName = skill.name;
      }
    }

    this._postMessage({
      type: 'appendUserMessage',
      text: trimmed,
      activatedSkillName
    });

    this._abortController = new AbortController();
    this._postMessage({ type: 'setRunningState', isRunning: true });
    this._postMessage({ type: 'startAssistantResponse' });

    try {
      const { expandedPrompt } = await AgentClient.preprocessUserPrompt(trimmed, {
        onSkillActivated: (name) => {
          this._postMessage({ type: 'skillActivated', skillName: name });
        }
      });

      this._history.push({ role: 'user', content: expandedPrompt });
      await this._sendTokenUpdate();

      this._history = await AgentClient.runAgentLoop(
        this._history,
        {
          onDeltaText: (delta: string) => {
            this._postMessage({ type: 'streamDelta', delta });
          },
          onToolStart: (toolCall) => {
            MikeSidebarProvider.log(`Tool started: ${toolCall.name}`);
            this._postMessage({
              type: 'toolStart',
              id: toolCall.id,
              name: toolCall.name,
              args: toolCall.args
            });
          },
          onToolComplete: (toolCall) => {
            MikeSidebarProvider.log(`Tool completed: ${toolCall.name} (isError: ${toolCall.isError})`);
            this._postMessage({
              type: 'toolComplete',
              id: toolCall.id,
              name: toolCall.name,
              result: toolCall.result,
              isError: toolCall.isError
            });
          },
          onStatusUpdate: (status: string) => {
            this._postMessage({ type: 'statusUpdate', status });
          }
        },
        this._abortController.signal
      );

      // Auto-persist messages to workspaceState
      await SessionManager.saveActiveMessages(this._history);
      this._postMessage({ type: 'threadsUpdated', threads: SessionManager.getAllThreads() });
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'An unknown error occurred.';
      MikeSidebarProvider.log(`Error during execution: ${errorMsg}`);
      this._postMessage({ type: 'streamError', error: errorMsg });
    } finally {
      this._abortController = null;
      this._postMessage({ type: 'setRunningState', isRunning: false });
      this._postMessage({ type: 'statusUpdate', status: 'Ready' });
      await this._sendTokenUpdate();
    }
  }
}
