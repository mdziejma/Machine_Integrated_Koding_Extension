<p align="center">
  <img src="../media/banner.jpg" alt="M.I.K.E. Logo" width="550" />
</p>

# M.I.K.E. — Developer Hub & Architectural Reference

**M.I.K.E.** (**Machine-Integrated Koding Extension**) is an enterprise-grade autonomous AI software engineering extension for Visual Studio Code. Built natively using the VS Code Extensibility API and modern Web Standards (ES2022 / Node 18+ global fetch), M.I.K.E. connects directly to any OpenAI-compatible LLM inference endpoint (such as local Ollama, LM Studio, vLLM, OpenAI, or custom enterprise clusters).

**Version:** 1.5.0  
**Status:** Production Ready  

---

## 1. Architectural Principles & Constraints

### 🛡️ 1. Zero Shell / Subprocess File Mutation
Traditional AI plugins often execute CLI shellouts (`cat`, `echo`, `Set-Content`, `powershell.exe`, `git`) to mutate code on disk. In restricted corporate Windows workstations, this leads to:
- Process spawn blocks (AppLocker / endpoint security).
- Windows PowerShell pipeline character encoding corruptions (CRLF / BOM / UTF-16 bugs).
- Buffer hangs and headless terminal deadlocks.

**The M.I.K.E. Solution:**
Every single file operation (`write_file`, `read_file`, `list_dir`, `grep_search`) is performed through **`vscode.workspace.fs`** utilizing native UTF-8 `Uint8Array` / `Buffer` streams.

### 🔄 2. In-Memory Side-by-Side Diff Provider (`mike-diff://`)
When M.I.K.E. modifies an existing workspace file:
1. The prior disk content is snapshotted into an in-memory `DiffContentProvider` cache.
2. The file is written to the physical workspace.
3. VS Code's native `vscode.diff` command is invoked with `mike-diff://...` on the left and the active workspace URI on the right.
4. The user gains visual diff verification with native syntax highlighting and single-click revert.

### ⏪ 3. Atomic Session Checkpoint Engine (`CheckpointManager`)
- Records pre-modification file bytes before any AI write operation.
- The sidebar Session Changes bar and Command Palette provide instant atomic rollback (`⏪ Reject All`) and per-file revert (`↺ Revert`).

### ⚡ 4. In-Editor Inline Transform (`Cmd+I` / `Ctrl+I`)
- Provides a fast, localized code refactoring HUD over the active editor selection using VS Code's native `editor.edit()` buffer (with full <kbd>Cmd+Z</kbd> undo support).

### 💬 5. Workspace Session Persistence (`SessionManager`)
- Persists multi-thread chat histories across VS Code restarts in `workspaceState`, with auto-derived prompt titles, thread creation (`+ New`), switching, and pruning.

### 🌐 6. Native Host Networking & Global Secret Storage
Network calls to the LLM use Node 18+ global `fetch`:
- Inherits OS system proxies and corporate root certificates without external npm packages.
- API keys are encrypted in OS Credential Vault via `vscode.SecretStorage`.
- Zero runtime npm dependencies (extension bundle size is < 45 KB).

---

## 2. Directory Structure & Module Breakdown

```
Machine_Integrated_Koding_Extension/
├── src/
│   ├── extension.ts           # Extension activation, registration of commands, providers & globalState
│   ├── agent/
│   │   ├── client.ts          # AgentClient: Multi-turn loop, SSE streaming reader, inline transform, context safety
│   │   └── sessionManager.ts  # SessionManager: Multi-thread storage & workspaceState persistence
│   ├── editor/
│   │   └── inlineTransform.ts # InlineTransformManager: Cmd+I in-editor refactoring HUD & recipe dispatcher
│   ├── skills/
│   │   └── skillManager.ts    # SkillManager: Discovers, parses, and formats local & global SKILL.md files
│   ├── tools/
│   │   ├── fileTools.ts       # Native VFS tools (write_file, read_file, list_dir, grep_search, find_symbol, diagnostics)
│   │   └── checkpointManager.ts # CheckpointManager: Atomic pre-write snapshots & session rollback
│   └── webview/
│       └── sidebarProvider.ts # WebviewViewProvider: Theme-native sidebar, session history drawer & config panel
├── scripts/
│   ├── probe_endpoint.py      # Standalone zero-dependency Python connection prober
│   ├── mock_llm_server.mjs    # Zero-dependency local mock SSE LLM server for offline testing
│   ├── test_session_manager.mjs # Unit tests for multi-thread session persistence
│   └── test_inline_transform.mjs# Unit tests for inline code transformation engine
├── docs/                      # Enterprise documentation suite (README, USER_GUIDE, REQUIREMENTS, INITIALIZATION_GUIDE, PUBLISHING_GUIDE)
└── .agent/                    # Agent orientation and operational brief
```

---

## 3. Developer Quickstart

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- Visual Studio Code >= 1.85.0

### Setup & Build
```bash
# Install development dependencies
npm install

# Compile TypeScript in strict mode
npm run compile

# Run full automated test suite
npm test

# Live development file watcher
npm run watch
```

### Running the Offline Mock Server (Port 11435)
For offline local development without access to enterprise LLM endpoints:
```bash
node scripts/mock_llm_server.mjs
```
Configure M.I.K.E. Base URL to `http://127.0.0.1:11435/v1` and click **Test** to connect.

---

## 4. Packaging into VSIX

```bash
# Package extension into distributable VSIX bundle
npm run package
```
This compiles TypeScript and packages `mike-koding-extension-1.5.0.vsix`.
