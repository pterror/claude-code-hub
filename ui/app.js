// @ts-check
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

/**
 * @fileoverview Claude Code Hub UI Application
 *
 * Main client-side application for the Claude Code Hub.
 * Provides agent management, session tabs, and real-time updates.
 */

'use strict';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {Object} AgentCapabilities
 * @property {boolean} canDiscover
 * @property {string[]} canRead
 * @property {string[]} canMessage
 * @property {boolean} canSpawn
 * @property {string[]} canBeMessaged
 */

/**
 * @typedef {Object} AgentMessage
 * @property {'assistant' | 'tool' | 'result' | 'error'} type
 * @property {string} content
 * @property {Date} [timestamp]
 * @property {unknown} [input]
 * @property {string} [result]
 */

/**
 * @typedef {Object} Agent
 * @property {string} id
 * @property {string} cwd
 * @property {string} prompt
 * @property {'running' | 'done' | 'error' | 'waiting'} status
 * @property {AgentMessage[]} messages
 * @property {Date} createdAt
 * @property {string} [sessionId]
 * @property {AgentCapabilities} capabilities
 * @property {number} [tokens]
 * @property {number} [costUsd]
 * @property {'hub' | 'discovered'} source
 * @property {string} [firstMessage]
 */

/**
 * @typedef {Object} QueueEntry
 * @property {string} id
 * @property {string} message
 * @property {'queued' | 'sending'} status
 */

/**
 * @typedef {Object} TabInfo
 * @property {Agent} agent
 * @property {HTMLElement} element
 * @property {HTMLElement} viewElement
 */

// ============================================================================
// Configuration
// ============================================================================

const API = window.location.origin;
const PAGE_SIZE = 50;

// ============================================================================
// Global State
// ============================================================================

/** @type {Agent[]} */
let agents = [];

/** @type {string} */
let filterText = '';

/** @type {'all' | 'hub' | 'discovered'} */
let sourceFilter = 'all';

/** @type {'running' | 'done' | null} */
let statusFilter = null;

/** @type {Map<string, HTMLElement>} */
const agentElements = new Map();

/** @type {boolean} */
let hasMore = false;

/** @type {boolean} */
let loading = false;

/** @type {number} */
let currentOffset = 0;

/** @type {Map<string, TabInfo>} */
const openTabs = new Map();

/** @type {string | null} */
let activeTabId = null;

/** @type {Map<string, QueueEntry[]>} */
const messageQueues = new Map();

/** @type {Set<string>} */
const processingQueue = new Set();

/** @type {Set<string>} */
const expandedAgents = new Set();

/** @type {number} */
let wsBackoff = 1000;

/** @type {boolean} */
let wsConnected = false;

/** @type {ServiceWorkerRegistration | null} */
let swRegistration = null;

// ============================================================================
// Marked + Highlight.js Configuration
// ============================================================================

