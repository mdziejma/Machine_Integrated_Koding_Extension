import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

/**
 * Custom TextDocumentContentProvider to serve original snapshot versions of files
 * for in-memory side-by-side diffing against modified workspace files.
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly SCHEME = 'mike-diff';
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;

  private memoryCache = new Map<string, string>();

  /**
   * Caches the original text for a document and returns a custom mike-diff Uri.
   */
  public setOriginalContent(targetUri: vscode.Uri, content: string): vscode.Uri {
    const cacheKey = `${targetUri.toString()}_${Date.now()}`;
    this.memoryCache.set(cacheKey, content);

    const diffUri = vscode.Uri.from({
      scheme: DiffContentProvider.SCHEME,
      path: targetUri.path,
      query: `key=${encodeURIComponent(cacheKey)}`
    });

    this._onDidChange.fire(diffUri);
    return diffUri;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query);
    const key = params.get('key');
    if (key && this.memoryCache.has(key)) {
      return this.memoryCache.get(key)!;
    }
    return '';
  }
}

// Global instance of the diff provider
export const diffContentProvider = new DiffContentProvider();

/**
 * Safely resolves a relative or absolute file path to a vscode.Uri within the active workspace.
 */
export function resolveWorkspaceUri(filePath: string): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  const primaryWorkspace = folders && folders.length > 0 ? folders[0].uri : null;

  if (!filePath || filePath.trim() === '') {
    if (primaryWorkspace) {
      return primaryWorkspace;
    }
    throw new Error('No workspace folder is open in VS Code. Please open a folder (File > Open Folder) before using M.I.K.E.');
  }

  // If already a valid absolute URI string (e.g. file:///...)
  if (filePath.startsWith('file://')) {
    return vscode.Uri.parse(filePath);
  }

  // If it's a Windows drive path (e.g. C:\foo or C:/foo)
  if (/^[a-zA-Z]:[\\/]/.test(filePath)) {
    return vscode.Uri.file(filePath);
  }

  if (!primaryWorkspace) {
    throw new Error('No workspace folder is open in VS Code. Please open a folder (File > Open Folder) before writing or reading files.');
  }

  // Normalize path by stripping leading slashes or relative ./ prefixes so that paths
  // like "/mike_demo.ts", "./mike_demo.ts", or "mike_demo.ts" resolve safely to the workspace folder
  const normalizedRel = filePath.replace(/^([\\/]+|\.\/|\.\\)+/, '');
  return vscode.Uri.joinPath(primaryWorkspace, normalizedRel);
}

/**
 * File entry representation for directory listing
 */
export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'unknown';
}

/**
 * Tool: write_file
 * Writes content to a file via vscode.workspace.fs.
 * If the file already exists, preserves original content and launches side-by-side diff.
 */
export async function writeFileTool(args: { path: string; content: string }): Promise<{
  status: 'success';
  bytesWritten: number;
  path: string;
  diagnostics?: {
    errorCount: number;
    warningCount: number;
    messages: string[];
  };
}> {
  if (!args.path) {
    throw new Error('Missing required argument: "path"');
  }
  if (args.content === undefined || args.content === null) {
    throw new Error('Missing required argument: "content"');
  }

  const targetUri = resolveWorkspaceUri(args.path);
  let priorContent: string | null = null;

  try {
    const existingBytes = await vscode.workspace.fs.readFile(targetUri);
    priorContent = Buffer.from(existingBytes).toString('utf8');
  } catch {
    // File does not exist yet; normal create flow
    priorContent = null;
  }

  const newBuffer = Buffer.from(args.content, 'utf8');

  // Ensure parent directory exists using VFS Uri joinPath
  const parentUri = vscode.Uri.joinPath(targetUri, '..');
  try {
    await vscode.workspace.fs.createDirectory(parentUri);
  } catch {
    // Parent might already exist or be workspace root
  }

  // Record pristine pre-write checkpoint for 1-click rollback/reject
  const { CheckpointManager } = await import('./checkpointManager.js');
  await CheckpointManager.recordPreWrite(targetUri);

  // Perform pure VFS write
  await vscode.workspace.fs.writeFile(targetUri, newBuffer);

  // Trigger editor view or diff
  if (priorContent !== null && priorContent !== args.content) {
    const diffUri = diffContentProvider.setOriginalContent(targetUri, priorContent);
    const fileName = path.basename(targetUri.fsPath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      diffUri,
      targetUri,
      `${fileName} (Original ↔ Modified)`
    );
  } else {
    try {
      const document = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
    } catch {
      // Editor might be headless or not active
    }
  }
  // Give language server a short tick to process the file and report diagnostics
  let diagSummary: string[] = [];
  let errorCount = 0;
  let warningCount = 0;

  try {
    await new Promise((r) => setTimeout(r, 150));
    const diagnostics = vscode.languages.getDiagnostics(targetUri);
    const errors = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    const warnings = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Warning);
    errorCount = errors.length;
    warningCount = warnings.length;

    if (errorCount > 0 || warningCount > 0) {
      diagSummary = diagnostics.slice(0, 10).map((d) => {
        const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'Error' : 'Warning';
        const line = d.range.start.line + 1;
        const col = d.range.start.character + 1;
        const code = d.code ? (typeof d.code === 'object' ? d.code.value : d.code) : '';
        const codePrefix = code ? ` [${code}]` : '';
        return `${sev} (Line ${line}:${col}):${codePrefix} ${d.message}`;
      });
    }
  } catch {
    // Diagnostics query is non-blocking
  }

  return {
    status: 'success',
    bytesWritten: newBuffer.byteLength,
    path: targetUri.fsPath,
    diagnostics: {
      errorCount,
      warningCount,
      messages: diagSummary
    }
  };
}

