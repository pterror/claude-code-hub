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
 * @property {'assistant' | 'tool' | 'result' | 'error' | 'user'} type
 * @property {string} content
 * @property {Date} [timestamp]
 * @property {unknown} [input]
 * @property {string} [result]
 * @property {number} [startLine]
 * @property {number} [totalLines]
 * @property {Record<string, string>} [answers]
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

/** @type {string} */
let projectFilter = '';

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
if (typeof marked !== 'undefined') {
  // @ts-ignore
  const renderer = new marked.Renderer();

  // Custom code block renderer with syntax highlighting
  /** @param {string | {text: string, lang?: string}} code @param {string} [lang] */
  renderer.code = function(code, lang) {
    // Handle object format (newer marked versions)
    if (typeof code === 'object') {
      lang = code.lang;
      code = code.text;
    }
    // @ts-ignore
    if (typeof hljs !== 'undefined') {
      let highlighted;
      // @ts-ignore
      if (lang && hljs.getLanguage(lang)) {
        // @ts-ignore
        highlighted = hljs.highlight(code, { language: lang }).value;
      } else {
        // @ts-ignore
        highlighted = hljs.highlightAuto(code).value;
      }
      return `<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`;
    }
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  };

  // @ts-ignore
  marked.setOptions({
    renderer,
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
  if (name === 'askuserquestion') return 'ask';
  if (name === 'exitplanmode') return 'plan';
  if (name === 'enterplanmode') return 'plan-enter';
  if (name === 'taskcreate' || name === 'taskupdate' || name === 'taskget' || name === 'tasklist') return 'taskmgmt';
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
    ask: 'tool-ask',
    plan: 'tool-plan',
    'plan-enter': 'tool-plan',
    taskmgmt: 'tool-taskmgmt',
    todo: 'tool-todo',
  };
  return classes[toolType] || '';
}

/**
 * Strips line number prefixes from Read tool output
 * Format: "     N→content" where N is line number
 * @param {string} content
 * @returns {string}
 */
function stripLineNumbers(content) {
  return content.split('\n').map(line => {
    // Match pattern: spaces + number + → + content
    const match = line.match(/^\s*\d+→(.*)$/);
    return match ? match[1] : line;
  }).join('\n');
}

/**
 * Gets highlight.js language from file extension
 * @param {string} filePath
 * @returns {string | undefined}
 */
function getLangFromPath(filePath) {
  const ext = filePath.split('.').pop()?.toLowerCase();
  /** @type {Record<string, string>} */
  const extMap = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
    md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', graphql: 'graphql', xml: 'xml', svg: 'xml',
    dockerfile: 'dockerfile', makefile: 'makefile',
  };
  return ext ? extMap[ext] : undefined;
}

/**
 * Highlights code using highlight.js if available
 * @param {string} code
 * @param {string | undefined} lang
 * @returns {string}
 */
