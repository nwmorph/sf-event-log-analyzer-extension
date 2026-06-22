// ── CSV Parser ────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text) {
  // Split into records respecting quoted newlines
  const records = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
      cur += ch;
    } else if ((ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) && !inQuotes) {
      if (ch === '\r') i++;
      if (cur.trim()) records.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) records.push(cur);

  if (records.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(records[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = records.slice(1).map(line => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()]));
  }).filter(r => Object.values(r).some(v => v !== ''));
  return { headers, rows };
}

// ── Helpers ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(b) {
  b = Number(b);
  if (b >= 1048576) return (b/1048576).toFixed(2) + ' MB';
  if (b >= 1024)    return (b/1024).toFixed(1) + ' KB';
  return b + ' B';
}

function topN(rows, field, n = 10) {
  const counts = {};
  rows.forEach(r => { const v = r[field] || '(blank)'; counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0, n);
}

function pct(v, total) { return total > 0 ? Math.round(v/total*100) : 0; }

// ── State ─────────────────────────────────────────────────────────────────
let currentCsvData = null;   // { headers, rows }
let currentCsvText = '';     // raw CSV text for the Raw CSV tab
let currentLoadId = 0;       // increments each time a new log is loaded
let currentUserMap = {};     // { userId: 'Full Name' }
let filteredRows = [];        // after search + quick filters
let activeQuickFilters = new Set();
let sortCol = null;
let sortDir = 'asc';
let currentEventType = '';

// ── Entry point ────────────────────────────────────────────────────────────
function analyseEventLog(csvText, eventType, meta, userMap) {
  currentEventType = eventType || '';
  currentCsvText = csvText || '';
  currentLoadId++;
  currentUserMap = userMap || {};
  currentCsvData = parseCsv(csvText);
  filteredRows = [...currentCsvData.rows];
  activeQuickFilters.clear();
  sortCol = null;

  const mainEmpty   = document.getElementById('main-empty');
  const mainAnalysis = document.getElementById('main-analysis');
  const mainLoading = document.getElementById('main-loading');
  const mainError   = document.getElementById('main-error');
  if (mainEmpty)    mainEmpty.style.display    = 'none';
  if (mainLoading)  mainLoading.style.display  = 'none';
  if (mainError)    mainError.style.display    = 'none';
  if (mainAnalysis) mainAnalysis.style.display = '';

  // Header
  const header = document.getElementById('analysis-header');
  if (header) {
    header.innerHTML = `
      <div class="analysis-title">${escapeHtml(eventType)}</div>
      <div class="analysis-meta">
        ${meta?.date || ''} · ${currentCsvData.rows.length.toLocaleString()} records
        ${meta?.interval ? ' · ' + meta.interval : ''}
        ${meta?.size ? ' · ' + formatBytes(meta.size) : ''}
      </div>`;
  }

  // Search bar
  const searchInput = document.getElementById('global-search');
  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = () => applyFilters();
  }

  // Quick filters
  setupQuickFilters(currentCsvData.headers, currentCsvData.rows);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + btn.getAttribute('data-tab'));
      if (panel) panel.classList.add('active');
      // Render the newly activated tab
      renderOverview();
      renderTable();
      renderCharts();
      renderRaw();
    };
  });

  // Switch to overview tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="overview"]')?.classList.add('active');
  document.getElementById('tab-overview')?.classList.add('active');

  applyFilters();
}

// ── Filters ────────────────────────────────────────────────────────────────
function applyFilters() {
  const q = (document.getElementById('global-search')?.value || '').toLowerCase().trim();

  filteredRows = currentCsvData.rows.filter(row => {
    // Global search
    if (q && !Object.values(row).some(v => v.toLowerCase().includes(q))) return false;
    // Quick filters
    for (const filter of activeQuickFilters) {
      if (!QUICK_FILTER_DEFS[filter]?.test(row)) return false;
    }
    return true;
  });

  const countEl = document.getElementById('search-count');
  if (countEl) {
    const total = currentCsvData.rows.length;
    countEl.textContent = filteredRows.length === total
      ? `${total.toLocaleString()} records`
      : `${filteredRows.length.toLocaleString()} / ${total.toLocaleString()} records`;
  }

  renderOverview();
  renderTable();
  renderCharts();
  renderRaw();
}