/**
 * Tool: delete_file
 * Deletes a file or directory within the workspace using native VS Code VFS.
 */
export async function deleteFileTool(args: { path: string; recursive?: boolean }): Promise<{
  status: 'success';
  path: string;
  message: string;
}> {
  if (!args.path || args.path.trim() === '') {
    throw new Error('Missing required argument: "path"');
  }

  const targetUri = resolveWorkspaceUri(args.path);
  try {
    await vscode.workspace.fs.delete(targetUri, {
      recursive: args.recursive !== false,
      useTrash: true
    });
    return {
      status: 'success',
      path: targetUri.fsPath,
      message: `File or directory successfully deleted: ${vscode.workspace.asRelativePath(targetUri)}`
    };
  } catch (err: any) {
    // If file already doesn't exist, return success so workflows don't fail on idempotent cleanups
    if (
      err.code === 'FileNotFound' ||
      err.message?.includes('FileNotFound') ||
      err.name === 'EntryNotFound (FileSystemError)'
    ) {
      return {
        status: 'success',
        path: targetUri.fsPath,
        message: `File already does not exist: ${vscode.workspace.asRelativePath(targetUri)}`
      };
    }
    throw new Error(`Failed to delete "${args.path}": ${err.message}`);
  }
}

/**
 * Tool: find_symbol
 * Searches for classes, methods, functions, and interfaces across the workspace using VS Code's AST symbol index.
 */
