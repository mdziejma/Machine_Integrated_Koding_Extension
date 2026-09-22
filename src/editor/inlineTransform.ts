import * as vscode from 'vscode';
import { AgentClient } from '../agent/client.js';
import { CheckpointManager } from '../tools/checkpointManager.js';

interface QuickRecipeItem extends vscode.QuickPickItem {
  prompt?: string;
  isCustom?: boolean;
}

/**
 * In-Editor Inline Transform Manager (Cmd+I / Ctrl+I)
 * Enables rapid, localized code refactoring and transformations directly inside active editors.
 */
export class InlineTransformManager {
  private static readonly highlightDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(88, 166, 255, 0.18)',
    isWholeLine: true,
    overviewRulerColor: '#58a6ff',
    overviewRulerLane: vscode.OverviewRulerLane.Right
  });

  /**
   * Triggers the inline transform HUD on the active editor.
   */
  public static async trigger(targetEditor?: vscode.TextEditor): Promise<void> {
    const editor = targetEditor || vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('M.I.K.E.: No active editor open to transform.');
      return;
    }

    const document = editor.document;
    if (document.isClosed) {
      return;
    }

    // Determine target range: if empty selection, expand to full line
    let selection = editor.selection;
    let targetRange: vscode.Range;

    if (selection.isEmpty) {
      const line = document.lineAt(selection.active.line);
      targetRange = line.range;
    } else {
      // Expand selection to full lines for cleaner code boundaries
      const startLine = document.lineAt(selection.start.line);
      const endLine = document.lineAt(selection.end.line);
      targetRange = new vscode.Range(startLine.range.start, endLine.range.end);
    }

    // Highlight target block in editor
    editor.setDecorations(this.highlightDecoration, [targetRange]);

    try {
      const recipe = await this.promptForInstruction();
      if (!recipe) {
        editor.setDecorations(this.highlightDecoration, []);
        return;
      }

      let instruction = recipe.prompt;
      if (recipe.isCustom || !instruction) {
        const customInput = await vscode.window.showInputBox({
          title: 'M.I.K.E. Inline Transform (Cmd+I)',
          prompt: 'Enter your instruction for the selected code',
          placeHolder: 'e.g., convert to async/await, add type safety, fix edge cases...',
          ignoreFocusOut: true
        });

        if (!customInput || customInput.trim() === '') {
          editor.setDecorations(this.highlightDecoration, []);
          return;
        }
        instruction = customInput.trim();
      }

      await this.executeTransform(editor, targetRange, instruction);
    } finally {
      editor.setDecorations(this.highlightDecoration, []);
    }
  }

  private static async promptForInstruction(): Promise<QuickRecipeItem | undefined> {
    const recipes: QuickRecipeItem[] = [
      {
        label: '$(edit) Custom Instruction...',
        description: 'Type any custom prompt or refactoring requirement',
        isCustom: true
      },
      {
        label: '$(zap) Optimize Performance & Logic',
        description: 'Refactor for speed, algorithmic clarity, and minimal memory',
        prompt: 'Optimize the code for performance, readability, and cleaner idiomatic structure while preserving all existing behavior.'
      },
      {
        label: '$(shield) Add Error Handling & Null Safety',
        description: 'Add defensive boundaries, argument validations, and error handling',
        prompt: 'Add comprehensive input boundary validation, defensive null/undefined checks, and proper error handling with descriptive exceptions.'
      },
      {
        label: '$(symbol-keyword) Add TypeScript Types & JSDoc',
        description: 'Enrich with strict types, interfaces, and comprehensive docstrings',
        prompt: 'Add comprehensive TypeScript types, return signatures, and detailed JSDoc documentation comments explaining parameters and behavior.'
      },
      {
        label: '$(sync) Convert to Async / Await',
        description: 'Transform synchronous loops or callbacks into async/await pipelines',
        prompt: 'Convert the logic into clean async/await functions with proper Promise handling and non-blocking patterns.'
      },
      {
        label: '$(beaker) Generate Inline Unit Test Block',
        description: 'Generate assert-based unit tests for this specific block',
        prompt: 'Generate comprehensive unit test assertions validating this specific code block covering happy paths, edge cases, and failure modes.'
      }
    ];

    return await vscode.window.showQuickPick(recipes, {
      title: 'M.I.K.E. Inline Transform HUD (Cmd+I)',
      placeHolder: 'Select a refactoring recipe or choose Custom Instruction...',
      matchOnDescription: true,
      ignoreFocusOut: true
    });
  }

  private static async executeTransform(
    editor: vscode.TextEditor,
    range: vscode.Range,
    instruction: string
  ): Promise<void> {
    const document = editor.document;
    const filePath = vscode.workspace.asRelativePath(document.uri);
    const selectedCode = document.getText(range);

    // Capture surrounding context (up to 50 lines before and after)
    const startLineNum = Math.max(0, range.start.line - 50);
    const endLineNum = Math.min(document.lineCount - 1, range.end.line + 50);

    const prefixRange = new vscode.Range(new vscode.Position(startLineNum, 0), range.start);
    const suffixRange = new vscode.Range(range.end, new vscode.Position(endLineNum, document.lineAt(endLineNum).text.length));

    const prefixContext = document.getText(prefixRange);
    const suffixContext = document.getText(suffixRange);

    // Save baseline file snapshot for rollback
    await CheckpointManager.recordPreWrite(document.uri);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `M.I.K.E.: Applying inline transform...`,
        cancellable: true
      },
      async (_progress, token) => {
        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        try {
          const replacement = await AgentClient.generateInlineTransform(
            {
              instruction,
              filePath,
              languageId: document.languageId,
              selectedCode,
              prefixContext,
              suffixContext
            },
            abortController.signal
          );

          if (!replacement || replacement.trim() === '') {
            vscode.window.showWarningMessage('M.I.K.E.: Received empty transformation from LLM.');
            return;
          }

          // Apply replacement via native editor edit buffer (supports Cmd+Z natively)
          const editSuccess = await editor.edit((editBuilder) => {
            editBuilder.replace(range, replacement);
          });

          if (!editSuccess) {
            vscode.window.showErrorMessage('M.I.K.E.: Failed to apply inline edit to document.');
            return;
          }

          // Give language server diagnostics a brief moment to compute
          setTimeout(() => {
            this.showPostTransformNotification(document, filePath);
          }, 300);
        } catch (err: unknown) {
          if (abortController.signal.aborted) {
            vscode.window.showInformationMessage('M.I.K.E.: Inline transform cancelled.');
          } else {
            vscode.window.showErrorMessage(`M.I.K.E. Transform Error: ${(err as Error).message}`);
          }
        }
      }
    );
  }

  private static showPostTransformNotification(
    document: vscode.TextDocument,
    filePath: string
  ): void {
    const diags = vscode.languages.getDiagnostics(document.uri);
    const errorCount = diags.filter((d) => d.severity === vscode.DiagnosticSeverity.Error).length;

    let msg = `✨ M.I.K.E.: Inline transform applied to ${filePath}!`;
    const actions: string[] = ['✓ Keep Changes', '⏪ Revert'];

    if (errorCount > 0) {
      msg = `⚠️ M.I.K.E.: Transformed ${filePath}, but detected ${errorCount} diagnostic error(s).`;
      actions.unshift('✨ Fix Diagnostics with M.I.K.E.');
    }

    vscode.window.showInformationMessage(msg, ...actions).then(async (selected) => {
      if (selected === '⏪ Revert') {
        await CheckpointManager.revertFile(document.uri.fsPath);
      } else if (selected === '✨ Fix Diagnostics with M.I.K.E.') {
        await vscode.commands.executeCommand('mike.fixError', { document });
      }
    });
  }
}
