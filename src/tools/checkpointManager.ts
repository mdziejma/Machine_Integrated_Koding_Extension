import * as vscode from 'vscode';
import * as path from 'path';

export interface FileCheckpoint {
  uri: vscode.Uri;
  relPath: string;
  originalBytes: Uint8Array | null;
  isNew: boolean;
  timestamp: number;
}

/**
 * Session Checkpoint Manager
 * Tracks file baselines before AI modifications to provide infallible 1-click Rollback / Reject.
 */
export class CheckpointManager {
  private static _checkpoints: Map<string, FileCheckpoint> = new Map();
  private static _onDidChangeCheckpoints = new vscode.EventEmitter<void>();
  public static readonly onDidChangeCheckpoints = CheckpointManager._onDidChangeCheckpoints.event;

  /**
   * Records pristine file state before write_file modifies it.
   * Preserves only the first snapshot per session so rollback always returns to baseline.
   */
  public static async recordPreWrite(targetUri: vscode.Uri): Promise<void> {
    const fsPath = targetUri.fsPath;
    if (this._checkpoints.has(fsPath)) {
      return; // Pristine baseline already captured for this session
    }

    const relPath = vscode.workspace.asRelativePath(targetUri);
    let originalBytes: Uint8Array | null = null;
    let isNew = false;

    try {
      originalBytes = await vscode.workspace.fs.readFile(targetUri);
    } catch {
      // File does not exist yet
      isNew = true;
    }

    this._checkpoints.set(fsPath, {
      uri: targetUri,
      relPath,
      originalBytes,
      isNew,
      timestamp: Date.now()
    });

    this._onDidChangeCheckpoints.fire();
  }

  /**
   * Reverts a single file back to its pre-session baseline.
   */
  public static async revertFile(filePathOrRel: string): Promise<boolean> {
    let match: FileCheckpoint | undefined;

    for (const [fsPath, cp] of this._checkpoints.entries()) {
      if (fsPath === filePathOrRel || cp.relPath === filePathOrRel || path.normalize(fsPath).endsWith(path.normalize(filePathOrRel))) {
        match = cp;
        break;
      }
    }

    if (!match) {
      return false;
    }

    if (match.isNew) {
      try {
        await vscode.workspace.fs.delete(match.uri, { recursive: false, useTrash: false });
      } catch {}
    } else if (match.originalBytes) {
      await vscode.workspace.fs.writeFile(match.uri, match.originalBytes);
    }

    this._checkpoints.delete(match.uri.fsPath);
    this._onDidChangeCheckpoints.fire();
    return true;
  }

  /**
   * Reverts ALL modified & created files in the current session.
   */
  public static async revertAll(): Promise<{ revertedCount: number; deletedCount: number; files: string[] }> {
    let revertedCount = 0;
    let deletedCount = 0;
    const files: string[] = [];

    const entries = Array.from(this._checkpoints.values());
    for (const cp of entries) {
      files.push(cp.relPath);
      if (cp.isNew) {
        try {
          await vscode.workspace.fs.delete(cp.uri, { recursive: false, useTrash: false });
          deletedCount++;
        } catch {}
      } else if (cp.originalBytes) {
        try {
          await vscode.workspace.fs.writeFile(cp.uri, cp.originalBytes);
          revertedCount++;
        } catch {}
      }
    }

    this._checkpoints.clear();
    this._onDidChangeCheckpoints.fire();

    return { revertedCount, deletedCount, files };
  }

  /**
   * Returns list of all files modified in the active session.
   */
  public static getModifiedFiles(): Array<{ fsPath: string; relPath: string; isNew: boolean; timestamp: number }> {
    return Array.from(this._checkpoints.values()).map((cp) => ({
      fsPath: cp.uri.fsPath,
      relPath: cp.relPath,
      isNew: cp.isNew,
      timestamp: cp.timestamp
    }));
  }

  /**
   * Accepts changes and clears session checkpoints.
   */
  public static clearCheckpoints(): void {
    this._checkpoints.clear();
    this._onDidChangeCheckpoints.fire();
  }

  /**
   * Count of modified files in session.
   */
  public static get count(): number {
    return this._checkpoints.size;
  }
}