// ── Quick filter definitions ───────────────────────────────────────────────
const QUICK_FILTER_DEFS = {
  errors:    { label: 'Errors only',       cls: 'chip-red',   test: r => parseInt(r.STATUS_CODE || 0) >= 400 || !!r.EXCEPTION_TYPE },
  slow:      { label: 'Slow (>1s)',        cls: 'chip-amber', test: r => parseInt(r.RUN_TIME || r.EXEC_TIME || 0) > 1000 },
  external:  { label: 'External IPs',     cls: '',           test: r => { const ip = r.CLIENT_IP || ''; return !!ip && ip !== 'Salesforce.com IP' && !/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|::1)/.test(ip); } },
  cpu_heavy: { label: 'High CPU (>500ms)', cls: 'chip-amber', test: r => parseInt(r.CPU_TIME || 0) > 500 },
};

function setupQuickFilters(headers, rows) {
  const container = document.getElementById('quick-filters');
  if (!container) return;
  container.innerHTML = '';

  // Only show chips relevant to columns present
  const show = [];
  if (headers.includes('STATUS_CODE') || headers.includes('EXCEPTION_TYPE')) show.push('errors');
  if (headers.includes('RUN_TIME')) show.push('slow');
  if (headers.includes('CLIENT_IP')) show.push('external');
  if (headers.includes('CPU_TIME')) show.push('cpu_heavy');

  show.forEach(key => {
    const def = QUICK_FILTER_DEFS[key];
    const btn = document.createElement('button');
    btn.className = `quick-filter-chip ${def.cls}`;
    btn.textContent = def.label;
    btn.onclick = () => {
      if (activeQuickFilters.has(key)) { activeQuickFilters.delete(key); btn.classList.remove('active'); }
      else { activeQuickFilters.add(key); btn.classList.add('active'); }
      applyFilters();
    };
    container.appendChild(btn);
  });
}

// ── Overview renderer ──────────────────────────────────────────────────────
function renderOverview() {
  const panel = document.getElementById('tab-overview');
  if (!panel || !panel.classList.contains('active')) return;
  panel.innerHTML = renderOverviewForType(currentEventType, filteredRows, currentCsvData.headers);
}

function renderOverviewForType(eventType, rows, headers) {
  const type = (eventType || '').toUpperCase().replace(/\s/g, '_');

  if (type === 'APEXUNEXPECTEDEXCEPTION' || type === 'APEX_UNEXPECTED_EXCEPTION') {
    return renderApexExceptionOverview(rows, headers);
  }
  if (type === 'APEXEXECUTION') {
    return renderApexExecutionOverview(rows, headers);
  }
  if (type === 'RESTAPI' || type === 'REST_API' || type === 'AURA_REQUEST' || type === 'AURAREQUEST') {
    return renderApiOverview(rows, headers, type);
  }
  if (type === 'LOGIN') {
    return renderLoginOverview(rows, headers);
  }
  if (type === 'APITOTALUSAGE' || type === 'API_TOTAL_USAGE') {
    return renderApiUsageOverview(rows, headers);
  }
  return renderGenericOverview(rows, headers);
}

function statCards(cards) {
  return `<div class="stat-cards">${cards.map(c =>
    `<div class="stat-card">
      <div class="stat-card-label">${escapeHtml(c.label)}</div>
      <div class="stat-card-value ${c.cls || ''}">${escapeHtml(String(c.value))}</div>
    </div>`
  ).join('')}</div>`;
}

function topNSection(title, entries, total, color = 'var(--accent)') {
  if (!entries.length) return '';
  const max = entries[0][1];
  return `<div class="overview-section">
    <div class="overview-section-title">${escapeHtml(title)}</div>
    ${entries.map(([label, count]) => `
      <div class="top-n-row">
        <div class="top-n-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
        <div class="top-n-bar-wrap">
          <div class="top-n-bar-track"><div class="top-n-bar-fill" style="width:${pct(count,max)}%;background:${color};"></div></div>
          <div class="top-n-count">${count.toLocaleString()}</div>
        </div>
      </div>`).join('')}
  </div>`;
}

function renderApexExceptionOverview(rows, headers) {
  const total = rows.length;
  const types = topN(rows, 'EXCEPTION_TYPE');
  const classes = topN(rows, 'ENTITY_NAME');
  const userCounts = {};
  rows.forEach(r => { const id = r.USER_ID_DERIVED || '(unknown)'; userCounts[id] = (userCounts[id] || 0) + 1; });
  const users = Object.entries(userCounts).sort((a,b) => b[1]-a[1]).slice(0, 5)
    .map(([id, count]) => [formatUser(id), count]);

  return statCards([
    { label: 'Total Exceptions', value: total.toLocaleString(), cls: total > 0 ? 'red' : 'green' },
    { label: 'Unique Types', value: new Set(rows.map(r => r.EXCEPTION_TYPE)).size },
    { label: 'Affected Classes', value: new Set(rows.map(r => r.ENTITY_NAME)).size },
    { label: 'Affected Users', value: new Set(rows.map(r => r.USER_ID_DERIVED)).size },
  ])
  + topNSection('Exception Types', types, total, 'var(--red)')
  + topNSection('Affected Classes / Triggers', classes, total)
  + (users.length > 1 ? topNSection('Top Users', users, total, 'var(--amber)') : '');
}