export async function findSymbolTool(args: { query: string; maxResults?: number }): Promise<{
  query: string;
  count: number;
  symbols: Array<{
    name: string;
    kind: string;
    containerName?: string;
    location: {
      file: string;
      line: number;
    };
  }>;
}> {
  if (!args.query || args.query.trim() === '') {
    throw new Error('Missing required argument: "query"');
  }

  const query = args.query.trim();
  const limit = Math.min(args.maxResults || 25, 50);
  const rawSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
    'vscode.executeWorkspaceSymbolProvider',
    query
  );

  if (!rawSymbols || rawSymbols.length === 0) {
    // Fallback: fast declaration scan across workspace files if language server is cold/unindexed
    try {
      const files = await vscode.workspace.findFiles(
        '**/*.{ts,js,mjs,cjs,py,cs,go,rs,java,cpp,c,h}',
        '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}',
        200
      );
      const matched: Array<{ name: string; kind: string; containerName?: string; location: { file: string; line: number } }> = [];
      const lowerQuery = query.toLowerCase();

      for (const file of files) {
        try {
          const bytes = await vscode.workspace.fs.readFile(file);
          const text = Buffer.from(bytes).toString('utf8');
          const lines = text.split('\n');

          lines.forEach((line, idx) => {
            const trimmed = line.trim();
            if (trimmed.toLowerCase().includes(lowerQuery)) {
              let detectedKind: string | null = null;
              let detectedName: string | null = null;

              const declMatch = trimmed.match(/\b(class|interface|function|const|let|var|type|enum|struct|def)\s+([a-zA-Z0-9_$]+)/i);
              if (declMatch) {
                const kw = declMatch[1].toLowerCase();
                detectedName = declMatch[2];
                if (kw === 'class') detectedKind = 'Class';
                else if (kw === 'interface') detectedKind = 'Interface';
                else if (kw === 'function' || kw === 'def') detectedKind = 'Function';
                else if (kw === 'type') detectedKind = 'Type';
                else if (kw === 'enum') detectedKind = 'Enum';
                else if (kw === 'struct') detectedKind = 'Struct';
                else detectedKind = 'Variable';
              } else if (trimmed.match(/\b(public|private|protected|async)?\s*([a-zA-Z0-9_$]+)\s*\(/)) {
                const fnMatch = trimmed.match(/\b([a-zA-Z0-9_$]+)\s*\(/);
                if (fnMatch && fnMatch[1].toLowerCase().includes(lowerQuery)) {
                  detectedName = fnMatch[1];
                  detectedKind = 'Method';
                }
              }

              if (detectedKind && detectedName && detectedName.toLowerCase().includes(lowerQuery)) {
                matched.push({
                  name: detectedName,
                  kind: detectedKind,
                  location: {
                    file: vscode.workspace.asRelativePath(file),
                    line: idx + 1
                  }
                });
              }
            }
          });
          if (matched.length >= limit) break;
        } catch {
          // Skip unreadable files
        }
      }

      if (matched.length > 0) {
        return { query, count: matched.length, symbols: matched.slice(0, limit) };
      }
    } catch {}

    return { query, count: 0, symbols: [] };
  }

  const kindMap: Record<number, string> = {
    [vscode.SymbolKind.File]: 'File',
    [vscode.SymbolKind.Module]: 'Module',
    [vscode.SymbolKind.Namespace]: 'Namespace',
    [vscode.SymbolKind.Package]: 'Package',
    [vscode.SymbolKind.Class]: 'Class',
    [vscode.SymbolKind.Method]: 'Method',
    [vscode.SymbolKind.Property]: 'Property',
    [vscode.SymbolKind.Field]: 'Field',
    [vscode.SymbolKind.Constructor]: 'Constructor',
    [vscode.SymbolKind.Enum]: 'Enum',
    [vscode.SymbolKind.Interface]: 'Interface',
    [vscode.SymbolKind.Function]: 'Function',
    [vscode.SymbolKind.Variable]: 'Variable',
    [vscode.SymbolKind.Constant]: 'Constant',
    [vscode.SymbolKind.String]: 'String',
    [vscode.SymbolKind.Number]: 'Number',
    [vscode.SymbolKind.Boolean]: 'Boolean',
    [vscode.SymbolKind.Array]: 'Array',
    [vscode.SymbolKind.Object]: 'Object',
    [vscode.SymbolKind.Key]: 'Key',
    [vscode.SymbolKind.Null]: 'Null',
    [vscode.SymbolKind.EnumMember]: 'EnumMember',
    [vscode.SymbolKind.Struct]: 'Struct',
    [vscode.SymbolKind.Event]: 'Event',
    [vscode.SymbolKind.Operator]: 'Operator',
    [vscode.SymbolKind.TypeParameter]: 'TypeParameter'
  };

  const symbols = rawSymbols.slice(0, limit).map((s) => ({
    name: s.name,
    kind: kindMap[s.kind] || 'Symbol',
    containerName: s.containerName || undefined,
    location: {
      file: vscode.workspace.asRelativePath(s.location.uri),
      line: s.location.range.start.line + 1
    }
  }));

  return {
    query,
    count: symbols.length,
    symbols
  };
}

export interface GrepMatchItem {
  file: string;
  line: number;
  content: string;
}

export interface GrepSearchResult {
  query: string;
  totalMatches: number;
  filesSearched: number;
  matches: GrepMatchItem[];
}

/**
 * Tool: grep_search
 * Fast, pure-VFS full-text search across workspace files for regex patterns, routes, config keys, strings, or literals.
 */
export async function grepSearchTool(args: {
  query: string;
  isRegex?: boolean;
  caseInsensitive?: boolean;
  includePattern?: string;
  excludePattern?: string;
  path?: string;
  maxResults?: number;
}): Promise<GrepSearchResult> {
  if (!args.query || args.query.trim() === '') {
    throw new Error('Missing required argument: "query"');
  }

  const query = args.query.trim();
  const limit = Math.min(Math.max(1, args.maxResults || 50), 100);
  const isRegex = Boolean(args.isRegex);
  const caseInsensitive = args.caseInsensitive !== false;

  let matcher: RegExp;
  try {
    const flags = caseInsensitive ? 'i' : '';
    const pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    matcher = new RegExp(pattern, flags);
  } catch (err: any) {
    throw new Error(`Invalid regex pattern "${query}": ${err.message}`);
  }

  const matches: GrepMatchItem[] = [];
  let filesSearched = 0;

  // 1. Direct single-file search: if path points directly to an existing file, search it immediately
  if (args.path && args.path.trim() !== '') {
    try {
      const directTargetUri = resolveWorkspaceUri(args.path.trim());
      const stat = await vscode.workspace.fs.stat(directTargetUri);
      if (stat.type === vscode.FileType.File) {
        const bytes = await vscode.workspace.fs.readFile(directTargetUri);
        const text = Buffer.from(bytes).toString('utf8');
        const lines = text.split('\n');
        const relPath = vscode.workspace.asRelativePath(directTargetUri);

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          if (matcher.test(lineText)) {
            matches.push({
              file: relPath,
              line: i + 1,
              content: lineText.trim().slice(0, 300)
            });
            if (matches.length >= limit) break;
          }
        }

        return {
          query,
          totalMatches: matches.length,
          filesSearched: 1,
          matches
        };
      }
    } catch {
      // Not a single file or file not found; proceed to workspace/directory glob search
    }
  }

  // 2. Build glob patterns for findFiles
  let includeGlob = args.includePattern || '**/*';
  if (args.path && args.path.trim() !== '') {
    const cleanPath = args.path.trim().replace(/^\/+|\/+$/g, '').replace(/^(\.\/|\.\\)+/, '');
    if (cleanPath && cleanPath !== '.') {
      includeGlob = args.includePattern
        ? `${cleanPath}/**/${args.includePattern.replace(/^\**/, '**')}`
        : `${cleanPath}/**/*`;
    }
  }

  const excludeGlob =
    args.excludePattern || '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/*.lock,**/*.vsix}';

  let files: vscode.Uri[] = [];
  try {
    files = await vscode.workspace.findFiles(includeGlob, excludeGlob, 300);
  } catch {}

  // Fallback: If findFiles returned no files (e.g. cold index or custom path), perform a direct VFS walk
  if (!files || files.length === 0) {
    try {
      const baseUri = args.path && args.path.trim() !== '' ? resolveWorkspaceUri(args.path.trim()) : resolveWorkspaceUri('');
      files = await collectWorkspaceFiles(baseUri, 300);
    } catch {}
  }

  for (const file of files) {
    // Skip binary file extensions
    if (/\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|zip|tar|gz|exe|dll|dylib|so|node|vsix|woff|woff2|ttf|eot|db|sqlite)$/i.test(file.fsPath)) {
      continue;
    }

    try {
      filesSearched++;
      const bytes = await vscode.workspace.fs.readFile(file);
      // Skip files larger than 1MB
      if (bytes.byteLength > 1024 * 1024) continue;

      const text = Buffer.from(bytes).toString('utf8');
      const lines = text.split('\n');
      const relPath = vscode.workspace.asRelativePath(file);

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        if (matcher.test(lineText)) {
          matches.push({
            file: relPath,
            line: i + 1,
            content: lineText.trim().slice(0, 300)
          });

          if (matches.length >= limit) break;
        }
      }

      if (matches.length >= limit) break;
    } catch {
      // Ignore unreadable files
    }
  }

  return {
    query,
    totalMatches: matches.length,
    filesSearched,
    matches
  };
}

