import * as vscode from 'vscode';

export interface EditorContext {
  editor?: vscode.TextEditor;
  document: vscode.TextDocument;
  relPath: string;
  selectedText: string;
  startLine: number;
  endLine: number;
  hasSelection: boolean;
  fullText: string;
}

/**
 * Tracks the last active editor and text selection across the VS Code window.
 * Ensures selections and active documents are not lost when focus transfers to webview panels or modals.
 */
export class EditorContextTracker {
  private static _lastActiveEditor?: vscode.TextEditor;
  private static _lastActiveDocument?: vscode.TextDocument;
  private static _lastActiveSelection?: vscode.Selection;

  public static initialize(context: vscode.ExtensionContext): void {
    if (vscode.window.activeTextEditor) {
      this._updateFromEditor(vscode.window.activeTextEditor);
    }

    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && !editor.document.isClosed) {
          this._updateFromEditor(editor);
        }
      })
    );

    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor && !e.textEditor.document.isClosed) {
          this._lastActiveEditor = e.textEditor;
          this._lastActiveDocument = e.textEditor.document;
          this._lastActiveSelection = e.selections[0];
        }
      })
    );
  }

  private static _updateFromEditor(editor: vscode.TextEditor): void {
    this._lastActiveEditor = editor;
    this._lastActiveDocument = editor.document;
    if (editor.selection && !editor.selection.isEmpty) {
      this._lastActiveSelection = editor.selection;
    }
  }

  /**
   * Captures the current or last active editor context, preserving selections even when webview is focused.
   */
  public static captureContext(): EditorContext | null {
    let targetEditor = vscode.window.activeTextEditor;
    if (!targetEditor || targetEditor.document.isClosed) {
      if (this._lastActiveEditor && !this._lastActiveEditor.document.isClosed) {
        targetEditor = this._lastActiveEditor;
      } else if (vscode.window.visibleTextEditors.length > 0) {
        targetEditor = vscode.window.visibleTextEditors[0];
      }
    }

    const document = targetEditor?.document || (this._lastActiveDocument && !this._lastActiveDocument.isClosed ? this._lastActiveDocument : undefined);
    if (!document) {
      return null;
    }

    const relPath = vscode.workspace.asRelativePath(document.uri);
    const fullText = document.getText();

    let selectedText = '';
    let startLine = 1;
    let endLine = 1;
    let hasSelection = false;

    if (targetEditor && targetEditor.selection && !targetEditor.selection.isEmpty) {
      selectedText = document.getText(targetEditor.selection);
      startLine = targetEditor.selection.start.line + 1;
      endLine = targetEditor.selection.end.line + 1;
      hasSelection = true;
    } else if (this._lastActiveSelection && this._lastActiveDocument?.uri.toString() === document.uri.toString() && !this._lastActiveSelection.isEmpty) {
      selectedText = document.getText(this._lastActiveSelection);
      startLine = this._lastActiveSelection.start.line + 1;
      endLine = this._lastActiveSelection.end.line + 1;
      hasSelection = true;
    } else if (targetEditor) {
      const pos = targetEditor.selection.active;
      startLine = pos.line + 1;
      endLine = pos.line + 1;
      if (pos.line < document.lineCount) {
        selectedText = document.lineAt(pos.line).text;
      }
      hasSelection = false;
    } else {
      startLine = 1;
      endLine = Math.min(1, document.lineCount);
      selectedText = '';
      hasSelection = false;
    }

    return {
      editor: targetEditor,
      document,
      relPath,
      selectedText,
      startLine,
      endLine,
      hasSelection,
      fullText
    };
  }
}