// @ts-ignore - marked is loaded externally
if (typeof marked !== 'undefined' && typeof hljs !== 'undefined') {
  // @ts-ignore
  marked.setOptions({
    /**
     * @param {string} code
     * @param {string} lang
     * @returns {string}
     */
    highlight: function(code, lang) {
      // @ts-ignore
      if (lang && hljs.getLanguage(lang)) {
        // @ts-ignore
        return hljs.highlight(code, { language: lang }).value;
      }
      // @ts-ignore
      return hljs.highlightAuto(code).value;
    },
    breaks: true,
    gfm: true,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML string
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Generates a unique queue ID
 * @returns {string}
 */
function generateQueueId() {
  return 'q-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Converts a base64 URL-safe string to Uint8Array (for Push API)
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

// ============================================================================
// Tool Type Detection & Rendering
// ============================================================================

/**
 * @param {string | undefined} toolName
 * @returns {string}
 */
function getToolType(toolName) {
  if (!toolName) return 'unknown';
  const name = toolName.toLowerCase();
  if (name === 'read') return 'read';
  if (name === 'write') return 'write';
  if (name === 'edit') return 'edit';
  if (name === 'bash') return 'bash';
  if (name === 'glob') return 'glob';
  if (name === 'grep') return 'grep';
  if (name.includes('web') || name.includes('fetch')) return 'web';
  if (name === 'task') return 'task';
  if (name === 'todowrite') return 'todo';
  return 'unknown';
}

/**
 * @param {string} toolType
 * @returns {string}
 */
function getToolClass(toolType) {
  /** @type {Record<string, string>} */
  const classes = {
    read: 'tool-read',
    write: 'tool-write',
    edit: 'tool-write',
    bash: 'tool-bash',
    glob: 'tool-grep',
    grep: 'tool-grep',
    web: 'tool-web',
    task: 'tool-task',
  };
  return classes[toolType] || '';
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderReadTool(input, result) {
  const inp = /** @type {{file_path?: string}} */ (input);
  const filePath = inp?.file_path || 'unknown';
  const content = result || '';

  return `
    <div class="file-viewer">
      <div class="file-viewer-header">${escapeHtml(filePath)}</div>
      <div class="file-viewer-content">${escapeHtml(content.slice(0, 5000))}${content.length > 5000 ? '\n...(truncated)' : ''}</div>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderEditTool(input, result) {
  const inp = /** @type {{file_path?: string, old_string?: string, new_string?: string}} */ (input);
  const filePath = inp?.file_path || 'unknown';
  const oldStr = inp?.old_string || '';
  const newStr = inp?.new_string || '';

  return `
    <div class="diff-view">
      <div class="diff-header">${escapeHtml(filePath)}</div>
      <div class="diff-old diff-content">- ${escapeHtml(oldStr)}</div>
      <div class="diff-new diff-content">+ ${escapeHtml(newStr)}</div>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderWriteTool(input, result) {
  const inp = /** @type {{file_path?: string, content?: string}} */ (input);
  const filePath = inp?.file_path || 'unknown';
  const content = inp?.content || '';

  return `
    <div class="file-viewer">
      <div class="file-viewer-header">Writing: ${escapeHtml(filePath)}</div>
      <div class="file-viewer-content">${escapeHtml(content.slice(0, 3000))}${content.length > 3000 ? '\n...(truncated)' : ''}</div>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderBashTool(input, result) {
  const inp = /** @type {{command?: string, description?: string}} */ (input);
  const cmd = inp?.command || '';
  const output = result || '';
  const isError = output.includes('error:') || output.includes('Error:');

  return `
    <div class="terminal">
      <div class="terminal-header">
        <span class="terminal-prompt">$</span>
        <span class="terminal-cmd">${escapeHtml(cmd)}</span>
      </div>
      <div class="terminal-output ${isError ? 'terminal-error' : ''}">${escapeHtml(output.slice(0, 3000))}${output.length > 3000 ? '\n...(truncated)' : ''}</div>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderGlobTool(input, result) {
  const inp = /** @type {{pattern?: string, path?: string}} */ (input);
  const pattern = inp?.pattern || '';
  const path = inp?.path || '';
  const files = (result || '').split('\n').filter(f => f.trim());

  if (files.length === 0) {
    return `<div class="tool-meta">Pattern: ${escapeHtml(pattern)} ${path ? `in ${escapeHtml(path)}` : ''}</div><div class="file-list"><div class="file-list-item">(no matches)</div></div>`;
  }

  const shown = files.slice(0, 50);
  return `
    <div class="tool-meta">Pattern: ${escapeHtml(pattern)} ${path ? `in ${escapeHtml(path)}` : ''} (${files.length} files)</div>
    <div class="file-list">
      ${shown.map(f => `<div class="file-list-item">${escapeHtml(f)}</div>`).join('')}
      ${files.length > 50 ? `<div class="file-list-item" style="color: var(--fg-muted);">...and ${files.length - 50} more</div>` : ''}
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderGrepTool(input, result) {
  const inp = /** @type {{pattern?: string}} */ (input);
  const pattern = inp?.pattern || '';
  const content = result || '';
  const lines = content.split('\n').filter(l => l.trim()).slice(0, 30);

  return `
    <div class="tool-meta">Pattern: ${escapeHtml(pattern)}</div>
    <div class="file-list">
      ${lines.map(l => `<div class="grep-line">${escapeHtml(l)}</div>`).join('')}
      ${content.split('\n').length > 30 ? `<div style="color: var(--fg-muted);">...(more results)</div>` : ''}
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderWebTool(input, result) {
  const inp = /** @type {{url?: string, prompt?: string}} */ (input);
  const url = inp?.url || '';
  const content = result || '';

  return `
    <div class="web-result">
      <div class="web-url">${escapeHtml(url)}</div>
      <div class="web-content">${escapeHtml(content.slice(0, 1500))}${content.length > 1500 ? '...' : ''}</div>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderTaskTool(input, result) {
  const inp = /** @type {{subagent_type?: string, prompt?: string}} */ (input);
  const subagentType = inp?.subagent_type || 'unknown';
  const prompt = inp?.prompt || '';
  const taskResult = result || '';

  return `
    <div class="task-info">
      <div class="task-type">${escapeHtml(subagentType)} agent</div>
      <div class="task-prompt">${escapeHtml(prompt.slice(0, 200))}${prompt.length > 200 ? '...' : ''}</div>
      ${taskResult ? `<div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--fg-muted);">${escapeHtml(taskResult.slice(0, 500))}</div>` : ''}
    </div>`;
}

/**
 * @param {string} toolName
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderGenericTool(toolName, input, result) {
  const details = input ? JSON.stringify(input, null, 2) : '';
  const resultStr = result ? (typeof result === 'string' ? result : JSON.stringify(result, null, 2)) : '';

  return `
    <div style="font-size: 0.75rem;">
      ${details ? `<div><strong>Input:</strong><pre style="margin: 0.25rem 0;">${escapeHtml(details)}</pre></div>` : ''}
      ${resultStr ? `<div><strong>Result:</strong><pre style="margin: 0.25rem 0;">${escapeHtml(resultStr.slice(0, 2000))}${resultStr.length > 2000 ? '...' : ''}</pre></div>` : ''}
    </div>`;
}

// ============================================================================
// Message Formatting
// ============================================================================

/**
 * Formats agent messages for display with dedicated tool UIs
 * @param {AgentMessage[] | undefined} messages
 * @returns {string}
 */
function formatMessages(messages) {
  if (!messages || messages.length === 0) return '<div class="empty">No messages yet</div>';

  return messages.map((m, i) => {
    if (m.type === 'tool') {
      const toolName = m.content.replace('Tool: ', '');
      const toolType = getToolType(toolName);
      const toolClass = getToolClass(toolType);

      let toolContent;
      switch (toolType) {
        case 'read':
          toolContent = renderReadTool(m.input, m.result);
          break;
        case 'edit':
          toolContent = renderEditTool(m.input, m.result);
          break;
        case 'write':
          toolContent = renderWriteTool(m.input, m.result);
          break;
        case 'bash':
          toolContent = renderBashTool(m.input, m.result);
          break;
        case 'glob':
          toolContent = renderGlobTool(m.input, m.result);
          break;
        case 'grep':
          toolContent = renderGrepTool(m.input, m.result);
          break;
        case 'web':
          toolContent = renderWebTool(m.input, m.result);
          break;
        case 'task':
          toolContent = renderTaskTool(m.input, m.result);
          break;
        default:
          toolContent = renderGenericTool(toolName, m.input, m.result);
      }

      return `<div class="message message-tool ${toolClass}" data-idx="${i}">
        <div class="tool-header">
          <span class="tool-name">${escapeHtml(toolName)}</span>
          <span class="tool-toggle">\u25B2</span>
        </div>
        <div class="tool-content">${toolContent}</div>
      </div>`;
    } else if (m.content.startsWith('[User]:')) {
      return `<div class="message message-user">${escapeHtml(m.content.slice(7).trim())}</div>`;
    } else {
      // Render markdown for assistant messages
      // @ts-ignore - marked is loaded externally
      const html = typeof marked !== 'undefined' ? marked.parse(m.content) : escapeHtml(m.content);
      return `<div class="message message-assistant">${html}</div>`;
    }
  }).join('');
}

// ============================================================================
// Session Tab Management
// ============================================================================

/**
 * Opens a session in a new tab or activates existing
 * @param {Agent} agent
 */
function openSessionTab(agent) {
  if (openTabs.has(agent.id)) {
    activateTab(agent.id);
    return;
  }

  // Create tab
  const tab = document.createElement('div');
  tab.className = 'session-tab';
  tab.dataset.id = agent.id;
  const folderName = agent.cwd.split('/').pop() || agent.cwd;
  const summary = agent.prompt || agent.firstMessage || '';
  tab.innerHTML = `
    <div class="tab-info">
      <span class="tab-folder">${escapeHtml(folderName)}</span>
      <span class="tab-summary">${escapeHtml(summary.slice(0, 40))}${summary.length > 40 ? '...' : ''}</span>
    </div>
    <span class="close-tab">\u00D7</span>
  `;
  const tabsContainer = document.getElementById('session-tabs');
  if (tabsContainer) tabsContainer.appendChild(tab);

  // Create session view
  const view = document.createElement('div');
  view.className = 'session-view';
  view.dataset.id = agent.id;
  view.innerHTML = `
    <div class="session-messages" id="messages-${agent.id}">
      ${formatMessages(agent.messages)}
    </div>
    <div class="session-input">
      <input type="text" placeholder="Send a message..." id="input-${agent.id}">
      <button type="button" onclick="sendMessage('${agent.id}')">Send</button>
    </div>
  `;
  const viewsContainer = document.getElementById('session-views');
  if (viewsContainer) viewsContainer.appendChild(view);

  // Add enter key handler
  const inputEl = view.querySelector('input');
  if (inputEl) {
    inputEl.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendMessage(agent.id);
    });
  }

  openTabs.set(agent.id, { agent, element: tab, viewElement: view });
  activateTab(agent.id);

  // Lazy load messages if needed
  if (!agent.messages || agent.messages.length === 0) {
    loadSessionMessages(agent.id);
  }
}

/**
 * Loads messages for a session from the API
 * @param {string} id
 */
async function loadSessionMessages(id) {
  const messagesEl = document.getElementById(`messages-${id}`);
  if (!messagesEl) return;

  messagesEl.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const res = await fetch(`${API}/agents/${id}`);
    if (res.ok) {
      const data = await res.json();
      const agent = agents.find(a => a.id === id);
      if (agent) {
        agent.messages = data.messages || [];
      }
      const tab = openTabs.get(id);
      if (tab) {
        tab.agent.messages = data.messages || [];
      }
      messagesEl.innerHTML = formatMessages(data.messages);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } catch {
    messagesEl.innerHTML = '<div class="empty">Failed to load messages</div>';
  }
}

/**
 * Activates a tab by ID
 * @param {string} id
 */
function activateTab(id) {
  // Deactivate current
  if (activeTabId && openTabs.has(activeTabId)) {
    const current = openTabs.get(activeTabId);
    if (current) {
      current.element.classList.remove('active');
      current.viewElement.classList.remove('active');
    }
  }

  // Hide no-session message
  const noSession = document.getElementById('no-session');
  if (noSession) noSession.style.display = 'none';

  // Activate new
  activeTabId = id;
  const tab = openTabs.get(id);
  if (tab) {
    tab.element.classList.add('active');
    tab.viewElement.classList.add('active');

    // Update sidebar selection
    agentElements.forEach((el, agentId) => {
      el.classList.toggle('selected', agentId === id);
    });
  }
}

/**
 * Closes a tab by ID
 * @param {string} id
 */
function closeTab(id) {
  const tab = openTabs.get(id);
  if (!tab) return;

  tab.element.remove();
  tab.viewElement.remove();
  openTabs.delete(id);

  // Clear sidebar selection
  const sidebarEl = agentElements.get(id);
  if (sidebarEl) sidebarEl.classList.remove('selected');

  // Activate another tab or show no-session
  if (activeTabId === id) {
    activeTabId = null;
    const remaining = Array.from(openTabs.keys());
    if (remaining.length > 0) {
      activateTab(remaining[remaining.length - 1]);
    } else {
      const noSession = document.getElementById('no-session');
      if (noSession) noSession.style.display = 'flex';
    }
  }
}

// ============================================================================
// Message Queue Management
// ============================================================================

/**
 * Sends a message to an agent (adds to queue)
 * @param {string} agentId
 */
async function sendMessage(agentId) {
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById(`input-${agentId}`));
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  input.value = '';

  // Add to queue
  if (!messageQueues.has(agentId)) messageQueues.set(agentId, []);
  /** @type {QueueEntry} */
  const queueEntry = { id: generateQueueId(), message, status: 'queued' };
  const queue = messageQueues.get(agentId);
  if (queue) queue.push(queueEntry);

  // Render queued message
  renderQueuedMessage(agentId, queueEntry);

  // Process queue
  processQueue(agentId);
}

// Expose to global for onclick handlers
// @ts-ignore
window.sendMessage = sendMessage;

/**
 * Renders a queued message in the UI
 * @param {string} agentId
 * @param {QueueEntry} entry
 */
function renderQueuedMessage(agentId, entry) {
  const messagesEl = document.getElementById(`messages-${agentId}`);
  if (!messagesEl) return;

  const div = document.createElement('div');
  div.className = `message message-${entry.status}`;
  div.id = `queue-${entry.id}`;
  div.dataset.queueId = entry.id;
  div.dataset.agentId = agentId;
  div.innerHTML = escapeHtml(entry.message);

  if (entry.status === 'queued') {
    div.onclick = () => unqueueMessage(agentId, entry.id);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Removes a message from the queue and puts it back in the input
 * @param {string} agentId
 * @param {string} queueId
 */
function unqueueMessage(agentId, queueId) {
  const queue = messageQueues.get(agentId);
  if (!queue) return;

  const idx = queue.findIndex(e => e.id === queueId);
  if (idx === -1) return;

  const entry = queue[idx];
  if (entry.status !== 'queued') return;

  // Remove from queue
  queue.splice(idx, 1);

  // Remove from UI
  const el = document.getElementById(`queue-${queueId}`);
  if (el) el.remove();

  // Put back in input
  const input = /** @type {HTMLInputElement | null} */ (document.getElementById(`input-${agentId}`));
  if (input) {
    input.value = entry.message;
    input.focus();
  }
}

/**
 * Processes the message queue for an agent
 * @param {string} agentId
 */
async function processQueue(agentId) {
  // Prevent concurrent processing for same agent
  if (processingQueue.has(agentId)) return;

  const queue = messageQueues.get(agentId);
  if (!queue || queue.length === 0) return;

  // Find first queued item
  const entry = queue.find(e => e.status === 'queued');
  if (!entry) return;

  processingQueue.add(agentId);
  entry.status = 'sending';

  // Update UI to show sending
  const el = document.getElementById(`queue-${entry.id}`);
  if (el) {
    el.className = 'message message-sending';
    el.onclick = null;
  }

  try {
    await fetch(`${API}/agents/${agentId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: entry.message }),
    });

    // Mark as sent, update UI
    if (el) {
      el.className = 'message message-user';
      el.removeAttribute('id');
    }

    // Remove from queue
    const idx = queue.indexOf(entry);
    if (idx !== -1) queue.splice(idx, 1);

  } catch (err) {
    console.error('Failed to send message:', err);
    // Revert to queued state on error
    entry.status = 'queued';
    if (el) {
      el.className = 'message message-queued';
      el.onclick = () => unqueueMessage(agentId, entry.id);
    }
  }

  processingQueue.delete(agentId);

  // Process next item if any
  if (queue.some(e => e.status === 'queued')) {
    processQueue(agentId);
  }
}

// ============================================================================
// Agent List Management
// ============================================================================

/**
 * Fetches agents from the API
 * @param {boolean} [append=false]
 */
async function fetchAgents(append = false) {
  if (loading) return;
  loading = true;

  const offset = append ? currentOffset : 0;
  const apiSource = (statusFilter && sourceFilter === 'all') ? 'all' : sourceFilter;
  const res = await fetch(`${API}/agents?source=${apiSource}&limit=${PAGE_SIZE}&offset=${offset}`);
  const data = await res.json();

  if (append) {
    agents = [...agents, ...(data.agents || [])];
  } else {
    agents = data.agents || [];
    agentElements.forEach(el => el.remove());
    agentElements.clear();
  }

  hasMore = data.hasMore || false;
  currentOffset = agents.length;
  loading = false;
  render();
}

/**
 * Spawns a new agent
 * @param {string} cwd
 * @param {string} prompt
 * @param {string} preset
 */
async function spawnAgent(cwd, prompt, preset) {
  await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd, prompt, preset }),
  });
}