/**
 * Fast recursive directory walker fallback when findFiles is cold or unindexed.
 */
async function collectWorkspaceFiles(dirUri: vscode.Uri, maxFiles = 300): Promise<vscode.Uri[]> {
  const result: vscode.Uri[] = [];
  const queue: vscode.Uri[] = [dirUri];

  while (queue.length > 0 && result.length < maxFiles) {
    const current = queue.shift()!;
    try {
      const entries = await vscode.workspace.fs.readDirectory(current);
      for (const [name, type] of entries) {
        if (name === 'node_modules' || name === '.git' || name === 'dist' || name === 'out') {
          continue;
        }
        const childUri = vscode.Uri.joinPath(current, name);
        if (type === vscode.FileType.Directory) {
          queue.push(childUri);
        } else if (type === vscode.FileType.File) {
          result.push(childUri);
          if (result.length >= maxFiles) break;
        }
      }
    } catch {}
  }

  return result;
}

/**
 * Tool: read_file
 * Reads full UTF-8 contents of a file using vscode.workspace.fs.
 * Includes context-safety guards to prevent LLM token buffer overflow.
 */
export async function readFileTool(args: { path: string }): Promise<string> {
  if (!args.path) {
    throw new Error('Missing required argument: "path"');
  }

  const targetUri = resolveWorkspaceUri(args.path);
  const bytes = await vscode.workspace.fs.readFile(targetUri);
  const fullText = Buffer.from(bytes).toString('utf8');

  const MAX_FILE_CHARS = 80000;
  if (fullText.length > MAX_FILE_CHARS) {
    return (
      fullText.slice(0, MAX_FILE_CHARS) +
      `\n\n[M.I.K.E. NOTICE: File content truncated at ${MAX_FILE_CHARS} characters (~20k tokens) to prevent context limit overflow.]`
    );
  }

  return fullText;
}

