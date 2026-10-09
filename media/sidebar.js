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
  const cfgMaxTurns = document.getElementById('cfg-max-turns');
  const cfgCmdMode = document.getElementById('cfg-cmd-mode');
  const cfgAutoContinue = document.getElementById('cfg-auto-continue');
  const autoContinueToggleBtn = document.getElementById('auto-continue-toggle-btn');
  const autoContinueLabel = document.getElementById('auto-continue-label');
  const cfgAgentsPath = document.getElementById('cfg-agents-path');
  const cfgSaveBtn = document.getElementById('cfg-save-btn');
  const cfgTestBtn = document.getElementById('cfg-test-btn');
  const cfgStatus = document.getElementById('cfg-status');

  const statusLabel = document.getElementById('status-label');
  const subStatus = document.getElementById('sub-status');
  const statusDot = document.getElementById('status-dot');
  const autocompleteMenu = document.getElementById('autocomplete-menu');

  let isAutoContinueEnabled = false;

  function updateAutoContinueUI(isEnabled) {
    isAutoContinueEnabled = Boolean(isEnabled);
    if (cfgAutoContinue) {
      cfgAutoContinue.checked = isAutoContinueEnabled;
    }
    if (autoContinueToggleBtn && autoContinueLabel) {
      if (isAutoContinueEnabled) {
        autoContinueToggleBtn.classList.add('active');
        autoContinueLabel.textContent = 'Auto-Continue: ON';
        autoContinueToggleBtn.setAttribute('data-tooltip-title', '⚡ Auto-Continue: ON');
        autoContinueToggleBtn.setAttribute('data-tooltip-desc', 'Autonomous loop active: executes multi-turn tool steps without waiting for confirmation.');
      } else {
        autoContinueToggleBtn.classList.remove('active');
        autoContinueLabel.textContent = 'Auto-Continue: OFF';
        autoContinueToggleBtn.setAttribute('data-tooltip-title', '⚡ Auto-Continue: OFF');
        autoContinueToggleBtn.setAttribute('data-tooltip-desc', 'Click to toggle autonomous mode (Default: OFF - wait for human approval between steps).');
      }
    }
  }

  function dispatchAutoContinueConfig(nextState) {
    updateAutoContinueUI(nextState);

    const baseUrl = cfgBaseUrl ? cfgBaseUrl.value.trim() : '';
    const apiKey = cfgApiKey ? cfgApiKey.value.trim() : '';
    const model = typeof getEffectiveModel === 'function' ? getEffectiveModel() : '';
    const commandMode = cfgCmdMode ? cfgCmdMode.value : 'prompt';
    const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
    const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;
    const maxTurns = cfgMaxTurns ? (parseInt(cfgMaxTurns.value, 10) || 25) : 25;
    const customAgentsMdPath = cfgAgentsPath ? cfgAgentsPath.value.trim() : '';

    vscode.postMessage({
      type: 'saveConfig',
      config: {
        baseUrl: baseUrl,
        apiKey: apiKey,
        model: model,
        commandMode: commandMode,
        temperature: temperature,
        maxTokens: maxTokens,
        maxTurns: maxTurns,
        autoContinue: nextState,
        customAgentsMdPath: customAgentsMdPath
      }
    });
  }

  if (autoContinueToggleBtn) {
    autoContinueToggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      dispatchAutoContinueConfig(!isAutoContinueEnabled);
    });
  }

  if (cfgAutoContinue) {
    cfgAutoContinue.addEventListener('change', function() {
      dispatchAutoContinueConfig(cfgAutoContinue.checked);
    });
  }

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

  function updateTokenMeter(used, max, model) {
    const u = Number(used) || 0;
    const m = Number(max) || 128000;
    const percent = m > 0 ? Math.min(100, Math.round((u / m) * 100)) : 0;
    const label = document.getElementById('token-meter-label');
    const fill = document.getElementById('context-meter-fill');
    const badge = document.getElementById('token-model-badge');

    const formatK = function(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return String(n);
    };

    if (label) {
      label.textContent = '🧠 Context: ' + formatK(u) + ' / ' + formatK(m) + ' (' + percent + '%)';
    }
    if (badge && model) {
      badge.textContent = model;
      badge.title = 'Model: ' + model + ' (' + m.toLocaleString() + ' max context window)';
    }
    if (fill) {
      fill.style.width = percent + '%';
      fill.classList.remove('warning', 'danger');
      if (percent >= 80) {
        fill.classList.add('danger');
      } else if (percent >= 50) {
        fill.classList.add('warning');
      }
    }
  }
  window.updateTokenMeter = updateTokenMeter;

  const contextTooltip = document.getElementById('context-tooltip');
  const tooltipTitle = document.getElementById('tooltip-title');
  const tooltipDesc = document.getElementById('tooltip-desc');
  const contextBar = document.querySelector('.context-bar');

  function hideContextTooltip() {
    if (contextTooltip) {
      contextTooltip.classList.remove('visible');
      contextTooltip.style.display = 'none';
    }
  }

  function showContextTooltip(chip) {
    if (!contextTooltip || !tooltipTitle || !tooltipDesc || !chip) return;
    const title = chip.getAttribute('data-tooltip-title');
    const desc = chip.getAttribute('data-tooltip-desc');
    if (!title && !desc) return;

    tooltipTitle.textContent = title || '';
    tooltipDesc.textContent = desc || '';
    contextTooltip.style.display = 'block';

    const chipRect = chip.getBoundingClientRect();
    const inputContainer = chip.closest('.input-container');
    if (inputContainer) {
      const containerRect = inputContainer.getBoundingClientRect();
      let leftPos = chipRect.left - containerRect.left;
      const tooltipWidth = contextTooltip.offsetWidth || 220;
      if (leftPos + tooltipWidth > containerRect.width - 12) {
        leftPos = Math.max(8, containerRect.width - tooltipWidth - 12);
      }
      contextTooltip.style.left = Math.max(8, leftPos) + 'px';
    }
    // Trigger smooth visual pop-in
    void contextTooltip.offsetHeight;
    contextTooltip.classList.add('visible');
  }

  if (contextBar) {
    contextBar.addEventListener('mouseover', function(e) {
      const chip = e.target && e.target.closest ? e.target.closest('.context-chip') : null;
      if (chip) {
        showContextTooltip(chip);
      }
    });

    contextBar.addEventListener('mouseout', function(e) {
      const chip = e.target && e.target.closest ? e.target.closest('.context-chip') : null;
      const related = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.context-chip') : null;
      if (chip && chip !== related) {
        hideContextTooltip();
      }
    });
  }

  document.addEventListener('click', function(e) {
    hideContextTooltip();
    const chip = e.target && e.target.closest ? e.target.closest('.context-chip') : null;
    if (chip && chip.id !== 'auto-continue-toggle-btn') {
      const tag = chip.getAttribute('data-tag') || (chip.id === 'add-editor-btn' ? '@editor' : chip.id === 'add-selection-btn' ? '@selection' : chip.id === 'add-terminal-btn' ? '@terminal' : chip.id === 'add-problems-btn' ? '@problems' : null);
      if (tag) {
        e.preventDefault();
        insertTag(tag);
      }
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
      if (cfgStatus) cfgStatus.textContent = 'Discovering models from /models...';
      vscode.postMessage({
        type: 'discoverModels',
        baseUrl: cfgBaseUrl ? cfgBaseUrl.value.trim() : '',
        apiKey: cfgApiKey ? cfgApiKey.value.trim() : ''
      });
    });
  }

  if (cfgTemperature) {
    cfgTemperature.addEventListener('input', function() {
      updateTempDisplay(cfgTemperature.value);
    });
  }

  function scrollToBottom() {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  function autoResizeTextarea() {
    if (!promptInput) return;
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
  }

  if (configBtn && configPanel) {
    configBtn.addEventListener('click', function() {
      configPanel.classList.toggle('open');
      if (configPanel.classList.contains('open')) {
        vscode.postMessage({ type: 'getConfig' });
      }
    });
  }

  if (cfgSaveBtn) {
    cfgSaveBtn.addEventListener('click', function() {
      const baseUrl = cfgBaseUrl ? cfgBaseUrl.value.trim() : '';
      const apiKey = cfgApiKey ? cfgApiKey.value.trim() : '';
      const model = getEffectiveModel();
      const commandMode = cfgCmdMode ? cfgCmdMode.value : 'prompt';
      const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
      const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;
      const maxTurns = cfgMaxTurns ? (parseInt(cfgMaxTurns.value, 10) || 25) : 25;
      const autoContinue = cfgAutoContinue ? cfgAutoContinue.checked : isAutoContinueEnabled;
      const customAgentsMdPath = cfgAgentsPath ? cfgAgentsPath.value.trim() : '';

      if (cfgStatus) cfgStatus.textContent = 'Saving...';
      vscode.postMessage({
        type: 'saveConfig',
        config: {
          baseUrl: baseUrl,
          apiKey: apiKey,
          model: model,
          commandMode: commandMode,
          temperature: temperature,
          maxTokens: maxTokens,
          maxTurns: maxTurns,
          autoContinue: autoContinue,
          customAgentsMdPath: customAgentsMdPath
        }
      });
    });
  }

  if (cfgTestBtn) {
    cfgTestBtn.addEventListener('click', function() {
      if (cfgStatus) cfgStatus.textContent = 'Probing connection...';
      const model = getEffectiveModel();
      const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
      const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;
      const maxTurns = cfgMaxTurns ? (parseInt(cfgMaxTurns.value, 10) || 25) : 25;

      vscode.postMessage({
        type: 'testConnection',
        config: {
          baseUrl: cfgBaseUrl ? cfgBaseUrl.value.trim() : '',
          apiKey: cfgApiKey ? cfgApiKey.value.trim() : '',
          model: model,
          commandMode: cfgCmdMode ? cfgCmdMode.value : 'prompt',
          temperature: temperature,
          maxTokens: maxTokens,
          maxTurns: maxTurns
        }
      });
    });
  }

  if (skillsBtn) {
    skillsBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'pickSkill' });
    });
  }

  if (promptInput) {
    promptInput.addEventListener('input', function() {
      autoResizeTextarea();
      checkAutocomplete();
    });
  }

  const contextMentions = [
    { id: 'editor', name: 'Active Editor File', description: 'Injects entire active file into prompt', source: 'context', triggerChar: '@' },
    { id: 'selection', name: 'Code Selection', description: 'Injects highlighted code snippet or line', source: 'context', triggerChar: '@' },
    { id: 'terminal', name: 'Terminal Output', description: 'Injects active terminal logs or selection', source: 'context', triggerChar: '@' },
    { id: 'problems', name: 'Linter & Compiler Problems', description: 'Injects active compiler & lint diagnostics', source: 'context', triggerChar: '@' }
  ];

  let autocompleteItems = [];
  let activeTriggerChar = '/';

  function checkAutocomplete() {
    if (!promptInput) return;
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
    if (!autocompleteMenu) return;
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
    if (autocompleteMenu) {
      autocompleteMenu.classList.remove('visible');
    }
    selectedIndex = 0;
  }

  function selectAutocompleteItem(itemData) {
    if (!promptInput) return;
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

  if (promptInput) {
    promptInput.addEventListener('keydown', function(e) {
      if (autocompleteMenu && autocompleteMenu.classList.contains('visible')) {
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
  }

  function updateSelectedAutocomplete() {
    if (!autocompleteMenu) return;
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

  if (sendBtn) {
    sendBtn.addEventListener('click', triggerSend);
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'abort' });
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'clear' });
    });
  }

  if (historyBtn && historyPanel) {
    historyBtn.addEventListener('click', function() {
      historyPanel.classList.toggle('open');
      if (historyPanel.classList.contains('open')) {
        vscode.postMessage({ type: 'getThreads' });
      }
    });
  }

  if (newChatBtn && historyPanel) {
    newChatBtn.addEventListener('click', function() {
      historyPanel.classList.remove('open');
      vscode.postMessage({ type: 'newThread' });
    });
  }

  if (drawerNewBtn && historyPanel) {
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
    if (!threadsList) return;
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
        if (historyPanel) historyPanel.classList.remove('open');
        vscode.postMessage({ type: 'switchThread', threadId: t.id });
      });

      threadsList.appendChild(item);
    });
  }

  function renderHistoryMessages(thread) {
    if (!chatContainer) return;
    chatContainer.innerHTML = '';
    const messages = (thread && thread.messages) ? thread.messages : [];
    const nonSystem = messages.filter(function(m) { return m.role !== 'system'; });

    if (nonSystem.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'message assistant';
      welcome.innerHTML = '<div class="message-text">Hello! I am M.I.K.E., your autonomous coding assistant. How can I help you today?</div>';
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
        let skillName = '';
        const skillStart = content.indexOf('[SPECIALIZED SKILL ACTIVATED: ');
        if (skillStart !== -1) {
          const skillEnd = content.indexOf(']', skillStart);
          if (skillEnd !== -1) {
            skillName = content.slice(skillStart + 30, skillEnd).trim();
            const afterBlock = content.slice(skillEnd + 1).replace(/^\n+/, '');
            content = content.slice(0, skillStart) + afterBlock;
          }
        }
        if (skillName) {
          const skillBadge = document.createElement('div');
          skillBadge.className = 'skill-badge';
          skillBadge.innerHTML = '⚡ Skill: ' + escapeHtml(skillName);
          userMsg.appendChild(skillBadge);
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
                details.textContent += '\nResult:\n' + toolResults[tc.id];
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
    if (!promptInput) return;
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

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'tool-actions';

    const killBtn = document.createElement('button');
    killBtn.className = 'tool-kill-btn';
    killBtn.title = 'Kill / Cancel this process';
    killBtn.innerHTML = '🗑️ Kill';
    killBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      killBtn.disabled = true;
      killBtn.textContent = 'Killing...';
      badge.classList.add('cancelling');
      vscode.postMessage({ type: 'killRunningTool', toolId: id, name: name });
    });

    const toggle = document.createElement('span');
    toggle.innerText = '▼';
    toggle.style.fontSize = '9px';

    actionsContainer.appendChild(killBtn);
    actionsContainer.appendChild(toggle);

    header.appendChild(title);
    header.appendChild(actionsContainer);

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
      case 'tokenUpdate': {
        updateTokenMeter(msg.usedTokens, msg.maxTokens, msg.model);
        break;
      }
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
          if (cfgStatus) {
            cfgStatus.textContent = '✔ Found ' + msg.models.length + ' models (selected ' + selected + ')';
            setTimeout(function() { if (cfgStatus) cfgStatus.textContent = ''; }, 4000);
          }
        } else {
          if (cfgStatus) {
            cfgStatus.textContent = 'No models endpoint found';
            setTimeout(function() { if (cfgStatus) cfgStatus.textContent = ''; }, 3000);
          }
        }
        break;
      }
      case 'configLoaded': {
        if (msg.config) {
          if (cfgBaseUrl) cfgBaseUrl.value = msg.config.baseUrl || '';
          const currentModel = msg.config.model || '';
          if (currentModel) {
            renderModelOptions(null, currentModel, false);
          }

          if (cfgApiKey && msg.config.apiKey) {
            cfgApiKey.value = msg.config.apiKey;
          }
          if (cfgCmdMode && msg.config.commandMode) {
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
          if (msg.config.maxTurns !== undefined) {
            if (cfgMaxTurns) {
              cfgMaxTurns.value = msg.config.maxTurns;
            }
          } else {
            if (cfgMaxTurns) {
              cfgMaxTurns.value = 25;
            }
          }
          if (msg.config.autoContinue !== undefined) {
            updateAutoContinueUI(Boolean(msg.config.autoContinue));
          } else {
            updateAutoContinueUI(false);
          }
          if (cfgAgentsPath) {
            cfgAgentsPath.value = msg.config.customAgentsMdPath || '';
          }
        }
        break;
      }
      case 'configSaved': {
        if (cfgStatus) {
          if (msg.success) {
            cfgStatus.textContent = '✓ Saved';
            setTimeout(function() { if (cfgStatus) cfgStatus.textContent = ''; }, 3000);
          } else {
            cfgStatus.textContent = 'Error: ' + (msg.error || 'Failed to save');
          }
        }
        break;
      }
      case 'testResult': {
        if (msg.result && msg.result.success) {
          if (cfgStatus) cfgStatus.textContent = '✔ Connected (HTTP 200)';
          if (msg.result.discoveredModels && msg.result.discoveredModels.length > 0) {
            const selected = (cfgModel && msg.result.discoveredModels.indexOf(cfgModel.value.trim()) !== -1)
              ? cfgModel.value.trim()
              : msg.result.discoveredModels[0];
            renderModelOptions(msg.result.discoveredModels, selected, true);
          }
          if (msg.result.workingEndpoint) {
            if (cfgBaseUrl) cfgBaseUrl.value = msg.result.workingEndpoint;
            const model = getEffectiveModel();
            const temperature = cfgTemperature ? parseFloat(cfgTemperature.value) : 0.0;
            const maxTokens = cfgMaxTokens ? (parseInt(cfgMaxTokens.value, 10) || 8192) : 8192;

            vscode.postMessage({
              type: 'saveConfig',
              config: {
                baseUrl: msg.result.workingEndpoint,
                apiKey: cfgApiKey ? cfgApiKey.value.trim() : '',
                model: model,
                commandMode: cfgCmdMode ? cfgCmdMode.value : 'prompt',
                temperature: temperature,
                maxTokens: maxTokens
              }
            });
          }
        } else {
          const errSnippet = (msg.result && msg.result.details) ? msg.result.details.split('\n')[0] : 'Connection refused / unreachable';
          if (cfgStatus) cfgStatus.textContent = '✖ ' + errSnippet;
        }
        break;
      }
      case 'insertText': {
        if (promptInput) {
          const currentVal = promptInput.value;
          if (currentVal && currentVal.trim()) {
            promptInput.value = currentVal + (currentVal.endsWith(String.fromCharCode(10)) ? '' : String.fromCharCode(10)) + msg.text;
          } else {
            promptInput.value = msg.text;
          }
          promptInput.focus();
          autoResizeTextarea();
        }
        break;
      }
      case 'insertTag': {
        if (promptInput) {
          const val = promptInput.value;
          if (!val.includes(msg.tag.trim())) {
            promptInput.value = val ? val + ' ' + msg.tag : msg.tag;
          }
          promptInput.focus();
          autoResizeTextarea();
        }
        break;
      }
      case 'appendUserMessage': {
        if (!chatContainer) return;
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
        if (!chatContainer) return;
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
            details.textContent += '\nResult:\n' + msg.result;
          }
        }
        break;
      }
      case 'streamError': {
        if (chatContainer) {
          const errorEl = document.createElement('div');
          errorEl.className = 'error-banner';
          errorEl.textContent = 'Error: ' + msg.error;
          chatContainer.appendChild(errorEl);
          scrollToBottom();
        }
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
          if (sendBtn) sendBtn.disabled = true;
          if (stopBtn) stopBtn.style.display = 'inline-block';
          if (promptInput) {
            promptInput.classList.add('generating');
            promptInput.placeholder = '⏳ M.I.K.E. is busy generating & executing... (Click Stop to cancel)';
          }

          if (statusPill) {
            statusPill.className = 'status-pill running';
          }
          if (statusDot) {
            statusDot.className = 'status-dot running';
          }
          if (statusLabel) statusLabel.textContent = 'BUSY / RUNNING';

          if (activityScanner) {
            activityScanner.classList.add('running');
          }
          if (subStatusContainer) {
            subStatusContainer.className = 'status-indicator-bar running';
          }
          if (spinnerIcon) {
            spinnerIcon.className = 'spinner-icon running';
          }
          if (subStatus) subStatus.textContent = '🔴 Working...';

          if (liveWorkingIndicator) {
            liveWorkingIndicator.style.display = 'inline-flex';
            if (liveWorkingText) liveWorkingText.textContent = 'Thinking & executing...';
          }
        } else {
          if (sendBtn) sendBtn.disabled = false;
          if (stopBtn) stopBtn.style.display = 'none';
          if (promptInput) {
            promptInput.classList.remove('generating');
            promptInput.placeholder = 'Ask M.I.K.E. or type / for direct skills... (Enter to send, Shift+Enter for newline)';
          }

          if (statusPill) {
            statusPill.className = 'status-pill ready';
          }
          if (statusDot) {
            statusDot.className = 'status-dot';
          }
          if (statusLabel) statusLabel.textContent = 'READY';

          if (activityScanner) {
            activityScanner.classList.remove('running');
          }
          if (subStatusContainer) {
            subStatusContainer.className = 'status-indicator-bar ready';
          }
          if (spinnerIcon) {
            spinnerIcon.className = 'spinner-icon';
          }
          if (subStatus) subStatus.textContent = '🟢 Waiting for your input';

          if (liveWorkingIndicator) {
            liveWorkingIndicator.style.display = 'none';
          }
        }
        break;
      }
      case 'statusUpdate': {
        const isBusy = (msg.status && msg.status.toLowerCase() !== 'ready');
        if (isBusy) {
          if (statusLabel) statusLabel.textContent = msg.status.toUpperCase();
          if (subStatus) subStatus.textContent = '🔴 ' + msg.status;
          const liveWorkingText = document.getElementById('live-working-text');
          if (liveWorkingText) {
            liveWorkingText.textContent = msg.status;
          }
        } else {
          if (statusLabel) statusLabel.textContent = 'READY';
          if (subStatus) subStatus.textContent = '🟢 Waiting for your input';
        }
        break;
      }
      case 'checkpointsUpdated': {
        renderCheckpoints(msg.files);
        break;
      }
      case 'cleared': {
        if (chatContainer) {
          chatContainer.innerHTML = '';
          const welcome = document.createElement('div');
          welcome.className = 'message assistant';
          welcome.innerHTML = '<div class="message-text">Conversation cleared. Ready for your next request!</div>';
          chatContainer.appendChild(welcome);
          renderCheckpoints([]);
        }
        break;
      }
    }
  });

  if (btnRejectAll) {
    btnRejectAll.addEventListener('click', function() {
      vscode.postMessage({ type: 'revertAll' });
    });
  }

  if (btnAcceptAll) {
    btnAcceptAll.addEventListener('click', function() {
      vscode.postMessage({ type: 'acceptCheckpoints' });
    });
  }

  function renderCheckpoints(files) {
    if (!sessionChangesBar || !sessionChangesList || !sessionChangesTitle) return;
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
