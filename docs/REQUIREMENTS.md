# Software Requirements Specification (SRS) — M.I.K.E.

**System Name:** Machine-Integrated Koding Extension (M.I.K.E.)  
**Document Standard:** IEEE Std 830-1998 (Adapted for Enterprise AI Tooling)  
**Version:** 1.2.0  
**Status:** Approved & Verified

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional, operational, and non-functional requirements for **M.I.K.E.** (Machine-Integrated Koding Extension), an enterprise-hardened VS Code extension providing autonomous coding assistant capabilities over internal OpenAI-compatible LLM endpoints.

### 1.2 Scope
M.I.K.E. operates purely within the Visual Studio Code extension host process. It provides chat interaction, tool calling (`write_file`, `read_file`, `list_dir`, `grep_search`, `find_symbol`, `get_diagnostics`, `run_command`), session persistence, atomic checkpoint rollbacks, in-editor inline transformations (<kbd>Cmd+I</kbd>), skill discovery, and in-memory diff visualization without external dependencies.

---

## 2. Functional Requirements (FR)

### FR-01: Native Virtual Filesystem (VFS) Operations
- **FR-01.1:** All filesystem write actions shall use `vscode.workspace.fs.writeFile`.
- **FR-01.2:** All filesystem read actions shall use `vscode.workspace.fs.readFile`.
- **FR-01.3:** All directory traversal actions shall use `vscode.workspace.fs.readDirectory`.
- **FR-01.4 (Strict Constraint):** Under no circumstance shall the system invoke `child_process.exec`, `child_process.spawn`, shell redirects (`cat >`, `echo >`), or PowerShell pipes to modify files on disk.

### FR-02: Side-by-Side In-Memory Diffing
- **FR-02.1:** Prior to modifying any pre-existing workspace file, the system shall snapshot the original file content into an in-memory document provider registered under the custom URI scheme `mike-diff://`.
- **FR-02.2:** Upon successful file mutation, the system shall trigger `vscode.diff` between the `mike-diff://` URI and the target workspace file URI.
- **FR-02.3:** The diff view shall display with the format: `<filename> (Original ↔ Modified)`.

### FR-03: Full-Text Workspace Grep (`grep_search`)
- **FR-03.1:** The system shall provide a native, zero-dependency workspace full-text grep tool via `vscode.workspace.findFiles` and standard VFS reading.
- **FR-03.2:** Supports literal string matching, regular expressions (`isRegex`), case-insensitivity (`caseInsensitive`), and glob include/exclude patterns.
- **FR-03.3:** Results shall return matching file paths, line numbers, and line previews bounded by maximum result limits.

### FR-04: Language Server Diagnostics & Compiler Self-Healing
- **FR-04.1:** Upon writing any file via `write_file`, the tool shall query active Language Server diagnostics (`vscode.languages.getDiagnostics`) and report syntax/type errors in the tool result payload.
- **FR-04.2:** The agent system prompt shall mandate immediate self-correction of reported compiler diagnostics in the next turn.
- **FR-04.3:** The system shall expose a `get_diagnostics` tool allowing the agent to inspect workspace-wide errors on-demand.

### FR-05: Atomic Session Checkpoints & "Reject All" Rollbacks
- **FR-05.1:** The system shall record pristine file snapshots in `CheckpointManager` prior to any AI write operation.
- **FR-05.2:** The sidebar UI and Command Palette shall expose `⏪ Reject All` to atomically revert all modified files and delete newly created files.
- **FR-05.3:** Users may revert individual files via `↺ Revert` or clear checkpoints via `✓ Keep`.

### FR-06: Session Persistence & Multi-Thread History
- **FR-06.1:** Active conversation threads and messages shall persist across VS Code restarts and window reloads in `workspaceState`.
- **FR-06.2:** Thread titles shall auto-derive from the user's initial prompt, cleanly stripping context chips (`@editor`, `@selection`) and skill prefixes.
- **FR-06.3:** The sidebar shall feature a sliding history drawer with relative timestamps, message counts, thread switching, creation (`+ New`), and deletion.

### FR-07: In-Editor Inline Transform (`Cmd+I` / `Ctrl+I`)
- **FR-07.1:** Highlighted code or active lines can be transformed directly in the editor via <kbd>Cmd+I</kbd> (macOS) / <kbd>Ctrl+I</kbd> (Win/Linux).
- **FR-07.2:** Provides a quick-recipe HUD (`Optimize`, `Error Handling`, `Types/JSDoc`, `Async/Await`, `Unit Tests`, `Custom`).
- **FR-07.3:** Direct code replacement executes via `editor.edit()`, maintaining native <kbd>Cmd+Z</kbd> undo/redo capability.
- **FR-07.4:** Post-transformation notifications report compiler diagnostics with 1-click `[ ✨ Fix Diagnostics with M.I.K.E. ]` or `[ ⏪ Revert ]`.