function highlightCode(code, lang) {
  // @ts-ignore - hljs is loaded externally
  if (typeof hljs === 'undefined') return escapeHtml(code);

  try {
    // @ts-ignore
    if (lang && hljs.getLanguage(lang)) {
      // @ts-ignore
      return hljs.highlight(code, { language: lang }).value;
    }
    // @ts-ignore
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Strips system-reminder tags from content
 * @param {string} content
 * @returns {string}
 */
function stripSystemReminders(content) {
  return content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/**
 * Gets a short param summary for display next to tool name
 * @param {string} toolType
 * @param {unknown} input
 * @returns {string}
 */
function getToolParamSummary(toolType, input) {
  if (!input) return '';
  const inp = /** @type {Record<string, unknown>} */ (input);

  switch (toolType) {
    case 'read':
    case 'write':
      return typeof inp.file_path === 'string' ? inp.file_path.split('/').pop() || '' : '';
    case 'edit':
      return typeof inp.file_path === 'string' ? inp.file_path.split('/').pop() || '' : '';
    case 'bash': {
      const cmd = typeof inp.command === 'string' ? inp.command : '';
      // Show first line, truncated
      const firstLine = cmd.split('\n')[0];
      return firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
    }
    case 'glob':
      return typeof inp.pattern === 'string' ? inp.pattern : '';
    case 'grep':
      return typeof inp.pattern === 'string' ? inp.pattern : '';
    case 'web':
      if (typeof inp.url === 'string') {
        try {
          return new URL(inp.url).hostname;
        } catch {
          return inp.url.slice(0, 30);
        }
      }
      return '';
    case 'task':
      return typeof inp.subagent_type === 'string' ? inp.subagent_type : '';
    case 'plan':
    case 'plan-enter':
      return '';
    case 'taskmgmt': {
      if (typeof inp.subject === 'string') return inp.subject.slice(0, 30);
      if (typeof inp.taskId === 'string' || typeof inp.taskId === 'number') return `#${inp.taskId}`;
      return '';
    }
    case 'todo':
      return '';
    default:
      return '';
  }
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @param {{startLine?: number, totalLines?: number}} [meta]
 * @returns {string}
 */
function renderReadTool(input, result, meta) {
  const inp = /** @type {{file_path?: string, offset?: number, limit?: number}} */ (input);
  const filePath = inp?.file_path || 'unknown';
  const rawContent = stripSystemReminders(result || '');
  const content = stripLineNumbers(rawContent);
  const lang = getLangFromPath(filePath);
  const truncated = content.length > 5000;
  const displayContent = truncated ? content.slice(0, 5000) + '\n...(truncated)' : content;

  // Build header with optional line range from metadata
  let header = escapeHtml(filePath);
  const startLine = meta?.startLine ?? inp?.offset;
  const totalLines = meta?.totalLines;
  const numLines = content.split('\n').length;

  if (startLine !== undefined && totalLines !== undefined) {
    const endLine = Math.min(startLine + numLines - 1, totalLines);
    header += ` <span style="opacity: 0.6">(lines ${startLine}-${endLine} of ${totalLines})</span>`;
  } else if (startLine !== undefined && startLine > 1) {
    header += ` <span style="opacity: 0.6">(from line ${startLine})</span>`;
  }

  return `
    <div class="file-viewer">
      <div class="file-viewer-header">${header}</div>
      <pre class="file-viewer-content"><code class="hljs${lang ? ` language-${lang}` : ''}">${highlightCode(displayContent, lang)}</code></pre>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} _result - unused, kept for consistent signature
 * @returns {string}
 */
function renderEditTool(input, _result) {
  const inp = /** @type {{file_path?: string, old_string?: string, new_string?: string}} */ (input);
  const filePath = inp?.file_path || 'unknown';
  const oldStr = inp?.old_string || '';
  const newStr = inp?.new_string || '';
  const lang = getLangFromPath(filePath);

  return `
    <div class="diff-view">
      <div class="diff-header">${escapeHtml(filePath)}</div>
      <pre class="diff-old diff-content"><code class="hljs">- ${highlightCode(oldStr, lang)}</code></pre>
      <pre class="diff-new diff-content"><code class="hljs">+ ${highlightCode(newStr, lang)}</code></pre>
    </div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} _result - unused, kept for consistent signature
 * @returns {string}
 */
function renderWriteTool(input, _result) {
  const inp = /** @type {{file_path?: string, content?: string}} */ (input);
  const filePath = inp?.file_path || 'unknown';
  const content = inp?.content || '';
  const lang = getLangFromPath(filePath);
  const truncated = content.length > 3000;
  const displayContent = truncated ? content.slice(0, 3000) + '\n...(truncated)' : content;

  return `
    <div class="file-viewer">
      <div class="file-viewer-header">Writing: ${escapeHtml(filePath)}</div>
      <pre class="file-viewer-content"><code class="hljs${lang ? ` language-${lang}` : ''}">${highlightCode(displayContent, lang)}</code></pre>
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
  const truncated = output.length > 3000;
  const displayOutput = truncated ? output.slice(0, 3000) + '\n...(truncated)' : output;

  return `
    <div class="terminal">
      <div class="terminal-header">
        <span class="terminal-prompt">$</span>
        <code class="terminal-cmd hljs language-bash">${highlightCode(cmd, 'bash')}</code>
      </div>
      <pre class="terminal-output ${isError ? 'terminal-error' : ''}">${escapeHtml(displayOutput)}</pre>
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
      <div class="web-url"><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></div>
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
 * @typedef {Object} AskQuestion
 * @property {string} question
 * @property {string} header
 * @property {{label: string, description: string}[]} options
 * @property {boolean} multiSelect
 */

/**
 * @param {unknown} input
 * @param {string | undefined} _result
 * @returns {string}
 */
/**
 * @param {unknown} input
 * @param {string | undefined} _result
 * @param {Record<string, string>} [answers]
 * @returns {string}
 */
function renderAskTool(input, _result, answers) {
  const inp = /** @type {{questions?: AskQuestion[]}} */ (input);
  const questions = inp?.questions || [];

  if (questions.length === 0) {
    return '<div class="ask-empty">No questions</div>';
  }

  return questions.map((q, idx) => {
    const answer = answers?.[String(idx)] || answers?.[q.header || ''];
    return `
    <div class="ask-question">
      <div class="ask-header">${escapeHtml(q.header || '')}</div>
      <div class="ask-text">${escapeHtml(q.question || '')}</div>
      <div class="ask-options">
        ${(q.options || []).map(opt => `
          <div class="ask-option${answer === opt.label ? ' ask-option-selected' : ''}">
            <span class="ask-option-label">${escapeHtml(opt.label)}</span>
            <span class="ask-option-desc">${escapeHtml(opt.description || '')}</span>
          </div>
        `).join('')}
      </div>
      ${answer ? `<div class="ask-answer">Answer: ${escapeHtml(answer)}</div>` : ''}
    </div>
  `}).join('');
}

/**
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderPlanTool(input, result) {
  const inp = /** @type {{plan?: string, allowedPrompts?: unknown[], launchSwarm?: boolean}} */ (input);
  const plan = inp?.plan || '';

  // Determine status from result
  let statusHtml = '';
  if (result) {
    // Error results mean rejection
    const isRejected = result.includes('rejected') || result.includes('error') || result.includes('not approved');
    if (isRejected) {
      statusHtml = `<div class="plan-status plan-status-rejected">Rejected</div>`;
    } else {
      statusHtml = `<div class="plan-status plan-status-accepted">Approved</div>`;
    }
  } else {
    statusHtml = `<div class="plan-status plan-status-pending">Pending</div>`;
  }

  // @ts-ignore - marked is loaded externally
  const planHtml = typeof marked !== 'undefined' ? marked.parse(plan) : escapeHtml(plan);

  return `
    <div class="plan-view">
      ${statusHtml}
      <div class="plan-body">${planHtml}</div>
    </div>`;
}

/**
 * @param {unknown} _input
 * @param {string | undefined} _result
 * @returns {string}
 */
function renderEnterPlanTool(_input, _result) {
  return `<div class="plan-enter">Entered plan mode</div>`;
}

/**
 * @param {string} toolName
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderTaskMgmtTool(toolName, input, result) {
  const inp = /** @type {Record<string, unknown>} */ (input || {});
  const name = toolName.toLowerCase();

  if (name === 'taskcreate') {
    const subject = typeof inp.subject === 'string' ? inp.subject : '';
    const desc = typeof inp.description === 'string' ? inp.description : '';
    return `
      <div class="taskmgmt-view">
        <div class="taskmgmt-subject">${escapeHtml(subject)}</div>
        ${desc ? `<div class="taskmgmt-desc">${escapeHtml(desc.slice(0, 200))}${desc.length > 200 ? '...' : ''}</div>` : ''}
      </div>`;
  }

  if (name === 'taskupdate') {
    const parts = [];
    if (inp.taskId) parts.push(`<div class="taskmgmt-field"><span class="taskmgmt-field-label">Task:</span> #${escapeHtml(String(inp.taskId))}</div>`);
    if (inp.status) parts.push(`<div class="taskmgmt-field"><span class="taskmgmt-field-label">Status:</span> ${escapeHtml(String(inp.status))}</div>`);
    if (inp.subject) parts.push(`<div class="taskmgmt-field"><span class="taskmgmt-field-label">Subject:</span> ${escapeHtml(String(inp.subject))}</div>`);
    return `<div class="taskmgmt-view">${parts.join('')}</div>`;
  }

  // TaskGet / TaskList - show result
  const resultStr = result || '';
  return `<div class="taskmgmt-view"><pre style="margin: 0; font-size: 0.75rem;">${escapeHtml(resultStr.slice(0, 1000))}${resultStr.length > 1000 ? '...' : ''}</pre></div>`;
}

/**
 * @param {unknown} input
 * @param {string | undefined} _result
 * @returns {string}
 */
function renderTodoTool(input, _result) {
  const inp = /** @type {{todos?: Array<{content: string, status: string, id?: string}>}} */ (input);
  const todos = inp?.todos || [];

  if (todos.length === 0) {
    return '<div style="font-size: 0.75rem; color: var(--fg-muted);">(empty todo list)</div>';
  }

  const items = todos.map(t => {
    const status = t.status || 'pending';
    const check = status === 'completed' ? '\u2713' : status === 'in_progress' ? '\u25CB' : '\u25CB';
    return `<li class="todo-item todo-item-${escapeHtml(status)}"><span class="todo-check">${check}</span><span class="todo-text">${escapeHtml(t.content)}</span></li>`;
  }).join('');

  return `<ul class="todo-list">${items}</ul>`;
}

/**
 * @param {string} _toolName - unused, kept for consistent signature
 * @param {unknown} input
 * @param {string | undefined} result
 * @returns {string}
 */
function renderGenericTool(_toolName, input, result) {
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
 * Renders a single message
 * @param {AgentMessage} m
 * @param {number} i
 * @returns {string}
 */
function renderMessage(m, i) {
  if (m.type === 'tool') {
    const toolName = m.content.replace('Tool: ', '');
    const toolType = getToolType(toolName);
    const toolClass = getToolClass(toolType);

    let toolContent;
    switch (toolType) {
      case 'read':
        toolContent = renderReadTool(m.input, m.result, {
          startLine: m.startLine,
          totalLines: m.totalLines,
        });
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
      case 'ask':
        toolContent = renderAskTool(m.input, m.result, m.answers);
        break;
      case 'plan':
        toolContent = renderPlanTool(m.input, m.result);
        break;
      case 'plan-enter':
        toolContent = renderEnterPlanTool(m.input, m.result);
        break;
      case 'taskmgmt':
        toolContent = renderTaskMgmtTool(toolName, m.input, m.result);
        break;
      case 'todo':
        toolContent = renderTodoTool(m.input, m.result);
        break;
      default:
        toolContent = renderGenericTool(toolName, m.input, m.result);
    }

    const paramSummary = getToolParamSummary(toolType, m.input);
    return `<div class="message message-tool ${toolClass}" data-idx="${i}">
      <div class="tool-header">
        <span class="tool-name">${escapeHtml(toolName)}${paramSummary ? ` <span class="tool-param">${escapeHtml(paramSummary)}</span>` : ''}</span>
        <span class="tool-toggle">\u25B2</span>
      </div>
      <div class="tool-content">${toolContent}</div>
    </div>`;
  } else if (m.type === 'user') {
    const userContent = stripSystemReminders(m.content);
    // @ts-ignore - marked is loaded externally
    const userHtml = typeof marked !== 'undefined' ? marked.parse(userContent) : escapeHtml(userContent);
    return `<div class="message message-user">${userHtml}</div>`;
  } else if (m.content.startsWith('[User]:')) {
    // Legacy format
    const legacyContent = stripSystemReminders(m.content.slice(7).trim());
    // @ts-ignore - marked is loaded externally
    const legacyHtml = typeof marked !== 'undefined' ? marked.parse(legacyContent) : escapeHtml(legacyContent);
    return `<div class="message message-user">${legacyHtml}</div>`;
  } else {
    // Render markdown for assistant messages
    // @ts-ignore - marked is loaded externally
    const html = typeof marked !== 'undefined' ? marked.parse(m.content) : escapeHtml(m.content);
    return `<div class="message message-assistant">${html}</div>`;
  }
}

/**
 * Formats agent messages for display with dedicated tool UIs
 * Groups messages into collapsible turns (agent responses between user messages)
 * @param {AgentMessage[] | undefined} messages
 * @returns {string}
 */
function formatMessages(messages) {
  if (!messages || messages.length === 0) return '<div class="empty">No messages yet</div>';

  // Group messages into turns: each turn starts with a user message
  /** @type {{userMsg: AgentMessage | null, agentMsgs: AgentMessage[], startIdx: number}[]} */
  const turns = [];
  /** @type {AgentMessage[]} */
  let currentAgentMsgs = [];
  let startIdx = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isUser = m.type === 'user' || m.content.startsWith('[User]:');

    if (isUser) {
      // Save previous agent messages as a turn without user message
      if (currentAgentMsgs.length > 0) {
        turns.push({ userMsg: null, agentMsgs: currentAgentMsgs, startIdx });
      }
      // Start new turn with this user message
      turns.push({ userMsg: m, agentMsgs: [], startIdx: i });
      currentAgentMsgs = [];
      startIdx = i + 1;
    } else {
      currentAgentMsgs.push(m);
    }
  }

  // Don't forget trailing agent messages
  if (currentAgentMsgs.length > 0) {
    turns.push({ userMsg: null, agentMsgs: currentAgentMsgs, startIdx });
  }

  return turns.map((turn, turnIdx) => {
    const parts = [];

    // Render user message if present
    if (turn.userMsg) {
      parts.push(renderMessage(turn.userMsg, turn.startIdx - 1));
    }

    // Render agent messages in a collapsible container
    if (turn.agentMsgs.length > 0) {
      const agentHtml = turn.agentMsgs.map((m, i) => renderMessage(m, turn.startIdx + i)).join('');
      const toolCount = turn.agentMsgs.filter(m => m.type === 'tool').length;
      const summary = toolCount > 0 ? `${toolCount} tool${toolCount > 1 ? 's' : ''}` : '';

      parts.push(`
        <div class="turn" data-turn="${turnIdx}">
          <div class="turn-header">
            <span class="turn-toggle">\u25B2</span>
            <span class="turn-summary">${summary}</span>
          </div>
          <div class="turn-content">${agentHtml}</div>
        </div>
      `);
    }

    return parts.join('');
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
  saveOpenTabs();

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
  saveOpenTabs();

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

/**
 * Saves open tabs to localStorage
 */
function saveOpenTabs() {
  const tabIds = Array.from(openTabs.keys());
  localStorage.setItem('hub-open-tabs', JSON.stringify(tabIds));
  if (activeTabId) {
    localStorage.setItem('hub-active-tab', activeTabId);
  } else {
    localStorage.removeItem('hub-active-tab');
  }
}

/**
 * Restores open tabs from localStorage
 */
function restoreOpenTabs() {
  try {
    const saved = localStorage.getItem('hub-open-tabs');
    const activeId = localStorage.getItem('hub-active-tab');
    if (!saved) return;

    const tabIds = JSON.parse(saved);
    for (const id of tabIds) {
      const agent = agents.find(a => a.id === id);
      if (agent && !openTabs.has(id)) {
        openSessionTab(agent);
      }
    }

    // Activate the previously active tab
    if (activeId && openTabs.has(activeId)) {
      activateTab(activeId);
    }
  } catch {
    // Ignore localStorage errors
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
  updateProjectFilter();
  render();
}

/**
 * Updates the project filter dropdown with unique projects
 */
function updateProjectFilter() {
  const select = /** @type {HTMLSelectElement | null} */ (document.getElementById('project-filter'));
  if (!select) return;

  // Get unique project paths (parent directories)
  const projects = new Set(agents.map(a => {
    // Extract project name from cwd (last directory component)
    const parts = a.cwd.replace(/^~/, '').split('/').filter(p => p);
    return parts.length > 0 ? parts[parts.length - 1] : a.cwd;
  }));

  const currentValue = select.value;
  select.innerHTML = '<option value="">All projects</option>';

  Array.from(projects).sort().forEach(project => {
    const option = document.createElement('option');
    option.value = project;
    option.textContent = project;
    select.appendChild(option);
  });

  // Restore selection if it still exists
  if (currentValue && projects.has(currentValue)) {
    select.value = currentValue;
  }
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
    if (projectFilter) {
      const folderName = a.cwd.split('/').filter(p => p).pop() || a.cwd;
      if (folderName !== projectFilter) return false;
    }
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
      applicationServerKey: /** @type {BufferSource} */ (urlBase64ToUint8Array(publicKey)),
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

      // Turn collapse/expand
      if (target.closest('.turn-header')) {
        const turn = target.closest('.turn');
        if (turn) {
          turn.classList.toggle('collapsed');
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

  // Project filter dropdown
  const projectFilterSelect = document.getElementById('project-filter');
  if (projectFilterSelect) {
    projectFilterSelect.addEventListener('change', e => {
      const target = /** @type {HTMLSelectElement} */ (e.target);
      projectFilter = target.value;
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
  fetchAgents().then(() => restoreOpenTabs());
  fetchRepos();
  connectWS();
});
