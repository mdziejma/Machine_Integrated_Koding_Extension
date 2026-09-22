<p align="center">
  <img src="../media/banner.jpg" alt="M.I.K.E. Logo" width="550" />
</p>

# M.I.K.E. — User & Operator Guide

**Version:** 1.5.0  
**Status:** Production Ready  

This guide provides end-to-end instructions for installing, configuring, operating, and leveraging native IDE superpowers with **M.I.K.E.** (**Machine-Integrated Koding Extension**) in Visual Studio Code.

---

## 1. Installation

### From Pre-Packaged `.vsix` Bundle
To install the compiled `v1.5.0` package in VS Code:

```bash
code --install-extension mike-koding-extension-1.5.0.vsix --force
```

Alternatively, in the VS Code UI:
1. Open the **Extensions** view (<kbd>Ctrl+Shift+X</kbd> / <kbd>Cmd+Shift+X</kbd>).
2. Click the **`...`** (Views and More Actions) menu in the top-right corner.
3. Select **Install from VSIX...**
4. Choose `mike-koding-extension-1.5.0.vsix`.
5. Reload VS Code window (<kbd>Cmd+Shift+P</kbd> -> `Developer: Reload Window`).

---

## 2. Configuration & Connection Setup

### A. In-Sidebar Settings Panel (`⚙️ Config`)
1. Click the **M.I.K.E.** sparkle icon in the VS Code Activity Bar on the left.
2. In the header bar, click **`⚙️ Config`** to toggle the configuration drawer.
3. Configure your connection and generation parameters:
   - **Base URL:** e.g. `http://localhost:11434/v1` (Ollama), `http://localhost:1234/v1` (LM Studio), `https://api.openai.com/v1` (OpenAI), or custom enterprise endpoint.
   - **API Key:** Your API key / Bearer token (stored securely in OS Credential Keychain; leave blank for local models).
   - **Model Selection & Auto-Discovery:**
     - Click **`🔄 Auto-Discover`** (or click **Test**) to automatically probe `/models` on your server and populate all available active models (e.g., `qwen2.5-coder:32b`, `deepseek-coder`, `gpt-4o`, etc.).
     - Or choose `✏️ Enter Custom Model Name...` to type/paste any exact model ID. M.I.K.E. remembers all custom and discovered models in your persistent model history.
   - **Temperature:** Adjustable slider from `0.0` to `1.0` (Default: `0.0` for deterministic, typo-free code generation).
   - **Max Output Tokens:** Limit per turn (Default: `8192` tokens to prevent truncation during large file generation).
   - **Command Execution Policy:** `Ask Before Running (Prompt)`, `Always Allow (Autonomous)`, or `Disabled (Block Shell)`.
4. Click **Test**:
   - The connection prober automatically cycles through candidate endpoints and auth header formats, auto-discovers server models, and saves confirmed working credentials globally.
5. Click **Save** to persist any manual updates immediately.

### B. Global Cross-Folder Persistence
- Settings are stored in VS Code's **`globalState`** and OS Credential Keychain (**`SecretStorage`**).
- When you open new workspace folders or restart VS Code, your connection settings, model choice, temperature, and token preferences remain active without requiring re-entry or `.vscode/settings.json` files.

---

## 3. Core Capabilities & Daily Workflows

### ⚡ 1. In-Editor Inline Transform (<kbd>Cmd + I</kbd> / <kbd>Ctrl + I</kbd>)
Refactor and transform code directly in the active editor without context-switching to the sidebar:
1. Highlight any code selection (or place cursor on a line) in the editor.
2. Press <kbd>Cmd+I</kbd> (macOS) or <kbd>Ctrl+I</kbd> (Windows/Linux) or right-click $\rightarrow$ **`M.I.K.E.: Inline Edit / Transform`**.
3. Choose a quick recipe or type a custom instruction:
   - `$(edit) Custom Instruction...`
   - `$(zap) Optimize Performance & Logic`
   - `$(shield) Add Error Handling & Null Safety`
   - `$(symbol-keyword) Add TypeScript Types & JSDoc`
   - `$(sync) Convert to Async / Await`
   - `$(beaker) Generate Inline Unit Test Block`