### FR-08: Direct Skill Discovery & Invocation
- **FR-08.1:** The system shall scan workspace paths (`.agent/skills/**/SKILL.md`, `.skills/**/SKILL.md`, `skills/**/SKILL.md`) and global paths (`~/.gemini/config/skills/`, `~/.config/poolside/skills/`, `~/.config/mike/skills/`).
- **FR-08.2:** Prompts starting with `/<skill-name>` shall parse the skill definition, load markdown instructions, and inject them into the system/user context.
- **FR-08.3:** The webview UI shall provide an interactive slash-autocomplete menu with keyboard navigation (<kbd>↑</kbd>, <kbd>↓</kbd>, <kbd>Tab</kbd>, <kbd>Enter</kbd>).

### FR-09: Command Execution Policy & Permissions
- **FR-09.1:** Shell commands invoked via `run_command` shall strictly enforce user execution policy (`prompt`, `auto`, `deny`).
- **FR-09.2:** In `prompt` mode, users can approve `[ Run Once ]`, `[ Always Allow This Session ]`, or `[ Deny ]`.

---

## 3. Non-Functional & Security Requirements (NFR)

### NFR-01: Zero Runtime npm Dependencies
- The extension bundle shall rely strictly on built-in Node.js / VS Code APIs, maintaining a packaged `.vsix` size under 50 KB.

### NFR-02: Zero External Telemetry
- All outgoing network traffic shall route exclusively to the user-configured `baseUrl`. No third-party analytics or external telemetry calls are permitted.

### NFR-03: Air-Gapped / Proxy Compatibility
- HTTP requests shall execute via global `fetch` to inherit operating system certificates, corporate proxy configurations, and TLS trust stores.

---

## 4. Potential Future Upgrades (Roadmap)

1. **Local Custom Tool Registry (`.mike/tools.json` / `.agent/tools/`)**:
   - Zero-dependency local script runner that auto-discovers workspace Python/Bash tools and exposes them as native function-calling tools to the LLM without external MCP networking.
2. **Context Weight & Token Counter**:
   - Status bar and sidebar indicator displaying active conversation token count and percentage of model context window used.
3. **Workspace Rules Multi-Root Ingestion**:
   - Support for dynamic multi-root workspaces with per-folder rule hierarchies (`.agent/AGENTS.md`, `.cursorrules`, `MIKE.md`).
4. **Inline Multi-Cursor Refactoring**:
   - Simultaneous inline transform across multi-cursor selections and split editors.

---

## 5. Verification & Traceability Matrix

| Requirement ID | Module | Implementation File | Verification Status |
| :--- | :--- | :--- | :--- |
| **FR-01** (VFS File I/O) | `fileTools` | [`src/tools/fileTools.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/tools/fileTools.ts) | PASSED (Pure Buffer FS) |
| **FR-02** (In-Memory Diff) | `fileTools` | [`src/tools/fileTools.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/tools/fileTools.ts) | PASSED (`mike-diff://`) |
| **FR-03** (Workspace Grep) | `fileTools` | [`src/tools/fileTools.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/tools/fileTools.ts) | PASSED (`grep_search`) |
| **FR-04** (Diagnostics) | `fileTools` / `client` | [`src/tools/fileTools.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/tools/fileTools.ts) | PASSED (`get_diagnostics`) |
| **FR-05** (Checkpoints / Rollback) | `checkpointManager` | [`src/tools/checkpointManager.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/tools/checkpointManager.ts) | PASSED (`⏪ Reject All`) |
| **FR-06** (Session Persistence) | `sessionManager` | [`src/agent/sessionManager.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/agent/sessionManager.ts) | PASSED (`npm test`) |
| **FR-07** (Inline Transform) | `inlineTransform` / `client` | [`src/editor/inlineTransform.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/editor/inlineTransform.ts) | PASSED (`Cmd+I` HUD) |
| **FR-08** (Skills & Autocomplete) | `skillManager` / `sidebar` | [`src/skills/skillManager.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/skills/skillManager.ts) | PASSED (Bidirectional sync) |
| **FR-09** (Command Policy) | `fileTools` | [`src/tools/fileTools.ts`](file:///Users/mdzie/GitHub/MIKE_work/Machine_Integrated_Koding_Extension/src/tools/fileTools.ts) | PASSED (Session allowlist) |
