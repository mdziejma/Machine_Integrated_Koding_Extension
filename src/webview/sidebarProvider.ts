import * as vscode from 'vscode';
import { AgentClient, ChatMessage } from '../agent/client.js';
import { SkillManager, SkillMetadata } from '../skills/skillManager.js';
import { CheckpointManager } from '../tools/checkpointManager.js';
import { SessionManager } from '../agent/sessionManager.js';

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

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
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
          break;
        }
        case 'getConfig': {
          const config = await AgentClient.getConfig();
          this._postMessage({ type: 'configLoaded', config });
          const knownModels = await AgentClient.getKnownModels();
          this._postMessage({ type: 'modelsLoaded', models: knownModels });
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
          MikeSidebarProvider.log('Conversation history cleared.');
          break;
        }
        case 'pickSkill': {
          await this.showSkillQuickPick();
          break;
        }
        case 'insertTerminal': {
          const activeTerminal = vscode.window.activeTerminal;
          let content = '';
          try {
            const priorClipboard = await vscode.env.clipboard.readText();
            await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
            const copied = await vscode.env.clipboard.readText();
            if (copied && copied !== priorClipboard) {
              content = copied;
            } else if (copied && copied.trim().length > 0) {
              content = copied;
            }
          } catch {
            // fallback
          }

          const termName = activeTerminal ? activeTerminal.name : 'Terminal';
          const maxChars = 10000;
          const textSnippet = content && content.trim()
            ? (content.length > maxChars ? content.slice(0, maxChars) + '\n...[truncated]' : content.trim())
            : '';

          if (textSnippet) {
            this._postMessage({
              type: 'insertText',
              text: `\n\`\`\`terminal [${termName}]\n${textSnippet}\n\`\`\`\n`
            });
          } else {
            vscode.window.showInformationMessage('💡 Tip: Highlight text in the Terminal or copy output to paste into M.I.K.E.');
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

  private async _handleSaveConfig(config: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    commandMode?: 'prompt' | 'auto' | 'deny';
    temperature?: number;
    maxTokens?: number;
  }): Promise<void> {
    if (!config) return;

    try {
      await AgentClient.savePersistentConfig(config);
      const savedConfig = await AgentClient.getConfig();
      this._postMessage({ type: 'configSaved', success: true });
      this._postMessage({ type: 'configLoaded', config: savedConfig });
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
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.png'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline'; font-src ${webview.cspSource};">
  <title>M.I.K.E. Assistant</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
      --card-bg: var(--vscode-editor-background);
      --border: var(--vscode-sideBar-border, var(--vscode-widget-border, #333));
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --btn-sec-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --btn-sec-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --input-border: var(--vscode-input-border, #444);
      --highlight: var(--vscode-list-activeSelectionBackground, #094771);
      --highlight-fg: var(--vscode-list-activeSelectionForeground, #ffffff);
      --success: #3fb950;
      --running: #e3b341;
      --error: #f85149;
      --accent: #58a6ff;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    .header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--card-bg);
      flex-shrink: 0;
    }

    .title-group {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.5px;
    }

    .header-logo {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .status-pill {
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      letter-spacing: 0.3px;
      transition: all 0.25s ease;
      user-select: none;
    }

    .status-pill.ready {
      background: rgba(46, 160, 67, 0.15);
      border: 1px solid rgba(63, 185, 80, 0.45);
      color: #3fb950;
    }

    .status-pill.running {
      background: rgba(248, 81, 73, 0.2);
      border: 1px solid rgba(248, 81, 73, 0.6);
      color: #ff7b72;
      box-shadow: 0 0 10px rgba(248, 81, 73, 0.35);
      animation: bannerPulse 1.2s infinite alternate;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #3fb950;
      box-shadow: 0 0 5px #3fb950;
      flex-shrink: 0;
    }

    .status-dot.running {
      background: #f85149;
      box-shadow: 0 0 8px #f85149;
      animation: ping-pulse 0.8s infinite alternate;
    }

    @keyframes ping-pulse {
      0% { transform: scale(0.85); opacity: 0.6; }
      100% { transform: scale(1.35); opacity: 1; filter: drop-shadow(0 0 6px #f85149); }
    }

    @keyframes bannerPulse {
      0% { box-shadow: 0 0 4px rgba(248, 81, 73, 0.2); }
      100% { box-shadow: 0 0 12px rgba(248, 81, 73, 0.5); }
    }

    .activity-bar-scanner {
      height: 2.5px;
      width: 100%;
      background: transparent;
      overflow: hidden;
      flex-shrink: 0;
      position: relative;
    }

    .activity-bar-scanner.running {
      background: rgba(248, 81, 73, 0.2);
    }

    .activity-bar-scanner.running::after {
      content: '';
      position: absolute;
      left: -40%;
      height: 100%;
      width: 40%;
      background: linear-gradient(90deg, transparent, #ff7b72, #e3b341, #58a6ff, transparent);
      animation: scan 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    @keyframes scan {
      0% { left: -40%; }
      100% { left: 100%; }
    }

    .header-actions {
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      background: none;
      border: 1px solid transparent;
      color: var(--fg);
      padding: 3px 6px;
      cursor: pointer;
      border-radius: 4px;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }

    .icon-btn:hover {
      background: var(--btn-sec-bg);
    }

    /* Embedded Config Panel */
    .config-panel {
      display: none;
      padding: 12px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      flex-direction: column;
      gap: 10px;
      flex-shrink: 0;
      max-height: 50vh;
      overflow-y: auto;
    }

    .config-panel.open {
      display: flex;
    }

    .config-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .config-label {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.9;
    }

    .config-input {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 6px 8px;
      font-size: 12px;
      outline: none;
    }

    .config-input:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }

    .config-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 4px;
    }

    .config-status {
      font-size: 11px;
      opacity: 0.8;
    }

    .history-panel {
      display: none;
      padding: 10px 12px;
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      max-height: 250px;
      overflow-y: auto;
      flex-shrink: 0;
    }

    .history-panel.open {
      display: block;
    }

    .history-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: 600;
      font-size: 11px;
      color: var(--fg);
    }

    .threads-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .thread-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-radius: 4px;
      background: var(--bg);
      border: 1px solid var(--border);
      cursor: pointer;
    }

    .thread-item:hover {
      border-color: var(--accent);
    }

    .thread-item.active {
      border-color: var(--accent);
      background: rgba(88, 166, 255, 0.1);
    }

    .thread-title {
      font-size: 11px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 170px;
    }

    .thread-meta {
      font-size: 10px;
      opacity: 0.6;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-del-thread {
      background: transparent;
      border: none;
      color: var(--error);
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      opacity: 0.7;
    }

    .btn-del-thread:hover {
      opacity: 1;
    }

    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 100%;
      line-height: 1.45;
    }

    .message.user {
      align-self: flex-end;
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      padding: 8px 12px;
      border-radius: 8px;
      max-width: 90%;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .skill-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      background: rgba(88, 166, 255, 0.15);
      border: 1px solid var(--accent);
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 4px;
      align-self: flex-start;
    }

    .message.assistant {
      align-self: flex-start;
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 10px 12px;
      border-radius: 8px;
      width: 100%;
      word-break: break-word;
    }

    .message-text {
      white-space: pre-wrap;
    }

    .tool-badge {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 6px 0;
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--bg);
      border-left: 3px solid var(--running);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
    }

    .tool-badge.completed {
      border-left-color: var(--success);
    }

    .tool-badge.error {
      border-left-color: var(--error);
    }

    .tool-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
    }

    .tool-name {
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tool-details {
      display: none;
      margin-top: 4px;
      padding-top: 4px;
      border-top: 1px solid var(--border);
      max-height: 160px;
      overflow-y: auto;
      white-space: pre-wrap;
      font-size: 11px;
      color: var(--fg);
      opacity: 0.9;
    }

    .tool-details.open {
      display: block;
    }

    .error-banner {
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid var(--error);
      color: var(--error);
      padding: 8px;
      border-radius: 6px;
      font-size: 12px;
    }

    .session-changes-bar {
      background: rgba(227, 179, 65, 0.1);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 6px 12px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 11px;
      flex-shrink: 0;
    }

    .session-changes-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .session-changes-title {
      font-weight: 600;
      color: var(--running);
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .session-changes-actions {
      display: flex;
      gap: 5px;
    }

    .btn-reject {
      background: var(--error);
      color: #ffffff;
      border: none;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-reject:hover {
      background: #ff6b6b;
    }

    .btn-accept {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-size: 11px;
      cursor: pointer;
    }

    .btn-accept:hover {
      background: var(--highlight);
    }

    .session-changes-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 80px;
      overflow-y: auto;
    }

    .session-file-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--card-bg);
      border: 1px solid var(--border);
    }

    .session-file-name {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .btn-revert-single {
      background: transparent;
      border: none;
      color: var(--error);
      cursor: pointer;
      font-size: 10px;
      padding: 0 4px;
    }

    .btn-revert-single:hover {
      text-decoration: underline;
    }

    .input-container {
      position: relative;
      border-top: 1px solid var(--border);
      padding: 8px 12px 12px 12px;
      background: var(--card-bg);
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .context-bar {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .context-chip {
      background: var(--badge-bg);
      color: var(--badge-fg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      opacity: 0.85;
      user-select: none;
    }

    .context-chip:hover {
      opacity: 1;
      border-color: var(--accent);
      color: var(--accent);
    }

    .autocomplete-menu {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 12px;
      right: 12px;
      max-height: 200px;
      overflow-y: auto;
      background: var(--card-bg);
      border: 1px solid var(--vscode-focusBorder, #007fd4);
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      z-index: 100;
      display: none;
    }

    .autocomplete-menu.visible {
      display: block;
    }

    .autocomplete-item {
      padding: 6px 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-bottom: 1px solid var(--border);
    }

    .autocomplete-item:last-child {
      border-bottom: none;
    }

    .autocomplete-item.selected,
    .autocomplete-item:hover {
      background-color: var(--highlight);
      color: var(--highlight-fg);
    }

    .item-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .item-id {
      font-weight: 600;
      font-family: var(--vscode-editor-font-family, monospace);
      color: var(--accent);
    }

    .autocomplete-item.selected .item-id,
    .autocomplete-item:hover .item-id {
      color: var(--highlight-fg);
    }

    .item-source {
      font-size: 10px;
      opacity: 0.7;
      text-transform: uppercase;
      padding: 1px 4px;
      background: var(--badge-bg);
      color: var(--badge-fg);
      border-radius: 3px;
    }

    .item-desc {
      font-size: 11px;
      opacity: 0.8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .textarea-wrapper {
      position: relative;
    }

    textarea {
      width: 100%;
      min-height: 52px;
      max-height: 160px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 6px;
      padding: 8px;
      font-family: inherit;
      font-size: 13px;
      resize: none;
      outline: none;
      line-height: 1.35;
    }

    textarea:focus {
      border-color: var(--vscode-focusBorder, #007fd4);
    }

    .controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .status-text {
      font-size: 11px;
      opacity: 0.9;
    }

    .status-indicator-bar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 6px;
      transition: all 0.2s ease;
      user-select: none;
    }

    .status-indicator-bar.ready {
      color: #3fb950;
      background: rgba(46, 160, 67, 0.1);
      border: 1px solid rgba(63, 185, 80, 0.3);
    }

    .status-indicator-bar.running {
      color: #ff7b72;
      background: rgba(248, 81, 73, 0.15);
      border: 1px solid rgba(248, 81, 73, 0.4);
      animation: bannerPulse 1.2s infinite alternate;
    }

    .spinner-icon {
      display: none;
      width: 10px;
      height: 10px;
      border: 2px solid rgba(248, 81, 73, 0.3);
      border-top-color: #f85149;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    .spinner-icon.running {
      display: inline-block;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .live-working-indicator {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(248, 81, 73, 0.12);
      border: 1px solid rgba(248, 81, 73, 0.4);
      color: #ff7b72;
      border-radius: 16px;
      font-size: 11.5px;
      font-weight: 500;
      align-self: flex-start;
      margin: 4px 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .btn-group {
      display: flex;
      gap: 6px;
    }

    button.primary {
      background: #238636;
      color: #ffffff;
      border: 1px solid #2ea043;
      border-radius: 4px;
      padding: 5px 12px;
      font-weight: 600;
      cursor: pointer;
    }

    button.primary:hover {
      background: #2ea043;
    }

    button#stop-btn {
      background: #da3633;
      color: #ffffff;
      border: 1px solid #f85149;
      border-radius: 4px;
      padding: 5px 12px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 0 8px rgba(248, 81, 73, 0.4);
    }

    button#stop-btn:hover {
      background: #f85149;
    }

    button.secondary {
      background: var(--btn-sec-bg);
      color: var(--btn-sec-fg);
      border: none;
      border-radius: 4px;
      padding: 5px 10px;
      cursor: pointer;
    }

    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    textarea.generating {
      border-color: #f85149 !important;
      box-shadow: 0 0 6px rgba(248, 81, 73, 0.25);
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title-group">
      <img src="${logoUri}" alt="M.I.K.E." class="header-logo" />
      <span>M.I.K.E.</span>
      <div id="status-pill" class="status-pill ready">
        <div id="status-dot" class="status-dot"></div>
        <span id="status-label">READY</span>
      </div>
    </div>
    <div class="header-actions">
      <button id="new-chat-btn" class="icon-btn" title="Start New Conversation">+ New</button>
      <button id="history-btn" class="icon-btn" title="Saved Chat Threads">💬 History</button>
      <button id="config-btn" class="icon-btn" title="Configure Connection">⚙️ Config</button>
      <button id="skills-btn" class="icon-btn" title="Browse Skills">⚡ Skills</button>
      <button id="clear-btn" class="icon-btn" title="Clear Current Chat">Clear</button>
    </div>
  </div>
  <div id="activity-scanner" class="activity-bar-scanner"></div>

  <!-- In-Sidebar Thread History Drawer -->
  <div id="history-panel" class="history-panel">
    <div class="history-panel-header">
      <span>Saved Chat Threads</span>
      <button id="drawer-new-btn" class="icon-btn" style="padding: 2px 6px;">+ New Chat</button>
    </div>
    <div id="threads-list" class="threads-list"></div>
  </div>

  <!-- In-Sidebar Settings Panel -->
  <div id="config-panel" class="config-panel">
    <div class="config-field">
      <label class="config-label">Base URL</label>
      <input id="cfg-base-url" class="config-input" type="text" placeholder="http://localhost:11434/v1 or https://api.openai.com/v1" />
    </div>
    <div class="config-field">
      <label class="config-label">API Key</label>
      <input id="cfg-api-key" class="config-input" type="password" placeholder="Paste API Key here (or leave blank for local models)..." />
    </div>
    <div class="config-field">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <label class="config-label">Model Selection</label>
        <button id="cfg-discover-models-btn" class="icon-btn" type="button" title="Auto-discover models from server /models endpoint" style="font-size: 10.5px; padding: 1px 6px; color: var(--accent); border: 1px solid rgba(88, 166, 255, 0.4);">
          🔄 Auto-Discover
        </button>
      </div>
      <select id="cfg-model-select" class="config-input">
        <option value="">(Click Auto-Discover to load models)</option>
      </select>
      <input id="cfg-model" class="config-input" type="text" placeholder="Type or paste model name (e.g. qwen2.5-coder, gpt-4o)" style="display: none; margin-top: 4px;" />
    </div>
    <div class="config-field">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <label class="config-label">Temperature: <span id="cfg-temp-val" style="color: var(--accent); font-weight: 700;">0.0 (Deterministic)</span></label>
      </div>
      <input id="cfg-temperature" type="range" min="0.0" max="1.0" step="0.1" value="0.0" style="width: 100%; cursor: pointer; accent-color: var(--accent);" />
      <span style="font-size: 10px; opacity: 0.65;">Default: 0.0 for deterministic, typo-free code generation.</span>
    </div>
    <div class="config-field">
      <label class="config-label">Max Output Tokens</label>
      <input id="cfg-max-tokens" class="config-input" type="number" min="1024" max="16384" step="1024" value="8192" />
      <span style="font-size: 10px; opacity: 0.65;">Default: 8192 tokens (prevents code truncation).</span>
    </div>
    <div class="config-field">
      <label class="config-label">Command Execution Policy</label>
      <select id="cfg-cmd-mode" class="config-input">
        <option value="prompt">Ask Before Running (Prompt)</option>
        <option value="auto">Always Allow (Autonomous)</option>
        <option value="deny">Disabled (Block Shell)</option>
      </select>
    </div>
    <div class="config-actions">
      <span id="cfg-status" class="config-status"></span>
      <div class="btn-group">
        <button id="cfg-test-btn" class="secondary">Test</button>
        <button id="cfg-save-btn" class="primary">Save</button>
      </div>
    </div>
  </div>

  <div id="chat-messages" class="chat-messages">
    <div class="message assistant">
      <div class="message-text">Hello! I am M.I.K.E. (Machine-Integrated Koding Extension).

Type <b>/</b> to search and activate specialized skills (e.g. <code>/audio_design</code>, <code>/react_components</code>), or ask me to inspect and modify your workspace!</div>
    </div>
  </div>
  <div id="live-working-indicator" class="live-working-indicator">
    <div class="spinner-icon running"></div>
    <span id="live-working-text">M.I.K.E. is thinking & processing...</span>
  </div>

  <!-- Session Checkpoints & Rollback Bar -->
  <div id="session-changes-bar" class="session-changes-bar" style="display: none;">
    <div class="session-changes-header">
      <span id="session-changes-title" class="session-changes-title">📝 0 files modified</span>
      <div class="session-changes-actions">
        <button id="btn-reject-all" class="btn-reject" type="button" title="Revert all files modified in this session back to pre-AI baseline">⏪ Reject All</button>
        <button id="btn-accept-all" class="btn-accept" type="button" title="Accept all session modifications and clear checkpoints">✓ Keep</button>
      </div>
    </div>
    <div id="session-changes-list" class="session-changes-list"></div>
  </div>

  <div class="input-container">
    <div id="autocomplete-menu" class="autocomplete-menu"></div>

    <div class="context-bar">
      <button id="add-editor-btn" class="context-chip" type="button" data-tag="@editor" title="Insert @editor to attach active file to prompt">📄 @editor</button>
      <button id="add-selection-btn" class="context-chip" type="button" data-tag="@selection" title="Insert @selection to attach highlighted lines to prompt">✂️ @selection</button>
      <button id="add-terminal-btn" class="context-chip" type="button" data-tag="@terminal" title="Insert @terminal to attach active terminal output or selection to prompt">📟 @terminal</button>
    </div>

    <div class="textarea-wrapper">
      <textarea id="prompt-input" placeholder="Ask M.I.K.E. or type / for direct skills... (Enter to send, Shift+Enter for newline)"></textarea>
    </div>
    <div class="controls">
      <div id="sub-status-container" class="status-indicator-bar ready">
        <div id="spinner-icon" class="spinner-icon"></div>
        <span id="sub-status">🟢 Waiting for your input</span>
      </div>
      <div class="btn-group">
        <button id="stop-btn" style="display: none;">⏹ Stop</button>
        <button id="send-btn" class="primary">Send</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      const chatContainer = document.getElementById('chat-messages');
      const sessionChangesBar = document.getElementById('session-changes-bar');
      const sessionChangesTitle = document.getElementById('session-changes-title');
      const sessionChangesList = document.getElementById('session-changes-list');
      const btnRejectAll = document.getElementById('btn-reject-all');
      const btnAcceptAll = document.getElementById('btn-accept-all');
      const promptInput = document.getElementById('prompt-input');
      const sendBtn = document.getElementById('send-btn');
      const stopBtn = document.getElementById('stop-btn');
      const clearBtn = document.getElementById('clear-btn');
      const newChatBtn = document.getElementById('new-chat-btn');
      const historyBtn = document.getElementById('history-btn');
      const drawerNewBtn = document.getElementById('drawer-new-btn');
      const historyPanel = document.getElementById('history-panel');
      const threadsList = document.getElementById('threads-list');
      const skillsBtn = document.getElementById('skills-btn');
      const configBtn = document.getElementById('config-btn');
      const configPanel = document.getElementById('config-panel');
      const cfgBaseUrl = document.getElementById('cfg-base-url');
      const cfgApiKey = document.getElementById('cfg-api-key');
      const cfgDiscoverModelsBtn = document.getElementById('cfg-discover-models-btn');
      const cfgModelSelect = document.getElementById('cfg-model-select');
      const cfgModel = document.getElementById('cfg-model');
      const cfgTemperature = document.getElementById('cfg-temperature');
      const cfgTempVal = document.getElementById('cfg-temp-val');
      const cfgMaxTokens = document.getElementById('cfg-max-tokens');
      const cfgCmdMode = document.getElementById('cfg-cmd-mode');
      const cfgSaveBtn = document.getElementById('cfg-save-btn');
      const cfgTestBtn = document.getElementById('cfg-test-btn');
      const cfgStatus = document.getElementById('cfg-status');

      const statusLabel = document.getElementById('status-label');
      const subStatus = document.getElementById('sub-status');
      const statusDot = document.getElementById('status-dot');
      const autocompleteMenu = document.getElementById('autocomplete-menu');

      function insertTag(tag) {
        if (!promptInput) return;
        const val = promptInput.value || '';
        const start = (promptInput.selectionStart !== null && promptInput.selectionStart !== undefined) ? promptInput.selectionStart : val.length;
        const end = (promptInput.selectionEnd !== null && promptInput.selectionEnd !== undefined) ? promptInput.selectionEnd : val.length;
        const needsLeadingSpace = (start > 0 && !/\s/.test(val[start - 1]));
        const insertContent = (needsLeadingSpace ? ' ' : '') + tag + ' ';
        promptInput.value = val.slice(0, start) + insertContent + val.slice(end);
        const newPos = start + insertContent.length;
        promptInput.setSelectionRange(newPos, newPos);
        promptInput.focus();
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
      }
      window.insertTag = insertTag;

      document.addEventListener('click', function(e) {
        const chip = e.target && e.target.closest ? e.target.closest('.context-chip') : null;
        if (chip) {
          e.preventDefault();
          const tag = chip.getAttribute('data-tag') || (chip.id === 'add-editor-btn' ? '@editor' : chip.id === 'add-selection-btn' ? '@selection' : '@terminal');
          insertTag(tag);
        }
      });

      let currentAssistantMsgEl = null;
      let currentAssistantTextEl = null;
      let availableSkills = [];
      let selectedIndex = 0;
      let filteredSkills = [];
      let knownModelsList = [];

      function updateTempDisplay(val) {
        const num = parseFloat(val);
        let label = num.toFixed(1);
        if (num === 0.0) {
          label += ' (Deterministic - No Typos)';
        } else if (num <= 0.3) {
          label += ' (Precise Code)';
        } else if (num <= 0.7) {
          label += ' (Balanced)';
        } else {
          label += ' (Creative)';
        }
        if (cfgTempVal) {
          cfgTempVal.textContent = label;
        }
      }

      function getEffectiveModel() {
        if (cfgModelSelect && cfgModelSelect.value === 'custom') {
          return (cfgModel && cfgModel.value.trim()) ? cfgModel.value.trim() : (knownModelsList[0] || 'laguna-s-2.1-p5.en-es');
        }
        return (cfgModelSelect && cfgModelSelect.value) ? cfgModelSelect.value : (cfgModel?.value.trim() || knownModelsList[0] || 'laguna-s-2.1-p5.en-es');
      }

      function renderModelOptions(models, targetSelection, replaceList) {
        if (Array.isArray(models) && models.length > 0) {
          if (replaceList) {
            knownModelsList = [...models.filter(Boolean)];
          } else {
            models.forEach(function(m) {
              if (m && knownModelsList.indexOf(m) === -1) {
                knownModelsList.push(m);
              }
            });
          }
        }

        if (knownModelsList.length === 0) {
          knownModelsList = [
            'qwen2.5-coder',
            'deepseek-coder',
            'gpt-4o',
            'gpt-4o-mini',
            'claude-3-5-sonnet',
            'laguna-s-2.1-p5.en-es',
            'laguna_S'
          ];
        }

        let activeModel = targetSelection;
        if (!activeModel || activeModel === 'custom') {
          activeModel = (cfgModel && cfgModel.value.trim()) ? cfgModel.value.trim() : knownModelsList[0];
        }

        if (activeModel && activeModel !== 'custom' && knownModelsList.indexOf(activeModel) === -1) {
          knownModelsList.unshift(activeModel);
        }

        if (cfgModelSelect) {
          cfgModelSelect.innerHTML = '';
          knownModelsList.forEach(function(m) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            if (m === activeModel) {
              opt.selected = true;
            }
            cfgModelSelect.appendChild(opt);
          });

          const customOpt = document.createElement('option');
          customOpt.value = 'custom';
          customOpt.textContent = '✏️ Enter Custom Model Name...';
          if (activeModel && knownModelsList.indexOf(activeModel) === -1) {
            customOpt.selected = true;
          }
          cfgModelSelect.appendChild(customOpt);
        }

        syncModelDisplay(activeModel);
      }

      function syncModelDisplay(modelName) {
        if (modelName && knownModelsList.indexOf(modelName) !== -1) {
          if (cfgModelSelect) cfgModelSelect.value = modelName;
          if (cfgModel) {
            cfgModel.value = modelName;
            cfgModel.style.display = 'none';
          }
        } else {
          if (cfgModelSelect) cfgModelSelect.value = 'custom';
          if (cfgModel) {
            cfgModel.value = modelName || '';
            cfgModel.style.display = 'block';
          }
        }
      }

      if (cfgModelSelect) {
        cfgModelSelect.addEventListener('change', function() {
          if (cfgModelSelect.value === 'custom') {
            if (cfgModel) {
              cfgModel.style.display = 'block';
              cfgModel.focus();
            }
          } else {
            if (cfgModel) {
              cfgModel.value = cfgModelSelect.value;
              cfgModel.style.display = 'none';
            }
          }
        });
      }

      if (cfgModel) {
        cfgModel.addEventListener('input', function() {
          const val = cfgModel.value.trim();
          if (knownModelsList.indexOf(val) !== -1) {
            if (cfgModelSelect) cfgModelSelect.value = val;
          } else {
            if (cfgModelSelect) cfgModelSelect.value = 'custom';
          }
        });
      }

      if (cfgDiscoverModelsBtn) {
        cfgDiscoverModelsBtn.addEventListener('click', function() {
          cfgStatus.textContent = 'Discovering models from /models...';
          vscode.postMessage({
            type: 'discoverModels',
            baseUrl: cfgBaseUrl.value.trim(),
            apiKey: cfgApiKey.value.trim()
          });
        });
      }

      if (cfgTemperature) {
        cfgTemperature.addEventListener('input', function() {
          updateTempDisplay(cfgTemperature.value);
        });
      }

      function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }

      function autoResizeTextarea() {
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
      }

      configBtn.addEventListener('click', function() {
        configPanel.classList.toggle('open');
        if (configPanel.classList.contains('open')) {
          vscode.postMessage({ type: 'getConfig' });
        }
      });

      cfgSaveBtn.addEventListener('click', function() {
        const baseUrl = cfgBaseUrl.value.trim();
        const apiKey = cfgApiKey.value.trim();
        const model = getEffectiveModel();
        const commandMode = cfgCmdMode.value;
        const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
        const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;

        cfgStatus.textContent = 'Saving...';
        vscode.postMessage({
          type: 'saveConfig',
          config: {
            baseUrl: baseUrl,
            apiKey: apiKey,
            model: model,
            commandMode: commandMode,
            temperature: temperature,
            maxTokens: maxTokens
          }
        });
      });

      cfgTestBtn.addEventListener('click', function() {
        cfgStatus.textContent = 'Probing connection...';
        const model = getEffectiveModel();
        const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
        const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;

        vscode.postMessage({
          type: 'testConnection',
          config: {
            baseUrl: cfgBaseUrl.value.trim(),
            apiKey: cfgApiKey.value.trim(),
            model: model,
            commandMode: cfgCmdMode.value,
            temperature: temperature,
            maxTokens: maxTokens
          }
        });
      });

      skillsBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'pickSkill' });
      });

      promptInput.addEventListener('input', function() {
        autoResizeTextarea();
        checkAutocomplete();
      });

      const contextMentions = [
        { id: 'terminal', name: 'Terminal Output', description: 'Attach active terminal buffer or selection', source: 'context', triggerChar: '@' },
        { id: 'editor', name: 'Active Editor File', description: 'Attach full active file from editor', source: 'context', triggerChar: '@' },
        { id: 'selection', name: 'Code Selection', description: 'Attach highlighted editor code selection', source: 'context', triggerChar: '@' }
      ];

      let autocompleteItems = [];
      let activeTriggerChar = '/';

      function checkAutocomplete() {
        const val = promptInput.value;
        const cursor = promptInput.selectionStart || 0;
        const textBeforeCursor = val.slice(0, cursor);
        const lastSlash = textBeforeCursor.lastIndexOf('/');
        const lastAt = textBeforeCursor.lastIndexOf('@');

        let lastTrigger = -1;
        let triggerChar = '';

        if (lastSlash > lastAt) {
          lastTrigger = lastSlash;
          triggerChar = '/';
        } else if (lastAt > lastSlash) {
          lastTrigger = lastAt;
          triggerChar = '@';
        }

        if (lastTrigger !== -1) {
          const isAtStart = (lastTrigger === 0);
          const isAfterSpace = (lastTrigger > 0 && /\s/.test(textBeforeCursor[lastTrigger - 1]));
          
          if (isAtStart || isAfterSpace) {
            const query = textBeforeCursor.slice(lastTrigger + 1).toLowerCase();
            if (query.indexOf(' ') === -1) {
              activeTriggerChar = triggerChar;
              if (triggerChar === '/') {
                autocompleteItems = availableSkills.filter(function(s) {
                  return !query ||
                    s.id.toLowerCase().indexOf(query) !== -1 ||
                    s.name.toLowerCase().indexOf(query) !== -1 ||
                    s.description.toLowerCase().indexOf(query) !== -1;
                }).map(function(s) { return Object.assign({}, s, { triggerChar: '/' }); });
              } else {
                autocompleteItems = contextMentions.filter(function(m) {
                  return !query ||
                    m.id.toLowerCase().indexOf(query) !== -1 ||
                    m.name.toLowerCase().indexOf(query) !== -1 ||
                    m.description.toLowerCase().indexOf(query) !== -1;
                });
              }

              if (autocompleteItems.length > 0) {
                renderAutocomplete(autocompleteItems);
                return;
              }
            }
          }
        }
        hideAutocomplete();
      }

      function renderAutocomplete(items) {
        autocompleteMenu.innerHTML = '';
        selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

        items.forEach(function(itemData, idx) {
          const item = document.createElement('div');
          item.className = 'autocomplete-item' + (idx === selectedIndex ? ' selected' : '');
          
          const header = document.createElement('div');
          header.className = 'item-header';
          
          const idSpan = document.createElement('span');
          idSpan.className = 'item-id';
          idSpan.textContent = (itemData.triggerChar || '/') + itemData.id;

          const sourceSpan = document.createElement('span');
          sourceSpan.className = 'item-source';
          sourceSpan.textContent = itemData.source;

          header.appendChild(idSpan);
          header.appendChild(sourceSpan);

          const desc = document.createElement('div');
          desc.className = 'item-desc';
          desc.textContent = itemData.name + (itemData.description ? ' — ' + itemData.description : '');

          item.appendChild(header);
          item.appendChild(desc);

          item.addEventListener('mousedown', function(e) {
            e.preventDefault();
            selectAutocompleteItem(itemData);
          });

          autocompleteMenu.appendChild(item);
        });

        autocompleteMenu.classList.add('visible');
      }

      function hideAutocomplete() {
        autocompleteMenu.classList.remove('visible');
        selectedIndex = 0;
      }

      function selectAutocompleteItem(itemData) {
        const val = promptInput.value;
        const cursor = promptInput.selectionStart || 0;
        const textBeforeCursor = val.slice(0, cursor);
        const textAfterCursor = val.slice(cursor);
        const trig = itemData.triggerChar || activeTriggerChar || '/';
        const lastTrig = textBeforeCursor.lastIndexOf(trig);

        const prefix = (lastTrig !== -1) ? textBeforeCursor.slice(0, lastTrig) : '';
        promptInput.value = prefix + trig + itemData.id + ' ' + textAfterCursor;
        
        hideAutocomplete();
        promptInput.focus();
        autoResizeTextarea();
      }

      promptInput.addEventListener('keydown', function(e) {
        if (autocompleteMenu.classList.contains('visible')) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = (selectedIndex + 1) % autocompleteItems.length;
            updateSelectedAutocomplete();
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = (selectedIndex - 1 + autocompleteItems.length) % autocompleteItems.length;
            updateSelectedAutocomplete();
            return;
          }
          if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
            if (autocompleteItems[selectedIndex]) {
              e.preventDefault();
              selectAutocompleteItem(autocompleteItems[selectedIndex]);
              return;
            }
          }
          if (e.key === 'Escape') {
            hideAutocomplete();
            return;
          }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          triggerSend();
        }
      });

      function updateSelectedAutocomplete() {
        const items = autocompleteMenu.querySelectorAll('.autocomplete-item');
        items.forEach(function(it, idx) {
          if (idx === selectedIndex) {
            it.classList.add('selected');
            it.scrollIntoView({ block: 'nearest' });
          } else {
            it.classList.remove('selected');
          }
        });
      }

      sendBtn.addEventListener('click', triggerSend);

      stopBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'abort' });
      });

      clearBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'clear' });
      });

      if (historyBtn) {
        historyBtn.addEventListener('click', function() {
          historyPanel.classList.toggle('open');
          if (historyPanel.classList.contains('open')) {
            vscode.postMessage({ type: 'getThreads' });
          }
        });
      }

      if (newChatBtn) {
        newChatBtn.addEventListener('click', function() {
          historyPanel.classList.remove('open');
          vscode.postMessage({ type: 'newThread' });
        });
      }

      if (drawerNewBtn) {
        drawerNewBtn.addEventListener('click', function() {
          historyPanel.classList.remove('open');
          vscode.postMessage({ type: 'newThread' });
        });
      }

      function formatTimeAgo(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        return days + 'd ago';
      }

      function renderThreads(threads) {
        threadsList.innerHTML = '';
        if (!threads || threads.length === 0) {
          const empty = document.createElement('div');
          empty.style.padding = '8px';
          empty.style.opacity = '0.6';
          empty.style.fontSize = '11px';
          empty.textContent = 'No previous threads';
          threadsList.appendChild(empty);
          return;
        }

        threads.forEach(function(t) {
          const item = document.createElement('div');
          item.className = 'thread-item' + (t.isActive ? ' active' : '');
          
          const info = document.createElement('div');
          info.style.flex = '1';
          info.style.minWidth = '0';

          const title = document.createElement('div');
          title.className = 'thread-title';
          title.textContent = t.title || 'New Chat';
          title.title = t.title || 'New Chat';

          const meta = document.createElement('div');
          meta.className = 'thread-meta';
          meta.textContent = (t.messageCount || 0) + ' msgs • ' + formatTimeAgo(t.updatedAt);

          info.appendChild(title);
          info.appendChild(meta);

          const delBtn = document.createElement('button');
          delBtn.className = 'btn-del-thread';
          delBtn.innerHTML = '✕';
          delBtn.title = 'Delete Thread';
          delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            vscode.postMessage({ type: 'deleteThread', threadId: t.id });
          });

          item.appendChild(info);
          item.appendChild(delBtn);

          item.addEventListener('click', function() {
            historyPanel.classList.remove('open');
            vscode.postMessage({ type: 'switchThread', threadId: t.id });
          });

          threadsList.appendChild(item);
        });
      }

      function renderHistoryMessages(thread) {
        chatContainer.innerHTML = '';
        const messages = (thread && thread.messages) ? thread.messages : [];
        const nonSystem = messages.filter(function(m) { return m.role !== 'system'; });

        if (nonSystem.length === 0) {
          const welcome = document.createElement('div');
          welcome.className = 'message assistant';
          welcome.innerHTML = '<div class="message-text">Hello! I\\'m M.I.K.E., your autonomous coding assistant. How can I help you today?</div>';
          chatContainer.appendChild(welcome);
          return;
        }

        const toolResults = {};
        messages.forEach(function(m) {
          if (m.role === 'tool' && m.tool_call_id) {
            toolResults[m.tool_call_id] = m.content;
          }
        });

        messages.forEach(function(m) {
          if (m.role === 'user') {
            const userMsg = document.createElement('div');
            userMsg.className = 'message user';

            let content = m.content || '';
            const skillMatch = content.match(/\\[SPECIALIZED SKILL ACTIVATED: ([^\\]]+)\\]/);
            if (skillMatch) {
              const skillBadge = document.createElement('div');
              skillBadge.className = 'skill-badge';
              skillBadge.innerHTML = '⚡ Skill: ' + escapeHtml(skillMatch[1]);
              userMsg.appendChild(skillBadge);
              content = content.replace(/\\[SPECIALIZED SKILL ACTIVATED: [^\\]]+\\]\\n?/, '');
            }

            const textSpan = document.createElement('div');
            textSpan.textContent = content;
            userMsg.appendChild(textSpan);
            chatContainer.appendChild(userMsg);
          } else if (m.role === 'assistant') {
            const asstMsg = document.createElement('div');
            asstMsg.className = 'message assistant';

            if (m.content) {
              const textSpan = document.createElement('div');
              textSpan.className = 'message-text';
              textSpan.textContent = m.content;
              asstMsg.appendChild(textSpan);
            }

            if (m.tool_calls && Array.isArray(m.tool_calls)) {
              m.tool_calls.forEach(function(tc) {
                const name = tc.function ? tc.function.name : 'tool';
                const args = tc.function ? tc.function.arguments : '';
                const badge = createToolBadge(tc.id, name, args);
                badge.classList.remove('running');
                badge.classList.add('completed');
                const titleSpan = badge.querySelector('.tool-name span');
                if (titleSpan) titleSpan.textContent = '✓ ' + name + ' completed';

                if (toolResults[tc.id]) {
                  const details = badge.querySelector('.tool-details');
                  if (details) {
                    details.textContent += '\\nResult:\\n' + toolResults[tc.id];
                  }
                }
                asstMsg.appendChild(badge);
              });
            }

            chatContainer.appendChild(asstMsg);
          }
        });

        scrollToBottom();
      }

      function triggerSend() {
        const text = promptInput.value.trim();
        if (!text) return;
        hideAutocomplete();
        promptInput.value = '';
        autoResizeTextarea();
        vscode.postMessage({ type: 'sendMessage', text: text });
      }

      function getToolIcon(name) {
        if (name === 'find_symbol') return '🔍';
        if (name === 'grep_search') return '🔎';
        if (name === 'get_diagnostics') return '🩺';
        if (name === 'run_command') return '⚡';
        if (name === 'write_file') return '✏️';
        if (name === 'read_file') return '📖';
        if (name === 'list_dir') return '📁';
        if (name === 'load_skill' || name === 'list_skills') return '⚡';
        return '⚙';
      }

      function createToolBadge(id, name, args) {
        const badge = document.createElement('div');
        badge.className = 'tool-badge';
        badge.id = 'tool-' + id;

        const header = document.createElement('div');
        header.className = 'tool-header';

        const icon = getToolIcon(name);
        const title = document.createElement('div');
        title.className = 'tool-name';
        title.innerHTML = icon + ' <span>' + escapeHtml(name) + ' running...</span>';

        const toggle = document.createElement('span');
        toggle.innerText = '▼';
        toggle.style.fontSize = '9px';

        header.appendChild(title);
        header.appendChild(toggle);

        const details = document.createElement('div');
        details.className = 'tool-details';
        details.textContent = 'Arguments: ' + args;

        header.addEventListener('click', function() {
          details.classList.toggle('open');
          toggle.innerText = details.classList.contains('open') ? '▲' : '▼';
        });

        badge.appendChild(header);
        badge.appendChild(details);
        return badge;
      }

      function escapeHtml(str) {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (!msg) return;

        switch (msg.type) {
          case 'historyLoaded': {
            renderHistoryMessages(msg.thread);
            if (msg.threads) {
              renderThreads(msg.threads);
            }
            break;
          }
          case 'threadsUpdated': {
            if (msg.threads) {
              renderThreads(msg.threads);
            }
            break;
          }
          case 'skillsLoaded': {
            availableSkills = msg.skills || [];
            break;
          }
          case 'modelsLoaded': {
            if (msg.models && msg.models.length > 0) {
              const currentModel = (cfgModel ? cfgModel.value.trim() : '') || getEffectiveModel();
              renderModelOptions(msg.models, currentModel, true);
            }
            break;
          }
          case 'modelsDiscovered': {
            if (msg.models && msg.models.length > 0) {
              const selected = (cfgModel && msg.models.indexOf(cfgModel.value.trim()) !== -1) ? cfgModel.value.trim() : msg.models[0];
              renderModelOptions(msg.models, selected, true);
              cfgStatus.textContent = '✔ Found ' + msg.models.length + ' models (selected ' + selected + ')';
              setTimeout(function() { cfgStatus.textContent = ''; }, 4000);
            } else {
              cfgStatus.textContent = 'No models endpoint found';
              setTimeout(function() { cfgStatus.textContent = ''; }, 3000);
            }
            break;
          }
          case 'configLoaded': {
            if (msg.config) {
              cfgBaseUrl.value = msg.config.baseUrl || '';
              const currentModel = msg.config.model || '';
              if (currentModel) {
                renderModelOptions(null, currentModel, false);
              }

              if (msg.config.apiKey) {
                cfgApiKey.value = msg.config.apiKey;
              }
              if (msg.config.commandMode) {
                cfgCmdMode.value = msg.config.commandMode;
              }
              if (msg.config.temperature !== undefined) {
                if (cfgTemperature) {
                  cfgTemperature.value = msg.config.temperature;
                  updateTempDisplay(msg.config.temperature);
                }
              } else {
                if (cfgTemperature) {
                  cfgTemperature.value = 0.0;
                  updateTempDisplay(0.0);
                }
              }
              if (msg.config.maxTokens !== undefined) {
                if (cfgMaxTokens) {
                  cfgMaxTokens.value = msg.config.maxTokens;
                }
              } else {
                if (cfgMaxTokens) {
                  cfgMaxTokens.value = 8192;
                }
              }
            }
            break;
          }
          case 'configSaved': {
            if (msg.success) {
              cfgStatus.textContent = '✓ Saved';
              setTimeout(function() { cfgStatus.textContent = ''; }, 3000);
            } else {
              cfgStatus.textContent = 'Error: ' + (msg.error || 'Failed to save');
            }
            break;
          }
          case 'testResult': {
            if (msg.result && msg.result.success) {
              cfgStatus.textContent = '✔ Connected (HTTP 200)';
              if (msg.result.discoveredModels && msg.result.discoveredModels.length > 0) {
                const selected = (cfgModel && msg.result.discoveredModels.indexOf(cfgModel.value.trim()) !== -1)
                  ? cfgModel.value.trim()
                  : msg.result.discoveredModels[0];
                renderModelOptions(msg.result.discoveredModels, selected, true);
              }
              if (msg.result.workingEndpoint) {
                cfgBaseUrl.value = msg.result.workingEndpoint;
                const model = getEffectiveModel();
                const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
                const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;

                vscode.postMessage({
                  type: 'saveConfig',
                  config: {
                    baseUrl: msg.result.workingEndpoint,
                    apiKey: cfgApiKey.value.trim(),
                    model: model,
                    commandMode: cfgCmdMode.value,
                    temperature: temperature,
                    maxTokens: maxTokens
                  }
                });
              }
            } else {
              cfgStatus.textContent = '✖ Failed. Check logs.';
            }
            break;
          }
          case 'insertText': {
            const currentVal = promptInput.value;
            if (currentVal && currentVal.trim()) {
              promptInput.value = currentVal + (currentVal.endsWith(String.fromCharCode(10)) ? '' : String.fromCharCode(10)) + msg.text;
            } else {
              promptInput.value = msg.text;
            }
            promptInput.focus();
            autoResizeTextarea();
            break;
          }
          case 'insertTag': {
            const val = promptInput.value;
            if (!val.includes(msg.tag.trim())) {
              promptInput.value = val ? val + ' ' + msg.tag : msg.tag;
            }
            promptInput.focus();
            autoResizeTextarea();
            break;
          }
          case 'appendUserMessage': {
            const userMsg = document.createElement('div');
            userMsg.className = 'message user';

            if (msg.activatedSkillName) {
              const skillBadge = document.createElement('div');
              skillBadge.className = 'skill-badge';
              skillBadge.innerHTML = '⚡ Skill: ' + escapeHtml(msg.activatedSkillName);
              userMsg.appendChild(skillBadge);
            }

            const textSpan = document.createElement('div');
            textSpan.textContent = msg.text;
            userMsg.appendChild(textSpan);

            chatContainer.appendChild(userMsg);
            scrollToBottom();
            break;
          }
          case 'startAssistantResponse': {
            currentAssistantMsgEl = document.createElement('div');
            currentAssistantMsgEl.className = 'message assistant';
            currentAssistantTextEl = null;

            chatContainer.appendChild(currentAssistantMsgEl);
            scrollToBottom();
            break;
          }
          case 'streamDelta': {
            if (currentAssistantMsgEl) {
              if (!currentAssistantTextEl) {
                currentAssistantTextEl = document.createElement('div');
                currentAssistantTextEl.className = 'message-text';
                currentAssistantMsgEl.appendChild(currentAssistantTextEl);
              }
              currentAssistantTextEl.textContent += msg.delta;
              scrollToBottom();
            }
            break;
          }
          case 'toolStart': {
            currentAssistantTextEl = null;
            if (currentAssistantMsgEl) {
              const badge = createToolBadge(msg.id, msg.name, msg.args);
              currentAssistantMsgEl.appendChild(badge);
              scrollToBottom();
            }
            break;
          }
          case 'toolComplete': {
            const badge = document.getElementById('tool-' + msg.id);
            if (badge) {
              badge.classList.remove('running');
              if (msg.isError) {
                badge.classList.add('error');
                const titleSpan = badge.querySelector('.tool-name span');
                if (titleSpan) titleSpan.textContent = msg.name + ' failed';
              } else {
                badge.classList.add('completed');
                const titleSpan = badge.querySelector('.tool-name span');
                if (titleSpan) titleSpan.textContent = '✓ ' + msg.name + ' completed';
              }
              const details = badge.querySelector('.tool-details');
              if (details) {
                details.textContent += '\\nResult:\\n' + msg.result;
              }
            }
            break;
          }
          case 'streamError': {
            const errorEl = document.createElement('div');
            errorEl.className = 'error-banner';
            errorEl.textContent = 'Error: ' + msg.error;
            chatContainer.appendChild(errorEl);
            scrollToBottom();
            break;
          }
          case 'setRunningState': {
            const statusPill = document.getElementById('status-pill');
            const subStatusContainer = document.getElementById('sub-status-container');
            const spinnerIcon = document.getElementById('spinner-icon');
            const activityScanner = document.getElementById('activity-scanner');
            const liveWorkingIndicator = document.getElementById('live-working-indicator');
            const liveWorkingText = document.getElementById('live-working-text');

            if (msg.isRunning) {
              sendBtn.disabled = true;
              stopBtn.style.display = 'inline-block';
              promptInput.classList.add('generating');
              promptInput.placeholder = '⏳ M.I.K.E. is busy generating & executing... (Click Stop to cancel)';

              if (statusPill) {
                statusPill.className = 'status-pill running';
              }
              if (statusDot) {
                statusDot.className = 'status-dot running';
              }
              statusLabel.textContent = 'BUSY / RUNNING';

              if (activityScanner) {
                activityScanner.classList.add('running');
              }
              if (subStatusContainer) {
                subStatusContainer.className = 'status-indicator-bar running';
              }
              if (spinnerIcon) {
                spinnerIcon.className = 'spinner-icon running';
              }
              subStatus.textContent = '🔴 Working...';

              if (liveWorkingIndicator) {
                liveWorkingIndicator.style.display = 'inline-flex';
                liveWorkingText.textContent = 'Thinking & executing...';
              }
            } else {
              sendBtn.disabled = false;
              stopBtn.style.display = 'none';
              promptInput.classList.remove('generating');
              promptInput.placeholder = 'Ask M.I.K.E. or type / for direct skills... (Enter to send, Shift+Enter for newline)';

              if (statusPill) {
                statusPill.className = 'status-pill ready';
              }
              if (statusDot) {
                statusDot.className = 'status-dot';
              }
              statusLabel.textContent = 'READY';

              if (activityScanner) {
                activityScanner.classList.remove('running');
              }
              if (subStatusContainer) {
                subStatusContainer.className = 'status-indicator-bar ready';
              }
              if (spinnerIcon) {
                spinnerIcon.className = 'spinner-icon';
              }
              subStatus.textContent = '🟢 Waiting for your input';

              if (liveWorkingIndicator) {
                liveWorkingIndicator.style.display = 'none';
              }
            }
            break;
          }
          case 'statusUpdate': {
            const isBusy = (msg.status && msg.status.toLowerCase() !== 'ready');
            if (isBusy) {
              statusLabel.textContent = msg.status.toUpperCase();
              subStatus.textContent = '🔴 ' + msg.status;
              const liveWorkingText = document.getElementById('live-working-text');
              if (liveWorkingText) {
                liveWorkingText.textContent = msg.status;
              }
            } else {
              statusLabel.textContent = 'READY';
              subStatus.textContent = '🟢 Waiting for your input';
            }
            break;
          }
          case 'checkpointsUpdated': {
            renderCheckpoints(msg.files);
            break;
          }
          case 'cleared': {
            chatContainer.innerHTML = '';
            const welcome = document.createElement('div');
            welcome.className = 'message assistant';
            welcome.innerHTML = '<div class="message-text">Conversation cleared. Ready for your next request!</div>';
            chatContainer.appendChild(welcome);
            renderCheckpoints([]);
            break;
          }
        }
      });

      btnRejectAll.addEventListener('click', function() {
        vscode.postMessage({ type: 'revertAll' });
      });

      btnAcceptAll.addEventListener('click', function() {
        vscode.postMessage({ type: 'acceptCheckpoints' });
      });

      function renderCheckpoints(files) {
        if (!files || files.length === 0) {
          sessionChangesBar.style.display = 'none';
          sessionChangesList.innerHTML = '';
          return;
        }

        sessionChangesBar.style.display = 'flex';
        sessionChangesTitle.textContent = '📝 ' + files.length + ' file' + (files.length > 1 ? 's' : '') + ' modified';
        sessionChangesList.innerHTML = '';

        files.forEach(function(f) {
          const row = document.createElement('div');
          row.className = 'session-file-row';

          const nameSpan = document.createElement('span');
          nameSpan.className = 'session-file-name';
          nameSpan.textContent = (f.isNew ? '+ ' : '~ ') + f.relPath;
          nameSpan.title = f.fsPath;

          const revertBtn = document.createElement('button');
          revertBtn.className = 'btn-revert-single';
          revertBtn.textContent = '↺ Revert';
          revertBtn.title = 'Revert ' + f.relPath + ' to pre-session state';
          revertBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'revertFile', file: f.fsPath });
          });

          row.appendChild(nameSpan);
          row.appendChild(revertBtn);
          sessionChangesList.appendChild(row);
        });
      }

      // Initial skill request handshake
      vscode.postMessage({ type: 'ready' });
      vscode.postMessage({ type: 'getSkills' });
      vscode.postMessage({ type: 'getConfig' });
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