/**
 * Gets the preset name from capabilities
 * @param {AgentCapabilities | undefined} caps
 * @returns {string}
 */
function getPresetName(caps) {
  if (!caps) return 'unknown';
  if (caps.canSpawn) return 'coordinator';
  if (caps.canMessage?.length > 0) return 'peer';
  if (caps.canDiscover) return 'observer';
  return 'isolated';
}

/**
 * Creates an agent element for the sidebar
 * @param {Agent} agent
 * @returns {HTMLElement}
 */
function createAgentElement(agent) {
  const el = document.createElement('div');
  el.className = 'agent';
  el.dataset.id = agent.id;

  el.innerHTML = `
    <div class="agent-header">
      <span class="agent-cwd"></span>
      <span class="badge badge-status"></span>
    </div>
    <div class="agent-prompt"></div>
  `;

  updateAgentElement(el, agent);
  return el;
}

/**
 * Updates an agent element with new data
 * @param {HTMLElement} el
 * @param {Agent} agent
 */
function updateAgentElement(el, agent) {
  el.classList.toggle('selected', activeTabId === agent.id);

  const cwdEl = el.querySelector('.agent-cwd');
  if (cwdEl) cwdEl.textContent = agent.cwd.split('/').pop() || agent.cwd;

  const promptEl = el.querySelector('.agent-prompt');
  if (promptEl) promptEl.textContent = agent.prompt.slice(0, 60) + (agent.prompt.length > 60 ? '...' : '');

  const statusBadge = el.querySelector('.badge-status');
  if (statusBadge) {
    statusBadge.textContent = agent.status;
    statusBadge.className = `badge badge-status status-${agent.status}`;
  }
}

