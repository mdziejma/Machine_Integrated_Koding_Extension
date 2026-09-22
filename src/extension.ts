import * as vscode from 'vscode';
import { DiffContentProvider, diffContentProvider } from './tools/fileTools.js';
import { MikeSidebarProvider } from './webview/sidebarProvider.js';
import { AgentClient } from './agent/client.js';
import { SessionManager } from './agent/sessionManager.js';
import { InlineTransformManager } from './editor/inlineTransform.js';

/**
 * Extension Activation Entrypoint
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize Global Persistence & Secret Storage
  AgentClient.initializePersistence(context.secrets, context.globalState);
  SessionManager.initialize(context.workspaceState);

  // 1. Register the in-memory TextDocumentContentProvider for mike-diff scheme
  const diffRegistration = vscode.workspace.registerTextDocumentContentProvider(
    DiffContentProvider.SCHEME,
    diffContentProvider
  );
  context.subscriptions.push(diffRegistration);

  // 2. Register Webview View Provider for M.I.K.E. Sidebar
  const sidebarProvider = new MikeSidebarProvider(context.extensionUri);
  const webviewRegistration = vscode.window.registerWebviewViewProvider(
    MikeSidebarProvider.viewType,
    sidebarProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    }
  );
  context.subscriptions.push(webviewRegistration);

  // 3. Register helper commands
  context.subscriptions.push(
    vscode.commands.registerCommand('mike.inlineTransform', async () => {
      await InlineTransformManager.trigger();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.focusAssistant', async () => {
      await vscode.commands.executeCommand('mike-assistant.sidebar.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.selectSkill', async () => {
      await vscode.commands.executeCommand('mike-assistant.sidebar.focus');
      await sidebarProvider.showSkillQuickPick();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.revertSessionChanges', async () => {
      const { CheckpointManager } = await import('./tools/checkpointManager.js');
      const result = await CheckpointManager.revertAll();
      vscode.window.showInformationMessage(
        `⏪ M.I.K.E. Rollback: Reverted ${result.revertedCount} modified files and deleted ${result.deletedCount} new files.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.setApiKey', async (apiKeyArg?: string) => {
      let apiKey = apiKeyArg;
      if (!apiKey) {
        apiKey = await vscode.window.showInputBox({
          prompt: 'Enter API Key for M.I.K.E. (Stored securely in OS Keychain)',
          password: true,
          placeHolder: 'Paste API Key...',
          ignoreFocusOut: true
        });
      }

      if (apiKey !== undefined && apiKey.trim()) {
        await AgentClient.savePersistentConfig({ apiKey: apiKey.trim() });
        vscode.window.showInformationMessage('M.I.K.E. API Key saved securely to OS Keychain.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.configureConnection', async () => {
      const currentConfig = await AgentClient.getConfig();

      const baseUrl = await vscode.window.showInputBox({
        prompt: 'OpenAI-compatible Base URL (e.g., Ollama, vLLM, OpenAI, LiteLLM)',
        value: currentConfig.baseUrl,
        placeHolder: 'http://localhost:11434/v1 or https://api.openai.com/v1',
        ignoreFocusOut: true
      });
      if (baseUrl === undefined) return;

      const apiKey = await vscode.window.showInputBox({
        prompt: 'API Key (Leave blank to keep existing)',
        password: true,
        placeHolder: 'Enter API Key...',
        ignoreFocusOut: true
      });
      if (apiKey === undefined) return;

      // Get known & discovered models
      const knownModels = await AgentClient.getKnownModels();
      const modelOptions: vscode.QuickPickItem[] = [
        ...knownModels.map((m) => ({
          label: m,
          description: m === currentConfig.model ? 'Active Model' : 'Discovered / Recent Model',
          picked: m === currentConfig.model
        })),
        {
          label: '$(cloud-download) Auto-Discover from Server...',
          description: 'Probe endpoint /models to discover active server models'
        },
        {
          label: '$(edit) Custom Model ID...',
          description: 'Type any custom model endpoint ID (e.g. laguna-s-2.1-p5.en-es)'
        }
      ];

      const selectedModelItem = await vscode.window.showQuickPick(modelOptions, {
        placeHolder: `Select Model (Currently: ${currentConfig.model})`,
        ignoreFocusOut: true
      });
      if (!selectedModelItem) return;

      let chosenModel = selectedModelItem.label;
      if (selectedModelItem.label.includes('Auto-Discover')) {
        const discovered = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'M.I.K.E.: Auto-discovering models from server...',
            cancellable: false
          },
          async () => {
            return await AgentClient.fetchAvailableModels(baseUrl.trim(), apiKey.trim());
          }
        );

        if (discovered.models.length > 0) {
          const pickedFromDiscovered = await vscode.window.showQuickPick(
            discovered.models.map((m) => ({ label: m })),
            { placeHolder: `Select from ${discovered.models.length} discovered server models:` }
          );
          if (pickedFromDiscovered) {
            chosenModel = pickedFromDiscovered.label;
          }
        } else {
          vscode.window.showWarningMessage('No models endpoint found on server. Please type model name manually.');
          const manualModel = await vscode.window.showInputBox({
            prompt: 'Model ID (e.g. laguna-s-2.1-p5.en-es)',
            value: currentConfig.model,
            ignoreFocusOut: true
          });
          if (manualModel === undefined) return;
          chosenModel = manualModel.trim();
        }
      } else if (selectedModelItem.label.includes('Custom Model ID')) {
        const customModel = await vscode.window.showInputBox({
          prompt: 'Custom Model ID',
          value: currentConfig.model,
          placeHolder: 'e.g. laguna-s-2.1-p5.en-es, etc.',
          ignoreFocusOut: true
        });
        if (customModel === undefined) return;
        chosenModel = customModel.trim();
      }

      await AgentClient.savePersistentConfig({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: chosenModel
      });

      vscode.window.showInformationMessage(`M.I.K.E. connection settings updated! (Model: ${chosenModel})`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.testConnection', async () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'M.I.K.E.: Testing Connection & Probing Endpoints...',
          cancellable: false
        },
        async () => {
          const result = await AgentClient.testConnection();
          if (result.success) {
            vscode.window.showInformationMessage(result.details, { modal: true });
          } else {
            vscode.window.showErrorMessage(
              `Connection probe failed:\n\n${result.details}`,
              { modal: true }
            );
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'mike');
    })
  );

  // 4. Register Quick-Fix CodeAction Provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new MikeQuickFixProvider(),
      { providedCodeActionKinds: MikeQuickFixProvider.providedCodeActionKinds }
    )
  );

  // 5. Register Editor Context Commands
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mike.fixError',
      async (arg?: { document?: vscode.TextDocument; range?: vscode.Range; diagnostic?: vscode.Diagnostic }) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor && !arg?.document) {
          vscode.window.showWarningMessage('No active editor open.');
          return;
        }

        const doc = arg?.document || editor!.document;
        const relPath = vscode.workspace.asRelativePath(doc.uri);
        const pos = arg?.range?.start || editor?.selection.active || new vscode.Position(0, 0);
        const lineNum = pos.line + 1;

        let targetDiag = arg?.diagnostic;
        if (!targetDiag) {
          const fileDiags = vscode.languages.getDiagnostics(doc.uri);
          targetDiag = fileDiags.find((d) => d.range.contains(pos)) || fileDiags[0];
        }

        const diagDetail = targetDiag
          ? `Error on line ${targetDiag.range.start.line + 1}: ${targetDiag.message} [${targetDiag.source || 'compiler'}]`
          : `Compiler/diagnostic problem near line ${lineNum}`;

        const prompt = `Fix this compiler/type error in \`${relPath}\`:\n${diagDetail}\n\n[ACTIVE FILE: ${relPath}]\n\`\`\`\n${doc.getText()}\n\`\`\``;
        await sidebarProvider.executeUserPrompt(prompt);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const relPath = vscode.workspace.asRelativePath(doc.uri);
      const selection = editor.selection;
      const selectedText = doc.getText(selection) || doc.getText();
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      const prompt = `Explain the following code and its architectural behavior in detail:\n\n[ACTIVE SELECTION: ${relPath} (Lines ${startLine}-${endLine})]\n\`\`\`\n${selectedText}\n\`\`\``;
      await sidebarProvider.executeUserPrompt(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.refactorCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const relPath = vscode.workspace.asRelativePath(doc.uri);
      const selection = editor.selection;
      const selectedText = doc.getText(selection) || doc.getText();
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      const prompt = `Refactor and optimize the following code for readability, type safety, and maintainability while preserving all existing behavior:\n\n[ACTIVE SELECTION: ${relPath} (Lines ${startLine}-${endLine})]\n\`\`\`\n${selectedText}\n\`\`\``;
      await sidebarProvider.executeUserPrompt(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('mike.generateTests', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const doc = editor.document;
      const relPath = vscode.workspace.asRelativePath(doc.uri);
      const selection = editor.selection;
      const selectedText = doc.getText(selection) || doc.getText();
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      const prompt = `Generate comprehensive unit tests for the following code covering happy paths, edge cases, and error boundaries:\n\n[ACTIVE SELECTION: ${relPath} (Lines ${startLine}-${endLine})]\n\`\`\`\n${selectedText}\n\`\`\``;
      await sidebarProvider.executeUserPrompt(prompt);
    })
  );
}

/**
 * Quick-Fix Code Action Provider for M.I.K.E.
 */
class MikeQuickFixProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diag of context.diagnostics) {
      const msgSummary = diag.message.length > 50 ? diag.message.slice(0, 47) + '...' : diag.message;
      const action = new vscode.CodeAction(
        `✨ Ask M.I.K.E. to fix: ${msgSummary}`,
        vscode.CodeActionKind.QuickFix
      );
      action.diagnostics = [diag];
      action.isPreferred = true;
      action.command = {
        command: 'mike.fixError',
        title: 'Ask M.I.K.E. to Fix This Error',
        arguments: [{ document, range, diagnostic: diag }]
      };
      actions.push(action);
    }

    return actions;
  }
}

/**
 * Extension Deactivation Entrypoint
 */
export function deactivate(): void {
  // Clean-up logic if needed
}