function renderApiOverview(rows, headers, type) {
  const total = rows.length;
  const errors = rows.filter(r => parseInt(r.STATUS_CODE || 0) >= 400).length;
  const avgRt = rows.length ? Math.round(rows.reduce((s, r) => s + parseInt(r.RUN_TIME || 0), 0) / rows.length) : 0;
  const methods = topN(rows, 'METHOD');
  const uris = topN(rows, 'URI');
  const ips = topN(rows, 'CLIENT_IP');
  const statusCodes = topN(rows, 'STATUS_CODE');

  return statCards([
    { label: 'Total Calls', value: total.toLocaleString() },
    { label: 'Errors (4xx/5xx)', value: errors.toLocaleString(), cls: errors > 0 ? 'red' : 'green' },
    { label: 'Error Rate', value: pct(errors, total) + '%', cls: errors/total > 0.05 ? 'red' : errors > 0 ? 'amber' : 'green' },
    { label: 'Avg Response Time', value: avgRt + ' ms', cls: avgRt > 1000 ? 'amber' : '' },
  ])
  + topNSection('HTTP Methods', methods, total)
  + topNSection('Top Endpoints (URI)', uris, total)
  + topNSection('Status Codes', statusCodes, total, 'var(--amber)')
  + topNSection('Top Client IPs', ips, total);
}

function renderLoginOverview(rows, headers) {
  const total = rows.length;
  const failed = rows.filter(r => r.LOGIN_STATUS && r.LOGIN_STATUS !== 'LOGIN_NO_ERROR' && r.LOGIN_STATUS !== 'Success').length;
  const users = topN(rows, 'USER_ID_DERIVED');
  const ips = topN(rows, 'CLIENT_IP');
  const statuses = topN(rows, 'LOGIN_STATUS');

  return statCards([
    { label: 'Total Logins', value: total.toLocaleString() },
    { label: 'Failed Logins', value: failed.toLocaleString(), cls: failed > 0 ? 'red' : 'green' },
    { label: 'Unique Users', value: new Set(rows.map(r => r.USER_ID_DERIVED)).size },
    { label: 'Unique IPs', value: new Set(rows.map(r => r.CLIENT_IP)).size },
  ])
  + topNSection('Login Status', statuses, total)
  + topNSection('Most Active Users', users, total)
  + topNSection('Top Source IPs', ips, total);
}

function renderApiUsageOverview(rows, headers) {
  const total = rows.length;
  const types = topN(rows, 'API_TYPE');
  const users = topN(rows, 'USER_ID_DERIVED');
  return statCards([
    { label: 'Records', value: total.toLocaleString() },
    { label: 'API Types', value: new Set(rows.map(r => r.API_TYPE)).size },
    { label: 'Unique Users', value: new Set(rows.map(r => r.USER_ID_DERIVED)).size },
  ])
  + topNSection('By API Type', types, total)
  + topNSection('Top Users', users, total);
}

const QUIDDITY_LABELS = {
  A: 'Synchronous Apex',
  B: 'Batch Apex',
  C: 'Scheduled Apex',
  D: 'Apex Class',
  E: 'Inbound Email',
  F: 'Future Method',
  H: 'Visualforce HTTP Request',
  I: 'Invocable Action',
  K: 'Quick Action',
  L: 'Lightning (Aura/LWC)',
  M: 'Remote Action',
  N: 'Synchronous',
  P: 'Apex REST',
  Q: 'SOAP Web Service',
  R: 'REST API',
  S: 'Standard API',
  T: 'Trigger',
  V: 'Visualforce',
  W: 'SOAP API',
  X: 'Execute Anonymous',
};

function formatUser(id) {
  return currentUserMap[id] ? currentUserMap[id] + ' (' + id + ')' : id;
}