/**
 * Tool: list_dir
 * Reads directory contents using vscode.workspace.fs.
 */
export async function listDirTool(args: { path?: string }): Promise<DirEntry[]> {
  const targetUri = resolveWorkspaceUri(args.path || '');
  const entries = await vscode.workspace.fs.readDirectory(targetUri);

  const mapped = entries.map(([name, fileType]) => {
    let type: 'file' | 'directory' | 'symlink' | 'unknown' = 'unknown';
    if (fileType === vscode.FileType.File) {
      type = 'file';
    } else if (fileType === vscode.FileType.Directory) {
      type = 'directory';
    } else if (fileType === vscode.FileType.SymbolicLink) {
      type = 'symlink';
    }
    return { name, type };
  });

  const MAX_ENTRIES = 200;
  if (mapped.length > MAX_ENTRIES) {
    return mapped.slice(0, MAX_ENTRIES);
  }
  return mapped;
}

// Session cache for user-approved commands
let sessionAllowAllCommands = false;
const sessionApprovedCommands = new Set<string>();

export function resetCommandPermissions(): void {
  sessionAllowAllCommands = false;
  sessionApprovedCommands.clear();
}

/**
 * Tool: run_command
 * Safely executes unit tests, test suites, builds, or analysis/metric scripts within workspace.
 * Output is bounded to prevent LLM context limit overflow.
 * Prompts user for approval unless configured for auto-execution or session-approved.
 */