/**
 * Renders the agent list
 */
function render() {
  const container = document.getElementById('agents');
  if (!container) return;

  const filtered = agents.filter(a => {
    if (statusFilter === 'running' && a.status !== 'running' && a.status !== 'waiting') return false;
    if (statusFilter === 'done' && a.status !== 'done' && a.status !== 'error') return false;
    if (filterText && !a.cwd.toLowerCase().includes(filterText) && !a.prompt.toLowerCase().includes(filterText)) return false;
    return true;
  });

  // Handle empty state
  if (filtered.length === 0) {
    agentElements.forEach(el => el.remove());
    agentElements.clear();
    if (!container.querySelector('.empty')) {
      container.innerHTML = agents.length === 0
        ? '<div class="empty">No agents running. Spawn one above.</div>'
        : '<div class="empty">No agents match filter.</div>';
    }
    return;
  }

  // Remove empty message if present
  const emptyEl = container.querySelector('.empty');
  if (emptyEl) emptyEl.remove();

  // Track which IDs are in filtered list
  const filteredIds = new Set(filtered.map(a => a.id));

  // Remove elements not in filtered list
  for (const [id, el] of agentElements) {
    if (!filteredIds.has(id)) {
      el.remove();
      agentElements.delete(id);
    }
  }

  // Update or create elements in order
  /** @type {HTMLElement | null} */
  let prevEl = null;
  for (const agent of filtered) {
    let el = agentElements.get(agent.id);

    if (el) {
      updateAgentElement(el, agent);
    } else {
      el = createAgentElement(agent);
      agentElements.set(agent.id, el);
    }

    // Ensure element is in DOM and in correct order
    const inDom = el.parentElement === container;
    const actualPrev = el.previousElementSibling;
    if (!inDom || actualPrev !== prevEl) {
      if (prevEl) {
        prevEl.after(el);
      } else {
        container.prepend(el);
      }
    }

    prevEl = el;
  }
}