function renderApexExecutionOverview(rows, headers) {
  const total  = rows.length;
  const avgRt  = total ? Math.round(rows.reduce((s, r) => s + parseInt(r.EXEC_TIME || r.RUN_TIME || 0), 0) / total) : 0;
  const avgCpu = total ? Math.round(rows.reduce((s, r) => s + parseInt(r.CPU_TIME || 0), 0) / total) : 0;
  const slow   = rows.filter(r => parseInt(r.EXEC_TIME || r.RUN_TIME || 0) > 1000).length;
  const errors = rows.filter(r => r.IS_LONG_RUNNING_REQUEST === '1' || r.EXCEPTION_TYPE || parseInt(r.NUMBER_EXCEPTION_THROWN || 0) > 0);
  const hasErrors = errors.length > 0;

  // User top-N with resolved names
  const userCounts = {};
  rows.forEach(r => { const id = r.USER_ID_DERIVED || '(unknown)'; userCounts[id] = (userCounts[id] || 0) + 1; });
  const users = Object.entries(userCounts).sort((a,b) => b[1]-a[1]).slice(0, 8)
    .map(([id, count]) => [formatUser(id), count]);

  // Quiddity with human-readable labels
  const qCounts = {};
  rows.forEach(r => { const q = r.QUIDDITY || ''; if (q) qCounts[q] = (qCounts[q] || 0) + 1; });
  const quanta = Object.entries(qCounts).sort((a,b) => b[1]-a[1]).slice(0, 8)
    .map(([code, count]) => [QUIDDITY_LABELS[code] ? QUIDDITY_LABELS[code] + ' (' + code + ')' : code, count]);

  const entry = topN(rows, 'ENTRY_POINT', 8);

  // Summary narrative
  const summaryLines = [];
  summaryLines.push(total + ' Apex execution' + (total !== 1 ? 's' : '') + ' recorded.');
  if (avgRt > 0) summaryLines.push('Average execution time was ' + avgRt + ' ms' + (avgRt > 1000 ? ' — above the 1s threshold.' : '.'));
  if (avgCpu > 0) summaryLines.push('Average CPU time was ' + avgCpu + ' ms' + (avgCpu > 500 ? ' — approaching governor limits.' : '.'));
  if (slow > 0) summaryLines.push(slow + ' execution' + (slow !== 1 ? 's' : '') + ' exceeded 1 second.');
  if (hasErrors) summaryLines.push(errors.length + ' execution' + (errors.length !== 1 ? 's' : '') + ' involved exceptions or long-running requests.');
  const topEntry = entry[0];
  if (topEntry) summaryLines.push('Most frequent entry point: ' + topEntry[0] + ' (' + topEntry[1] + ' time' + (topEntry[1] !== 1 ? 's' : '') + ').');

  const summaryHtml = `<div class="overview-section overview-summary">
    <div class="overview-section-title">Summary</div>
    ${summaryLines.map(l => `<p class="summary-line">${escapeHtml(l)}</p>`).join('')}
  </div>`;

  // Errors / exceptions section
  let errorsHtml = '';
  if (hasErrors) {
    errorsHtml = `<div class="overview-section overview-errors">
      <div class="overview-section-title overview-section-title--error">⚠ Exceptions &amp; Issues</div>
      ${errors.slice(0, 20).map(r => {
        const who  = formatUser(r.USER_ID_DERIVED || '');
        const when = r.TIMESTAMP ? r.TIMESTAMP.substring(0, 19).replace('T', ' ') : '';
        const exc  = r.EXCEPTION_TYPE || '';
        const entry2 = r.ENTRY_POINT || '';
        const rt   = r.EXEC_TIME || r.RUN_TIME || '';
        return `<div class="error-row">
          <span class="error-tag">${escapeHtml(exc || 'Long-running')}</span>
          <span class="error-detail">${escapeHtml(entry2)}</span>
          <span class="error-meta">${escapeHtml(who)}${when ? ' · ' + when : ''}${rt ? ' · ' + rt + ' ms' : ''}</span>
        </div>`;
      }).join('')}
      ${errors.length > 20 ? `<p class="summary-line" style="color:var(--muted)">…and ${errors.length - 20} more. Use the Table tab to see all.</p>` : ''}
    </div>`;
  }

  return summaryHtml
    + statCards([
        { label: 'Executions', value: total.toLocaleString() },
        { label: 'Avg Exec Time', value: avgRt + ' ms', cls: avgRt > 1000 ? 'amber' : '' },
        { label: 'Avg CPU Time', value: avgCpu + ' ms', cls: avgCpu > 500 ? 'amber' : '' },
        { label: 'Slow (>1s)', value: slow.toLocaleString(), cls: slow > 0 ? 'amber' : 'green' },
      ])
    + errorsHtml
    + (entry.length   ? topNSection('Top Entry Points', entry, total) : '')
    + (quanta.length  ? topNSection('Execution Type', quanta, total) : '')
    + (users.length   ? topNSection('Most Active Users', users, total, 'var(--amber)') : '');
}