export async function runCommandTool(args: {
  command: string;
  cwd?: string;
  timeoutSeconds?: number;
}): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  if (!args.command || args.command.trim() === '') {
    throw new Error('Missing required argument: "command"');
  }

  const normalizedCmd = args.command.trim();

  // 1. Safe Interception: If LLM issued a file deletion command (del, rm, erase, rmdir),
  // handle it directly and instantly via native VS Code VFS without spawning hanging subshells
  const delMatch = normalizedCmd.match(/^(?:del|rm|erase|rmdir)\s+(?:-[rfivq\/s]+\s+)*['"]?([^'"]+)['"]?$/i);
  if (delMatch) {
    const targetPath = delMatch[1].trim();
    if (targetPath && !targetPath.includes('*') && !targetPath.includes('?')) {
      try {
        const delRes = await deleteFileTool({ path: targetPath, recursive: true });
        return {
          exitCode: 0,
          stdout: delRes.message,
          stderr: ''
        };
      } catch (delErr: any) {
        // If native delete throws, continue to normal execution fallback
      }
    }
  }

  // Permission & confirmation check
  const { AgentClient } = await import('../agent/client.js');
  const config = await AgentClient.getConfig();
  const mode = config.commandMode || 'prompt';

  if (mode === 'deny') {
    throw new Error(`Command execution is disabled in M.I.K.E. settings (Blocked: "${normalizedCmd}")`);
  }

  const isApproved =
    mode === 'auto' ||
    sessionAllowAllCommands ||
    sessionApprovedCommands.has(normalizedCmd);

  if (!isApproved) {
    const choice = await vscode.window.showWarningMessage(
      `M.I.K.E. requests permission to run:\n\n${normalizedCmd}`,
      { modal: true },
      'Run Once',
      'Always Allow This Session',
      'Deny'
    );

    if (choice === 'Always Allow This Session') {
      sessionAllowAllCommands = true;
    } else if (choice === 'Run Once') {
      sessionApprovedCommands.add(normalizedCmd);
    } else {
      throw new Error(`Command execution was denied or dismissed by user: "${normalizedCmd}"`);
    }
  }

  const folders = vscode.workspace.workspaceFolders;
  const defaultCwd = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
  const targetCwd = args.cwd ? path.resolve(defaultCwd, args.cwd) : defaultCwd;
  const timeoutMs = Math.min(Math.max(1, args.timeoutSeconds || 60), 300) * 1000;

  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let isSettled = false;

    const child = cp.exec(
      normalizedCmd,
      {
        cwd: targetCwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1',
          CI: '1'
        }
      },
      (error, stdout, stderr) => {
        if (isSettled) return;
        isSettled = true;
        if (timer) clearTimeout(timer);

        let stdoutText = stdout ? stdout.toString() : '';
        let stderrText = stderr ? stderr.toString() : '';

        const MAX_OUTPUT_CHARS = 40000;
        if (stdoutText.length > MAX_OUTPUT_CHARS) {
          stdoutText =
            stdoutText.slice(0, MAX_OUTPUT_CHARS) +
            `\n... [STDOUT TRUNCATED: Exceeded ${MAX_OUTPUT_CHARS} characters]`;
        }
        if (stderrText.length > MAX_OUTPUT_CHARS) {
          stderrText =
            stderrText.slice(0, MAX_OUTPUT_CHARS) +
            `\n... [STDERR TRUNCATED: Exceeded ${MAX_OUTPUT_CHARS} characters]`;
        }

        const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({
          exitCode,
          stdout: stdoutText,
          stderr: stderrText
        });
      }
    );

    // Close stdin immediately so commands that prompt for interactive confirmation don't hang
    try {
      child.stdin?.end();
    } catch {}

    // Hard fallback safety timer to kill process if cp.exec timeout fails to terminate
    timer = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      try {
        child.kill('SIGKILL');
      } catch {}
      resolve({
        exitCode: 124,
        stdout: '',
        stderr: `Command timed out after ${timeoutMs / 1000}s and was terminated.`
      });
    }, timeoutMs + 1000);
  });
}

export interface DiagnosticItem {
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: 'Error' | 'Warning' | 'Information' | 'Hint';
  source: string;
  code: string;
  message: string;
}

export interface DiagnosticsResult {
  totalErrors: number;
  totalWarnings: number;
  diagnostics: DiagnosticItem[];
}

/**
 * Tool: get_diagnostics
 * Queries active Language Server diagnostics across workspace or for a specific file.
 */
export async function getDiagnosticsTool(args: {
  path?: string;
  severity?: 'error' | 'warning' | 'all';
  maxResults?: number;
}): Promise<DiagnosticsResult> {
  const limit = Math.min(Math.max(1, args.maxResults || 50), 100);
  const severityFilter = args.severity || 'all';

  let rawList: Array<[vscode.Uri, vscode.Diagnostic[]]> = [];

  if (args.path && args.path.trim() !== '') {
    const targetUri = resolveWorkspaceUri(args.path.trim());
    const diags = vscode.languages.getDiagnostics(targetUri);
    rawList = [[targetUri, diags]];
  } else {
    rawList = vscode.languages.getDiagnostics();
  }

  const items: DiagnosticItem[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [uri, diags] of rawList) {
    const relFile = vscode.workspace.asRelativePath(uri);
    // Ignore node_modules, git, and build outputs
    if (/node_modules|\.git|dist|out|\.vscode/i.test(relFile)) {
      continue;
    }

    for (const d of diags) {
      const isError = d.severity === vscode.DiagnosticSeverity.Error;
      const isWarn = d.severity === vscode.DiagnosticSeverity.Warning;

      if (isError) totalErrors++;
      if (isWarn) totalWarnings++;

      if (severityFilter === 'error' && !isError) continue;
      if (severityFilter === 'warning' && !isWarn) continue;

      let sevStr: 'Error' | 'Warning' | 'Information' | 'Hint' = 'Information';
      if (isError) sevStr = 'Error';
      else if (isWarn) sevStr = 'Warning';
      else if (d.severity === vscode.DiagnosticSeverity.Hint) sevStr = 'Hint';

      const codeVal = d.code ? (typeof d.code === 'object' ? String(d.code.value) : String(d.code)) : '';

      items.push({
        file: relFile,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
        endLine: d.range.end.line + 1,
        endColumn: d.range.end.character + 1,
        severity: sevStr,
        source: d.source || 'compiler',
        code: codeVal,
        message: d.message
      });
    }
  }

  return {
    totalErrors,
    totalWarnings,
    diagnostics: items.slice(0, limit)
  };
}