4. M.I.K.E. transforms the selection inline with native <kbd>Cmd+Z</kbd> undo support and prompts you to **`✓ Keep Changes`**, **`⏪ Revert`**, or **`✨ Fix Diagnostics with M.I.K.E.`**.

### 💬 2. Session Persistence & Multi-Thread History
- **Multi-Thread Drawer:** Click **`💬 History`** in the sidebar header to open your session drawer.
- **Auto-Derived Titles:** Threads automatically name themselves based on your first prompt (stripping file chips and skill tags).
- **Session Switching:** Click any previous thread to immediately restore the conversation, assistant responses, and collapsible tool output badges.
- **`+ New` Chat:** Start a fresh conversation anytime while preserving older threads.

### ⏪ 3. Atomic Session Checkpoints & "Reject All" Rollback
- **Safety Net:** Before any `write_file` operation touches disk, M.I.K.E. captures the pristine file bytes.
- **Session Changes Bar:** Displays the count of modified and newly created files.
- **`⏪ Reject All`**: Reverts all modified files and deletes newly created files in a single click.
- **`↺ Revert`**: Reverts an individual file directly from the modified file list.
- **`✓ Keep`**: Accepts changes and clears active checkpoints.

### 🩺 4. Language Server Diagnostics & Compiler Self-Healing
- **Live Compiler Feedback:** When M.I.K.E. writes code, active Language Server diagnostics (TypeScript, Pylance, Roslyn, Go) are evaluated immediately.
- **Autonomous Repair:** If compiler errors are detected, M.I.K.E. is instructed to automatically correct syntax and type errors in the next turn.
- **Editor Quick-Fix Lightbulb:** Click the lightbulb on any squiggly error line in the editor and choose **`✨ Ask M.I.K.E. to fix: <error>`**.
- **`get_diagnostics` Tool:** Allows M.I.K.E. to inspect workspace-wide errors and warnings on-demand.

### 🔎 5. Full-Text Workspace Grep (`grep_search`)
- Fast, zero-dependency VFS text searching.
- Supports exact string literals, regular expressions (`isRegex`), case-insensitivity (`caseInsensitive`), and file glob filtering (`*.ts`, `src/**`).
- Returns matched file paths, line numbers, and preview snippets.

### 🔍 6. AST Workspace Symbol Indexing (`find_symbol`)
- Instantly queries VS Code's symbol index for classes, functions, methods, and interfaces without scanning files on disk.

### ⚡ 7. Direct Skill Invocation (`/<skill-name>`)
- **Interactive Autocomplete:** Type `/` in the prompt input to filter and auto-complete discovered skills from `.agent/skills/`, `.skills/`, and global `~/.gemini/config/skills/`.
- **Context Injection:** When invoked, the full skill instructions are injected as specialized domain directives for the agent.

### 📄 8. Editor Context Chips (`@editor` / `@selection`)
- Click **`📄 @editor`** or **`✂️ @selection`** above the prompt box to attach active file paths and highlighted line ranges directly to your query.

---

## 4. Troubleshooting Reference

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| `HTTP 405 Method Not Allowed` | Base URL format mismatch (e.g., missing `/v1` or `/openai/v1`) | Click `⚙️ Config` -> **Test** to auto-detect the working URL format. |
| `HTTP 401 Unauthorized` | Invalid or expired API Key | Re-enter API Key in `⚙️ Config` and click **Save**. |
| `Connection probe failed` | LLM endpoint offline or proxy blocked | Verify local network access or run `node scripts/mock_llm_server.mjs` for offline testing. |
| `Diagnostics error reported` | Syntax or type error introduced in file | Use `✨ Fix Diagnostics with M.I.K.E.` or click `⏪ Revert` in the changes bar. |
| `No workspace folder is open` | VS Code is running in empty window mode | Open a project folder (`File > Open Folder`) before requesting file edits. |