function renderGenericOverview(rows, headers) {
  if (rows.length === 0) return '<p style="color:var(--muted);padding:20px">No records.</p>';
  const numericCols = headers.filter(h => rows.slice(0,20).every(r => r[h] === '' || !isNaN(Number(r[h]))));
  // Skip high-cardinality columns (IDs, keys, timestamps) — they produce useless top-N lists
  const HIGH_CARDINALITY = /^(REQUEST_ID|SESSION_KEY|TIMESTAMP|ID|UUID|CORRELATION|TRANSACTION)/i;
  const stringCols = headers.filter(h =>
    !numericCols.includes(h) &&
    !HIGH_CARDINALITY.test(h) &&
    new Set(rows.map(r => r[h])).size < rows.length * 0.9
  ).slice(0, 6);
  let html = statCards([
    { label: 'Total Records', value: rows.length.toLocaleString() },
    { label: 'Columns', value: headers.length },
  ]);
  stringCols.forEach(col => {
    let entries = topN(rows, col, 8);
    // Resolve user IDs to names for user columns
    if (/USER_ID/i.test(col)) {
      entries = entries.map(([id, count]) => [formatUser(id), count]);
    }
    if (entries.length > 1) html += topNSection(col, entries, rows.length);
  });
  // Always show user breakdown if a user column exists and wasn't already included
  const userCol = ['USER_ID_DERIVED','USER_ID'].find(c => headers.includes(c) && !stringCols.includes(c));
  if (userCol) {
    const userCounts = {};
    rows.forEach(r => { const id = r[userCol] || '(unknown)'; userCounts[id] = (userCounts[id] || 0) + 1; });
    const userEntries = Object.entries(userCounts).sort((a,b) => b[1]-a[1]).slice(0,8)
      .map(([id, count]) => [formatUser(id), count]);
    if (userEntries.length > 0) html += topNSection('Most Active Users', userEntries, rows.length, 'var(--amber)');
  }
  return html;
}