/**
 * Standard OpenAI Tools Specification
 */
export const OPENAI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description:
        'Writes full content directly to a workspace file. Automatically creates parent directories, creates a side-by-side diff snapshot (mike-diff://), and returns compiler/LSP diagnostics.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative file path (e.g. ./src/main.py or ./docs/intent_briefs/UC-001.md)'
          },
          content: {
            type: 'string',
            description: 'The complete text content to write to the file'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the full UTF-8 content of a file in the workspace using native VS Code VFS.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative or absolute path of the file to read.'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_file',
      description: 'Deletes a file or directory in the workspace using native VS Code VFS.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative or absolute path of the file or directory to delete.'
          },
          recursive: {
            type: 'boolean',
            description: 'Whether to recursively delete directories (default: true).'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_dir',
      description: 'List contents (files and directories) within a workspace directory.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative or absolute directory path. Defaults to root workspace directory.'
          }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_diagnostics',
      description:
        'Inspect compiler, type checker, and linter diagnostics (errors and warnings) across the entire workspace or in a specific file. Use this to discover broken code, type errors, or syntax issues.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional workspace-relative or absolute file path. If omitted, checks the entire workspace.'
          },
          severity: {
            type: 'string',
            enum: ['error', 'warning', 'all'],
            description: 'Severity level filter (default: "all").'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of diagnostics to return (default: 50, max: 100).'
          }
        }
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description:
        'Execute a shell command, unit test runner (e.g. pytest, npm test, dotnet test), or metric/analysis script in the workspace. STRICT RULE: DO NOT use this tool for reading/writing/listing files (always use write_file, read_file, or list_dir instead).',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute (e.g., "pytest", "python scripts/calc_complexity.py", "npm test", "dotnet test").'
          },
          cwd: {
            type: 'string',
            description: 'Optional workspace-relative directory to execute the command in. Defaults to workspace root.'
          },
          timeoutSeconds: {
            type: 'number',
            description: 'Optional maximum timeout in seconds before terminating the process (default: 60s, max: 300s).'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'find_symbol',
      description:
        'Search for classes, interfaces, functions, methods, or variables across the workspace using VS Code AST symbol indexing (instant and far more accurate than grep).',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Symbol name or substring to search for (e.g., "UserService", "calculateParity", "executeTool").'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of symbol results to return (default: 25, max: 50).'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep_search',
      description:
        'Search across all workspace files for string literals, regex patterns, API routes, config keys, CSS class names, or exact code matches using fast VFS scanning.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The substring or regex pattern to search for across files.'
          },
          isRegex: {
            type: 'boolean',
            description: 'Whether query should be evaluated as a regular expression (default: false).'
          },
          caseInsensitive: {
            type: 'boolean',
            description: 'Perform case-insensitive matching (default: true).'
          },
          includePattern: {
            type: 'string',
            description: 'Optional glob pattern to restrict file matching (e.g. "**/*.ts", "src/**").'
          },
          excludePattern: {
            type: 'string',
            description: 'Optional glob pattern to exclude files.'
          },
          path: {
            type: 'string',
            description: 'Optional subdirectory path to scope the search.'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of match lines to return (default: 50, max: 100).'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_skills',
      description: 'List all available agent skills discovered across the workspace and user environment.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'load_skill',
      description: 'Load the full instructions and guidelines of a specific skill.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name or ID of the skill to load.'
          }
        },
        required: ['name']
      }
    }
  }
];

/**
 * Dynamic Tool Dispatcher
 */
