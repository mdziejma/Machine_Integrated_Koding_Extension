import * as vscode from 'vscode';

export function getSidebarHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'icon.png'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sidebar.js'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <title>M.I.K.E. Assistant</title>
  <link rel="stylesheet" href="${styleUri}">
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

  <!-- Real-Time Context Token Meter & Model Capacity Gauge -->
  <div id="context-meter-bar" class="context-meter-bar" title="Session Context Window Usage">
    <div class="context-meter-info">
      <span id="token-meter-label">🧠 Context: 0 / 128k (0%)</span>
      <span id="token-model-badge" class="token-model-badge">Default</span>
    </div>
    <div class="context-meter-track">
      <div id="context-meter-fill" class="context-meter-fill" style="width: 0%;"></div>
    </div>
  </div>

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
      <label class="config-label">Global AGENTS.md / Directives Path</label>
      <input id="cfg-agents-path" class="config-input" type="text" placeholder="~/.config/poolside/AGENTS.md (auto-detected if blank)" />
      <span style="font-size: 10px; opacity: 0.65;">Root AGENTS.md &amp; ARCANA breadcrumbs. Auto-detects ~/.config/poolside/AGENTS.md if empty.</span>
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
      <label class="config-label">Max Tool Execution Turns</label>
      <input id="cfg-max-turns" class="config-input" type="number" min="1" max="100" step="5" value="25" />
      <span style="font-size: 10px; opacity: 0.65;">Default: 25 turns (maximum consecutive tool steps before pausing).</span>
    </div>
    <div class="config-field">
      <label class="config-label">Command Execution Policy</label>
      <select id="cfg-cmd-mode" class="config-input">
        <option value="prompt">Ask Before Running (Prompt)</option>
        <option value="auto">Always Allow (Autonomous)</option>
        <option value="deny">Disabled (Block Shell)</option>
      </select>
    </div>
    <div class="config-field" style="display: flex; align-items: center; justify-content: space-between; margin-top: 8px;">
      <div>
        <label class="config-label" style="margin-bottom: 0;">⚡ Autonomous Auto-Continue</label>
        <span style="font-size: 10px; opacity: 0.65; display: block;">Execute multi-step tool calls without stopping for approval.</span>
      </div>
      <input id="cfg-auto-continue" type="checkbox" style="cursor: pointer; width: 18px; height: 18px; accent-color: var(--accent);" />
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
      <button id="add-editor-btn" class="context-chip" type="button" data-tag="@editor" data-tooltip-title="📄 @editor" data-tooltip-desc="Injects the entire contents of your active editor file into the prompt.">📄 @editor</button>
      <button id="add-selection-btn" class="context-chip" type="button" data-tag="@selection" data-tooltip-title="✂️ @selection" data-tooltip-desc="Injects your highlighted lines of code (or current line) into the prompt.">✂️ @selection</button>
      <button id="add-terminal-btn" class="context-chip" type="button" data-tag="@terminal" data-tooltip-title="📟 @terminal" data-tooltip-desc="Injects recent terminal console output (or selected terminal text) into the prompt.">📟 @terminal</button>
      <button id="add-problems-btn" class="context-chip" type="button" data-tag="@problems" data-tooltip-title="⚠️ @problems" data-tooltip-desc="Injects active compiler errors, linter diagnostics, and TypeScript issues into the prompt.">⚠️ @problems</button>
      <button id="auto-continue-toggle-btn" class="context-chip auto-continue-toggle" type="button" data-tooltip-title="⚡ Auto-Continue: OFF" data-tooltip-desc="Toggle autonomous multi-step execution without waiting for manual confirmation per tool.">
        <span id="auto-continue-icon">⚡</span> <span id="auto-continue-label">Auto-Continue: OFF</span>
      </button>
    </div>
    <div id="context-tooltip" class="context-tooltip-popover">
      <div id="tooltip-title" class="tooltip-title"></div>
      <div id="tooltip-desc" class="tooltip-desc"></div>
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

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