// ── Table renderer ─────────────────────────────────────────────────────────
function renderTable() {
  const panel = document.getElementById('tab-table');
  if (!panel || !panel.classList.contains('active')) return;

  const rows = filteredRows;
  const headers = currentCsvData.headers;

  // Priority columns first for known types
  const PRIORITY = {
    APEXUNEXPECTEDEXCEPTION: ['TIMESTAMP','EXCEPTION_TYPE','EXCEPTION_MESSAGE','ENTITY_NAME','USER_ID_DERIVED','RUN_TIME','CPU_TIME'],
    RESTAPI: ['TIMESTAMP','METHOD','URI','STATUS_CODE','RUN_TIME','CPU_TIME','CLIENT_IP','USER_ID_DERIVED','ERROR_CODE'],
    AURAREQUEST: ['TIMESTAMP','PAGE_APP_NAME','PAGE_CONTEXT','CONNECTED_APP_ID','STATUS_CODE','RUN_TIME','CPU_TIME','USER_ID_DERIVED'],
    LOGIN: ['TIMESTAMP','USER_ID_DERIVED','LOGIN_STATUS','CLIENT_IP','BROWSER_TYPE','PLATFORM_TYPE','APPLICATION'],
    APITOTALUSAGE: ['TIMESTAMP','API_TYPE','API_VERSION','CONNECTED_APP_ID','USER_ID_DERIVED'],
  };
  const typeKey = (currentEventType || '').toUpperCase().replace(/\s/g,'_');
  const prio = PRIORITY[typeKey] || [];
  const orderedHeaders = [...prio.filter(h => headers.includes(h)), ...headers.filter(h => !prio.includes(h))];

  const toolbar = `<div class="table-toolbar">
    <span class="table-row-count">${rows.length.toLocaleString()} rows</span>
    <button class="btn-small" id="btn-copy-csv">Copy as CSV</button>
  </div>`;

  const thead = `<thead><tr>${orderedHeaders.map(h =>
    `<th data-col="${escapeHtml(h)}" class="${sortCol===h ? 'sort-'+sortDir : ''}">${escapeHtml(h)}</th>`
  ).join('')}</tr></thead>`;

  const tbody = `<tbody>${rows.slice(0, 500).map(row => {
    const isError = parseInt(row.STATUS_CODE || 0) >= 400 || (row.LOGIN_STATUS && row.LOGIN_STATUS !== 'LOGIN_NO_ERROR' && row.LOGIN_STATUS !== 'Success');
    const isWarn  = parseInt(row.RUN_TIME || 0) > 1000;
    return `<tr class="${isError?'row-error':isWarn?'row-warn':''}" data-row='${escapeHtml(JSON.stringify(row))}'>
      ${orderedHeaders.map(h => {
        const v = row[h] ?? '';
        let cls = '';
        if (h === 'STATUS_CODE' && parseInt(v) >= 400) cls = 'td-error';
        else if (h === 'STATUS_CODE' && parseInt(v) >= 200 && parseInt(v) < 300) cls = 'td-ok';
        else if (h === 'EXCEPTION_TYPE' && v) cls = 'td-error';
        else if (h === 'LOGIN_STATUS' && v && v !== 'LOGIN_NO_ERROR' && v !== 'Success') cls = 'td-error';
        else if ((h === 'RUN_TIME' || h === 'CPU_TIME') && parseInt(v) > 1000) cls = 'td-warn';
        const isUserCol = (h === 'USER_ID_DERIVED' || h === 'USER_ID') && v;
        const display = isUserCol ? (currentUserMap[v] || v) : v;
        const tooltip = isUserCol && currentUserMap[v] ? v : display;
        return `<td class="${cls}" title="${escapeHtml(tooltip)}">${escapeHtml(display.substring(0,80))}${display.length>80?'…':''}</td>`;
      }).join('')}
    </tr>`;
  }).join('')}${rows.length>500?`<tr><td colspan="${orderedHeaders.length}" style="text-align:center;color:var(--muted);padding:12px">Showing first 500 of ${rows.length.toLocaleString()} rows — use search to narrow results</td></tr>`:''}</tbody>`;

  panel.innerHTML = toolbar + `<div class="data-table-wrap"><table class="data-table">${thead}${tbody}</table></div>`;

  // Sort on header click
  panel.querySelectorAll('.data-table th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-col');
      if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = col; sortDir = 'asc'; }
      const isNum = filteredRows.slice(0,10).every(r => r[col] === '' || !isNaN(Number(r[col])));
      filteredRows.sort((a, b) => {
        const av = isNum ? Number(a[col]||0) : (a[col]||'');
        const bv = isNum ? Number(b[col]||0) : (b[col]||'');
        return sortDir === 'asc' ? (av>bv?1:av<bv?-1:0) : (av<bv?1:av>bv?-1:0);
      });
      renderTable();
    });
  });

  // Row click → detail panel
  panel.querySelectorAll('.data-table tr[data-row]').forEach(tr => {
    tr.addEventListener('click', () => showRowDetail(JSON.parse(tr.getAttribute('data-row'))));
  });

  // Copy CSV
  document.getElementById('btn-copy-csv')?.addEventListener('click', () => {
    const csv = [orderedHeaders.join(','), ...rows.map(r => orderedHeaders.map(h => `"${(r[h]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    navigator.clipboard.writeText(csv).catch(()=>{});
    document.getElementById('btn-copy-csv').textContent = 'Copied!';
    setTimeout(()=>{ document.getElementById('btn-copy-csv').textContent = 'Copy as CSV'; }, 1500);
  });
}

// ── Row detail panel ───────────────────────────────────────────────────────
function showRowDetail(row) {
  let panel = document.getElementById('row-detail-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'row-detail-panel';
    panel.className = 'row-detail-panel';
    document.body.appendChild(panel);
  }
  panel.textContent = '';

  const title = document.createElement('div');
  title.className = 'row-detail-title';
  title.textContent = 'Row Detail';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'row-detail-close';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  title.appendChild(closeBtn);
  panel.appendChild(title);

  Object.entries(row).filter(([, v]) => v !== '').forEach(([k, v]) => {
    const field = document.createElement('div');
    field.className = 'row-detail-field';
    const key = document.createElement('div');
    key.className = 'row-detail-key';
    key.textContent = k;
    const val = document.createElement('div');
    val.className = 'row-detail-val' + (k === 'EXCEPTION_TYPE' || k === 'ERROR_CODE' ? ' val-error' : '');
    const isUserCol = (k === 'USER_ID_DERIVED' || k === 'USER_ID') && currentUserMap[v];
    val.textContent = isUserCol ? currentUserMap[v] : v;
    if (isUserCol) {
      const idSpan = document.createElement('span');
      idSpan.className = 'row-detail-subtext';
      idSpan.textContent = v;
      val.appendChild(document.createElement('br'));
      val.appendChild(idSpan);
    }
    field.appendChild(key);
    field.appendChild(val);
    panel.appendChild(field);
  });

  panel.classList.add('open');
}

// ── Charts renderer ────────────────────────────────────────────────────────
function renderCharts() {
  const panel = document.getElementById('tab-charts');
  if (!panel || !panel.classList.contains('active')) return;
  panel.innerHTML = '';

  const rows = filteredRows;
  const headers = currentCsvData.headers;

  // Timeline chart (if TIMESTAMP column present)
  if (headers.includes('TIMESTAMP')) {
    panel.appendChild(renderTimelineChart(rows));
  }

  // Bar charts for key categorical columns
  const catCols = ['STATUS_CODE','METHOD','EXCEPTION_TYPE','LOGIN_STATUS','API_TYPE','ENTITY_TYPE',
                   'QUIDDITY','ENTRY_POINT','USER_ID_DERIVED','USER_ID'].filter(c => headers.includes(c));
  catCols.forEach(col => panel.appendChild(renderBarChart(rows, col)));
}

function formatBucketLabel(key) {
  // key is like "20260620092" (YYYYMMDDThh without separator) or "2026-06-20T09"
  try {
    const norm = key.length === 11
      ? key.substring(0,4) + '-' + key.substring(4,6) + '-' + key.substring(6,8) + 'T' + key.substring(8,10) + ':00:00Z'
      : key + ':00:00Z';
    const d = new Date(norm);
    if (isNaN(d)) return key;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return key; }
}

function renderTimelineChart(rows) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-container';

  // Bucket by hour — detect format from first non-empty timestamp
  const buckets = {};
  rows.forEach(r => {
    const ts = r.TIMESTAMP || '';
    // Salesforce timestamps: "20260620092205.750" or "2026-06-20T09:22:05.000+0000"
    const hour = ts.includes('-') ? ts.substring(0, 13) : ts.substring(0, 10);
    if (hour && hour.length >= 8) buckets[hour] = (buckets[hour] || 0) + 1;
  });
  const sorted = Object.entries(buckets).sort((a,b) => a[0].localeCompare(b[0]));
  if (sorted.length < 2) {
    const msg = document.createElement('p');
    msg.style.cssText = 'color:var(--muted);font-size:0.8rem;margin:8px 0';
    msg.textContent = 'Not enough time data to chart.';
    const t = document.createElement('div');
    t.className = 'chart-title';
    t.textContent = 'Events over Time';
    wrap.appendChild(t);
    wrap.appendChild(msg);
    return wrap;
  }

  const max = Math.max(...sorted.map(e=>e[1]));
  const W = 620, H = 140, PAD_L = 36, PAD_B = 24;
  const chartW = W - PAD_L;
  const chartH = H - PAD_B;
  const bw = Math.max(2, chartW / sorted.length - 1);

  // Y-axis gridlines
  const gridLines = [0.25, 0.5, 0.75, 1].map(frac => {
    const y = PAD_B + chartH * (1 - frac) - PAD_B;
    const val = Math.round(max * frac);
    return `<line x1="${PAD_L}" y1="${y}" x2="${W}" y2="${y}" stroke="var(--border)" stroke-width="0.5" opacity="0.5"/>
            <text x="${PAD_L - 4}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${val}</text>`;
  }).join('');

  const bars = sorted.map(([key, count], i) => {
    const x = PAD_L + i * (chartW / sorted.length);
    const bh = Math.max(1, (count / max) * chartH);
    const y = chartH - bh;
    const label = formatBucketLabel(key);
    return `<rect class="chart-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--accent)" rx="1">
      <title>${label}: ${count} event${count !== 1 ? 's' : ''}</title>
    </rect>`;
  }).join('');

  const firstLabel = formatBucketLabel(sorted[0][0]);
  const lastLabel  = formatBucketLabel(sorted[sorted.length-1][0]);

  const title = document.createElement('div');
  title.className = 'chart-title';
  title.textContent = 'Events over Time';
  wrap.appendChild(title);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = gridLines + bars
    + `<text x="${PAD_L}" y="${H}" class="chart-axis-label">${escapeHtml(firstLabel)}</text>`
    + `<text x="${W}" y="${H}" text-anchor="end" class="chart-axis-label">${escapeHtml(lastLabel)}</text>`;
  wrap.appendChild(svg);
  return wrap;
}

const BAR_CHART_TITLES = {
  STATUS_CODE:     'HTTP Status Codes',
  METHOD:          'HTTP Methods',
  EXCEPTION_TYPE:  'Exception Types',
  LOGIN_STATUS:    'Login Status',
  API_TYPE:        'API Types',
  ENTITY_TYPE:     'Entity Types',
  QUIDDITY:        'Execution Types',
  ENTRY_POINT:     'Entry Points',
  USER_ID_DERIVED: 'Most Active Users',
  USER_ID:         'Most Active Users',
};

function renderBarChart(rows, col) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-container';

  let entries = topN(rows, col, 12);
  if (entries.length === 0) return wrap;

  // Resolve labels for known code columns
  const isUserCol    = col === 'USER_ID_DERIVED' || col === 'USER_ID';
  const isQuidCol    = col === 'QUIDDITY';
  if (isUserCol)  entries = entries.map(([id, n]) => [formatUser(id), n]);
  if (isQuidCol)  entries = entries.map(([code, n]) => [QUIDDITY_LABELS[code] ? QUIDDITY_LABELS[code] + ' (' + code + ')' : code, n]);

  const max     = entries[0][1];
  const labelW  = isUserCol ? 220 : 160;
  const W       = 560, barH = 22, gap = 6;
  const H       = entries.length * (barH + gap);

  const title = document.createElement('div');
  title.className = 'chart-title';
  title.textContent = BAR_CHART_TITLES[col] || col;
  wrap.appendChild(title);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H + 10);
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 10}`);

  entries.forEach(([label, count], i) => {
    const y   = i * (barH + gap);
    const bw  = Math.max(2, (count / max) * (W - labelW - 55));
    const isError = /^[4-5]\d\d$/.test(label) || label.toLowerCase().includes('fail') || label.toLowerCase().includes('error');
    const fill = isError ? 'var(--red)' : 'var(--accent)';
    const displayLabel = label.length > 28 ? label.substring(0, 27) + '…' : label;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', labelW - 6);
    t.setAttribute('y', y + barH - 5);
    t.setAttribute('text-anchor', 'end');
    t.setAttribute('class', 'chart-axis-label');
    t.textContent = displayLabel;
    const tTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tTitle.textContent = label;
    t.appendChild(tTitle);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'chart-bar');
    rect.setAttribute('x', labelW);
    rect.setAttribute('y', y);
    rect.setAttribute('width', bw.toFixed(1));
    rect.setAttribute('height', barH);
    rect.setAttribute('fill', fill);
    rect.setAttribute('rx', 2);
    const rTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    rTitle.textContent = label + ': ' + count + ' event' + (count !== 1 ? 's' : '');
    rect.appendChild(rTitle);

    const val = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    val.setAttribute('x', labelW + bw + 6);
    val.setAttribute('y', y + barH - 5);
    val.setAttribute('class', 'chart-value-label');
    val.textContent = count;

    g.appendChild(t);
    g.appendChild(rect);
    g.appendChild(val);
    svg.appendChild(g);
  });

  wrap.appendChild(svg);
  return wrap;
}

// ── Raw CSV tab ────────────────────────────────────────────────────────────
function renderRaw() {
  const panel = document.getElementById('tab-raw');
  if (!panel || !panel.classList.contains('active')) return;

  const pre     = document.getElementById('raw-log-pre');
  const search  = document.getElementById('raw-log-search');
  const countEl = document.getElementById('raw-log-count');
  const copyBtn = document.getElementById('raw-log-copy');
  if (!pre) return;

  // Only populate the pre once per log load
  if (pre.dataset.loaded !== String(currentLoadId)) {
    pre.textContent = currentCsvText;
    pre.dataset.loaded = String(currentLoadId);
    if (search) search.value = '';
  }

  const allLines = currentCsvText.split('\n');

  function updateDisplay(q) {
    const visible = q ? allLines.filter(l => l.toLowerCase().includes(q)) : allLines;
    pre.textContent = visible.join('\n');
    if (countEl) {
      countEl.textContent = visible.length === allLines.length
        ? allLines.length + ' lines'
        : visible.length + ' / ' + allLines.length + ' lines';
    }
  }

  updateDisplay('');

  if (search) {
    search.oninput = () => updateDisplay(search.value.trim().toLowerCase());
  }

  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(currentCsvText).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy all'; }, 1500);
      }).catch(() => {});
    };
  }
}