export async function executeTool(name: string, rawArgs: string): Promise<string> {
  let parsedArgs: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim().length > 0) {
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch (err: unknown) {
      throw new Error(`Failed to parse arguments JSON for tool "${name}": ${(err as Error).message}`);
    }
  }

  switch (name) {
    case 'write_file': {
      const result = await writeFileTool({
        path: String(parsedArgs.path || ''),
        content: String(parsedArgs.content ?? '')
      });
      return JSON.stringify(result, null, 2);
    }
    case 'read_file': {
      const result = await readFileTool({
        path: String(parsedArgs.path || '')
      });
      return result;
    }
    case 'delete_file': {
      const result = await deleteFileTool({
        path: String(parsedArgs.path || ''),
        recursive: parsedArgs.recursive !== false
      });
      return JSON.stringify(result, null, 2);
    }
    case 'list_dir': {
      const result = await listDirTool({
        path: parsedArgs.path ? String(parsedArgs.path) : undefined
      });
      return JSON.stringify(result, null, 2);
    }
    case 'get_diagnostics': {
      const result = await getDiagnosticsTool({
        path: parsedArgs.path ? String(parsedArgs.path) : undefined,
        severity: (parsedArgs.severity as 'error' | 'warning' | 'all') || undefined,
        maxResults: typeof parsedArgs.maxResults === 'number' ? parsedArgs.maxResults : undefined
      });
      return JSON.stringify(result, null, 2);
    }
    case 'find_symbol': {
      const result = await findSymbolTool({
        query: String(parsedArgs.query || ''),
        maxResults: typeof parsedArgs.maxResults === 'number' ? parsedArgs.maxResults : undefined
      });
      return JSON.stringify(result, null, 2);
    }
    case 'grep_search': {
      const query = String(parsedArgs.query || parsedArgs.Query || parsedArgs.search || parsedArgs.pattern || '');
      const isRegex = Boolean(parsedArgs.isRegex ?? parsedArgs.IsRegex);
      const caseInsensitive = parsedArgs.caseInsensitive !== false && parsedArgs.CaseInsensitive !== false;
      const includePattern = parsedArgs.includePattern
        ? String(parsedArgs.includePattern)
        : parsedArgs.Includes
        ? Array.isArray(parsedArgs.Includes)
          ? String(parsedArgs.Includes[0])
          : String(parsedArgs.Includes)
        : undefined;
      const excludePattern = parsedArgs.excludePattern
        ? String(parsedArgs.excludePattern)
        : parsedArgs.Excludes
        ? Array.isArray(parsedArgs.Excludes)
          ? String(parsedArgs.Excludes[0])
          : String(parsedArgs.Excludes)
        : undefined;
      const pathArg = parsedArgs.path
        ? String(parsedArgs.path)
        : parsedArgs.SearchPath
        ? String(parsedArgs.SearchPath)
        : parsedArgs.searchPath
        ? String(parsedArgs.searchPath)
        : parsedArgs.dir
        ? String(parsedArgs.dir)
        : undefined;
      const maxResults =
        typeof parsedArgs.maxResults === 'number'
          ? parsedArgs.maxResults
          : typeof parsedArgs.MaxResults === 'number'
          ? parsedArgs.MaxResults
          : undefined;

      const result = await grepSearchTool({
        query,
        isRegex,
        caseInsensitive,
        includePattern,
        excludePattern,
        path: pathArg,
        maxResults
      });
      return JSON.stringify(result, null, 2);
    }
    case 'run_command': {
      const result = await runCommandTool({
        command: String(parsedArgs.command || ''),
        cwd: parsedArgs.cwd ? String(parsedArgs.cwd) : undefined,
        timeoutSeconds: typeof parsedArgs.timeoutSeconds === 'number' ? parsedArgs.timeoutSeconds : undefined
      });
      return JSON.stringify(result, null, 2);
    }
    case 'list_skills': {
      const { SkillManager } = await import('../skills/skillManager.js');
      const skills = await SkillManager.getSkills();
      return JSON.stringify(
        skills.map((s) => ({ id: s.id, name: s.name, description: s.description, source: s.source })),
        null,
        2
      );
    }
    case 'load_skill': {
      const { SkillManager } = await import('../skills/skillManager.js');
      const skillName = String(parsedArgs.name || '');
      const skill = await SkillManager.findSkill(skillName);
      if (!skill) {
        throw new Error(`Skill "${skillName}" not found.`);
      }
      return await SkillManager.loadSkillContent(skill);
    }
    default:
      throw new Error(`Unknown tool: "${name}"`);
  }
}