// ============================================================================
// WebSocket Connection
// ============================================================================

/**
 * Updates the WebSocket status indicator
 * @param {boolean} connected
 */
function updateWsStatus(connected) {
  wsConnected = connected;
  const indicator = document.getElementById('ws-status');
  if (indicator) {
    indicator.classList.toggle('ws-connected', connected);
    indicator.classList.toggle('ws-disconnected', !connected);
    indicator.title = connected ? 'Connected' : 'Disconnected';
  }
}

/**
 * Connects to the WebSocket server
 */
function connectWS() {
  const ws = new WebSocket(`${API.replace('http', 'ws')}/ws`);

  ws.onopen = () => {
    wsBackoff = 1000;
    updateWsStatus(true);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'spawn') {
      agents.push(data.agent);
      render();
      openSessionTab(data.agent);
    } else if (data.type === 'message') {
      const agent = agents.find(a => a.id === data.agentId);
      if (agent) {
        /** @type {AgentMessage} */
        const msg = {
          content: data.content,
          type: data.messageType || 'assistant',
          input: data.input,
          result: data.result,
        };
        agent.messages.push(msg);
        if (data.tokens) agent.tokens = data.tokens;
        if (data.costUsd) agent.costUsd = data.costUsd;

        const messagesEl = document.getElementById(`messages-${data.agentId}`);
        if (messagesEl) {
          messagesEl.innerHTML = formatMessages(agent.messages);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        const tab = openTabs.get(data.agentId);
        if (tab) {
          tab.agent.messages = agent.messages;
        }
      }
    } else if (data.type === 'tool-result') {
      const agent = agents.find(a => a.id === data.agentId);
      if (agent) {
        for (let i = agent.messages.length - 1; i >= 0; i--) {
          const msg = agent.messages[i];
          if (msg.type === 'tool' && !msg.result) {
            msg.result = data.result;
            break;
          }
        }

        const messagesEl = document.getElementById(`messages-${data.agentId}`);
        if (messagesEl) {
          messagesEl.innerHTML = formatMessages(agent.messages);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    } else if (data.type === 'done' || data.type === 'error') {
      const agent = agents.find(a => a.id === data.agentId);
      if (agent) {
        agent.status = data.type === 'done' ? 'done' : 'error';
        const el = agentElements.get(data.agentId);
        if (el) {
          const badge = el.querySelector('.badge-status');
          if (badge) {
            badge.textContent = agent.status;
            badge.className = `badge badge-status status-${agent.status}`;
          }
        }
      }
    } else if (data.type === 'status') {
      const agent = agents.find(a => a.id === data.agentId);
      if (agent) {
        agent.status = data.status;
        const el = agentElements.get(data.agentId);
        if (el) {
          const badge = el.querySelector('.badge-status');
          if (badge) {
            badge.textContent = agent.status;
            badge.className = `badge badge-status status-${agent.status}`;
          }
        }
      }
    } else if (data.type === 'capabilities') {
      const agent = agents.find(a => a.id === data.agentId);
      if (agent) {
        agent.capabilities = data.capabilities;
        const el = agentElements.get(data.agentId);
        if (el) {
          const capsSelect = /** @type {HTMLSelectElement | null} */ (el.querySelector('.caps-select'));
          if (capsSelect) capsSelect.value = getPresetName(data.capabilities);
        }
      }
    }
  };

  ws.onclose = () => {
    updateWsStatus(false);
    setTimeout(connectWS, wsBackoff);
    wsBackoff = Math.min(wsBackoff * 2, 30000);
  };
}

// ============================================================================
// Push Notifications
// ============================================================================

/**
 * Updates the notification button state
 */
async function updateNotifyButton() {
  const btn = document.getElementById('notify-btn');
  if (!btn) return;

  if (!('PushManager' in window) || !swRegistration) {
    btn.style.display = 'none';
    return;
  }

  const subscription = await swRegistration.pushManager.getSubscription();
  btn.classList.toggle('enabled', !!subscription);
  btn.textContent = subscription ? 'Notify: On' : 'Notify: Off';
}

/**
 * Toggles push notifications
 */
async function toggleNotifications() {
  if (!swRegistration) return;

  const existing = await swRegistration.pushManager.getSubscription();

  if (existing) {
    await fetch(`${API}/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(existing.toJSON()),
    });
    await existing.unsubscribe();
  } else {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const res = await fetch(`${API}/push/vapid-public-key`);
    const { publicKey } = await res.json();

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await fetch(`${API}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });
  }

  updateNotifyButton();
}

/**
 * Shows an update banner when a new version is available
 */
function showUpdateBanner() {
  if (document.getElementById('update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.style.cssText = `
    position: fixed; bottom: 1rem; left: 50%; transform: translateX(-50%);
    background: var(--primary); color: white; padding: 0.5rem 1rem;
    border-radius: 8px; font-size: 0.85rem; cursor: pointer; z-index: 1000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  banner.textContent = 'Update available - tap to refresh';
  banner.onclick = () => location.reload();
  document.body.appendChild(banner);
}

/**
 * Fetches the list of repositories
 */
async function fetchRepos() {
  try {
    const res = await fetch(`${API}/repos`);
    const repos = await res.json();
    const datalist = document.getElementById('repos-list');
    if (datalist) {
      datalist.innerHTML = repos.map((/** @type {string} */ r) => `<option value="${r}">`).join('');
    }
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Event Listeners & Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  // Load default isolation preset
  const defaultPreset = localStorage.getItem('hub-default-preset') || 'isolated';
  const presetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('preset'));
  if (presetSelect) presetSelect.value = defaultPreset;

  // Tab click handling
  const tabsContainer = document.getElementById('session-tabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('click', e => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.classList.contains('close-tab')) {
        const tab = target.closest('.session-tab');
        if (tab instanceof HTMLElement && tab.dataset.id) {
          closeTab(tab.dataset.id);
        }
        return;
      }
      const tab = target.closest('.session-tab');
      if (tab instanceof HTMLElement && tab.dataset.id) {
        activateTab(tab.dataset.id);
      }
    });
  }

  // Toggle tool content
  const viewsContainer = document.getElementById('session-views');
  if (viewsContainer) {
    viewsContainer.addEventListener('click', e => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.closest('.tool-header')) {
        const tool = target.closest('.message-tool');
        if (tool) {
          const content = tool.querySelector('.tool-content');
          const toggle = tool.querySelector('.tool-toggle');
          if (content && toggle) {
            content.classList.toggle('collapsed');
            toggle.textContent = content.classList.contains('collapsed') ? '\u25BC' : '\u25B2';
          }
        }
      }
    });
  }

  // Filter input
  const filterInput = document.getElementById('filter');
  if (filterInput) {
    filterInput.addEventListener('input', e => {
      const target = /** @type {HTMLInputElement} */ (e.target);
      filterText = target.value.toLowerCase();
      render();
    });
  }

  // Tab navigation
  const sourceTabs = document.getElementById('source-tabs');
  if (sourceTabs) {
    sourceTabs.addEventListener('click', e => {
      const target = /** @type {HTMLElement} */ (e.target);
      const tab = target.closest('.tab');
      if (!tab || !(tab instanceof HTMLElement)) return;

      document.querySelectorAll('#source-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const source = tab.dataset.source;
      if (source === 'running' || source === 'done') {
        sourceFilter = 'all';
        statusFilter = source;
      } else if (source === 'all' || source === 'hub' || source === 'discovered') {
        sourceFilter = source;
        statusFilter = null;
      }
      currentOffset = 0;
      fetchAgents();
    });
  }

  // Agent click - open in tab
  const agentsContainer = document.getElementById('agents');
  if (agentsContainer) {
    agentsContainer.addEventListener('click', e => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (target.classList.contains('caps-select')) return;

      const agentEl = target.closest('.agent');
      if (!agentEl || !(agentEl instanceof HTMLElement)) return;

      const id = agentEl.dataset.id;
      const agent = agents.find(a => a.id === id);
      if (agent) openSessionTab(agent);
    });

    agentsContainer.addEventListener('change', async e => {
      const target = /** @type {HTMLElement} */ (e.target);
      if (!target.classList.contains('caps-select')) return;

      const agentEl = target.closest('.agent');
      if (!agentEl || !(agentEl instanceof HTMLElement)) return;

      const id = agentEl.dataset.id;
      const select = /** @type {HTMLSelectElement} */ (target);
      const preset = select.value;

      /** @type {Record<string, AgentCapabilities>} */
      const presetCaps = {
        isolated: { canDiscover: false, canRead: [], canMessage: [], canSpawn: false, canBeMessaged: [] },
        observer: { canDiscover: true, canRead: ['*'], canMessage: [], canSpawn: false, canBeMessaged: [] },
        peer: { canDiscover: true, canRead: ['*'], canMessage: ['*'], canSpawn: false, canBeMessaged: ['*'] },
        coordinator: { canDiscover: true, canRead: ['*'], canMessage: ['*'], canSpawn: true, canBeMessaged: ['*'] },
      };

      try {
        const res = await fetch(`${API}/agents/${id}/capabilities`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(presetCaps[preset]),
        });

        if (res.ok) {
          const agent = agents.find(a => a.id === id);
          if (agent) agent.capabilities = presetCaps[preset];
        } else {
          const agent = agents.find(a => a.id === id);
          if (agent) select.value = getPresetName(agent.capabilities);
        }
      } catch {
        const agent = agents.find(a => a.id === id);
        if (agent) select.value = getPresetName(agent.capabilities);
      }
    });
  }

  // Spawn form
  const spawnForm = document.getElementById('spawn-form');
  if (spawnForm) {
    spawnForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cwdInput = /** @type {HTMLInputElement | null} */ (document.getElementById('cwd'));
      const promptInput = /** @type {HTMLInputElement | null} */ (document.getElementById('prompt'));
      const presetSelect = /** @type {HTMLSelectElement | null} */ (document.getElementById('preset'));

      if (cwdInput && promptInput && presetSelect) {
        await spawnAgent(cwdInput.value, promptInput.value, presetSelect.value);
        cwdInput.value = '';
        promptInput.value = '';
      }
    });
  }

  // Pull-to-refresh
  let touchStartY = 0;
  let isPulling = false;

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
    }
  });

  document.addEventListener('touchmove', e => {
    if (!isPulling) return;
    const pullDistance = e.touches[0].clientY - touchStartY;
    const indicator = document.getElementById('pull-indicator');
    if (indicator && pullDistance > 50) {
      indicator.classList.add('visible');
      indicator.textContent = pullDistance > 100 ? 'Release to refresh' : 'Pull to refresh...';
    }
  });

  document.addEventListener('touchend', () => {
    if (!isPulling) return;
    const indicator = document.getElementById('pull-indicator');
    if (indicator && indicator.classList.contains('visible') && indicator.textContent?.includes('Release')) {
      indicator.textContent = 'Refreshing...';
      fetchAgents().then(() => {
        indicator.classList.remove('visible');
      });
    } else if (indicator) {
      indicator.classList.remove('visible');
    }
    isPulling = false;
  });

  // Infinite scroll
  window.addEventListener('scroll', () => {
    if (loading || !hasMore) return;
    const scrollBottom = window.innerHeight + window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    if (scrollBottom >= docHeight - 200) {
      fetchAgents(true);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
      if (e.key === 'Escape') target.blur();
      return;
    }

    if (e.key === '/' || e.key === 'n') {
      e.preventDefault();
      document.getElementById('prompt')?.focus();
    } else if (e.key === 'f') {
      e.preventDefault();
      document.getElementById('filter')?.focus();
    } else if (e.key === 'r') {
      e.preventDefault();
      fetchAgents();
    } else if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      const filtered = agents.filter(a =>
        !filterText || a.cwd.toLowerCase().includes(filterText) || a.prompt.toLowerCase().includes(filterText)
      );
      if (filtered[idx]) {
        const id = filtered[idx].id;
        if (expandedAgents.has(id)) expandedAgents.delete(id);
        else expandedAgents.add(id);
        render();
      }
    }
  });

  // Notification button
  const notifyBtn = document.getElementById('notify-btn');
  if (notifyBtn) {
    notifyBtn.addEventListener('click', toggleNotifications);
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => { swRegistration = reg; updateNotifyButton(); })
      .catch(() => {});

    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'update-available') {
        showUpdateBanner();
      }
    });
  }

  // Initialize
  fetchAgents();
  fetchRepos();
  connectWS();
});
