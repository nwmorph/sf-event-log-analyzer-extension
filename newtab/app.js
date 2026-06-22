// ── State ──────────────────────────────────────────────────────────────────
let orgUrl = '';
let allFiles = [];      // raw EventLogFile records from last fetch
let selectedFileId = null;
let userNames = {};     // { userId: 'Full Name' }
let keyPrefixMap = {};  // { 'abc': { label: 'Account', api: 'Account' } }

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setDefaultDateRange();
  await loadOrgUrl();
  setupFilterListeners();
});

function setDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 7);
  document.getElementById('filter-end').value   = toDateInputValue(end);
  document.getElementById('filter-start').value = toDateInputValue(start);
}

function toDateInputValue(d) {
  return d.toISOString().substring(0, 10);
}

async function loadOrgUrl() {
  // First try storage (set by content script when a SF tab was visited)
  const result = await chrome.storage.session.get('orgUrl');
  if (result.orgUrl) {
    orgUrl = result.orgUrl;
    showOrgLabel(orgUrl, null);
    return;
  }

  // Fallback: scan open tabs for a Salesforce URL directly
  const SF_PATTERN = /^https:\/\/[^/]+\.(salesforce\.com|force\.com|lightning\.force\.com|my\.salesforce\.com)/;
  const tabs = await chrome.tabs.query({});
  const sfTab = tabs.find(t => t.url && SF_PATTERN.test(t.url));
  if (sfTab) {
    try {
      const origin = new URL(sfTab.url).origin;
      orgUrl = origin;
      await chrome.storage.session.set({ orgUrl: origin });
      showOrgLabel(orgUrl, null);
    } catch { /* ignore malformed URL */ }
  }
}

function showOrgLabel(url, orgInfo) {
  const el = document.getElementById('sidebar-org');
  if (!el) return;
  try {
    const host = new URL(url).hostname;
    if (orgInfo && orgInfo.Name) {
      const subdomain = host.split('.')[0].toUpperCase();
      const instance  = orgInfo.InstanceName || '';
      const parts = [orgInfo.Name, instance, subdomain].filter(Boolean);
      el.textContent = parts.join(' · ') + (orgInfo.IsSandbox ? ' (Sandbox)' : '');
      el.title = parts.join(' · ') + (orgInfo.IsSandbox ? ' · Sandbox' : '');
    } else {
      el.textContent = host.split('.')[0] || host;
      el.title = url;
    }
  } catch {
    el.textContent = url;
  }
}

function fetchAndShowOrgInfo() {
  if (!orgUrl) return;
  chrome.runtime.sendMessage({ type: 'fetchOrgInfo', orgUrl }, (response) => {
    if (!chrome.runtime.lastError && response && response.ok && response.info) {
      showOrgLabel(orgUrl, response.info);
    }
  });
}

// ── Filter wiring ──────────────────────────────────────────────────────────
function setupFilterListeners() {
  document.getElementById('btn-refresh').addEventListener('click', doRefresh);
  document.getElementById('filter-type').addEventListener('change', renderFileList);
  document.getElementById('filter-interval').addEventListener('change', renderFileList);
}

// ── Refresh ────────────────────────────────────────────────────────────────
async function doRefresh() {
  await loadOrgUrl();

  if (!orgUrl) {
    showSidebarMessage('warning', 'No Salesforce org detected. Open a Salesforce tab and try again.');
    return;
  }

  const startDate = document.getElementById('filter-start').value || null;
  const endDate   = document.getElementById('filter-end').value   || null;

  setRefreshLoading(true);
  showMainLoading('Fetching event log files…');

  chrome.runtime.sendMessage(
    { type: 'fetchEventLogFiles', orgUrl, startDate, endDate, eventType: '' },
    (response) => {
      setRefreshLoading(false);
      if (chrome.runtime.lastError) {
        showSidebarMessage('error', 'Extension error: ' + chrome.runtime.lastError.message);
        showMainEmpty();
        return;
      }
      if (!response.ok) {
        const msg = response.error === 'ACCESS_DENIED'
          ? 'Access denied. You may not have permission to query EventLogFile, or your session has expired.'
          : (response.error || 'Unknown error fetching files.');
        showSidebarMessage('error', msg);
        showMainEmpty();
        return;
      }

      allFiles = response.data.records || [];
      populateTypeFilter(allFiles);
      renderFileList();
      showOrgLabel(orgUrl, null);
      showMainEmpty();
      fetchAndShowOrgInfo();
      prefetchUsers();
    }
  );
}

function setRefreshLoading(loading) {
  const btn = document.getElementById('btn-refresh');
  if (btn) {
    btn.disabled = loading;
    btn.textContent = loading ? '…' : '↺ Refresh';
  }
}

// ── Type filter population ─────────────────────────────────────────────────
function populateTypeFilter(files) {
  const select = document.getElementById('filter-type');
  const current = select.value;
  const types = [...new Set(files.map(f => f.EventType))].sort();

  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All types';
  select.appendChild(all);

  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    if (t === current) opt.selected = true;
    select.appendChild(opt);
  });
}

// ── File list rendering ────────────────────────────────────────────────────
function renderFileList() {
  const list     = document.getElementById('sidebar-list');
  const countEl  = document.getElementById('sidebar-file-count');
  const typeFilter     = document.getElementById('filter-type').value;
  const intervalFilter = document.getElementById('filter-interval').value;

  let files = allFiles;
  if (typeFilter)     files = files.filter(f => f.EventType === typeFilter);
  if (intervalFilter) files = files.filter(f => f.Interval  === intervalFilter);

  if (countEl) {
    countEl.textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');
  }

  list.textContent = '';   // clear safely

  if (files.length === 0) {
    list.appendChild(makePlaceholder(
      allFiles.length === 0
        ? 'Click ↺ Refresh to load event logs.'
        : 'No files match the current filters.'
    ));
    return;
  }

  // Group by EventType
  const byType = {};
  files.forEach(f => {
    if (!byType[f.EventType]) byType[f.EventType] = [];
    byType[f.EventType].push(f);
  });

  Object.keys(byType).sort().forEach(type => {
    const group = document.createElement('div');
    group.className = 'event-type-group';

    const header = document.createElement('div');
    header.className = 'event-type-header';
    const chevron = document.createElement('span');
    chevron.className = 'event-type-chevron';
    chevron.textContent = '▾';
    header.appendChild(chevron);
    const label = document.createElement('span');
    label.textContent = type;
    header.appendChild(label);
    const badge = document.createElement('span');
    badge.className = 'event-type-count';
    badge.textContent = String(byType[type].length);
    header.appendChild(badge);
    header.addEventListener('click', () => group.classList.toggle('collapsed'));
    group.appendChild(header);

    const filesDiv = document.createElement('div');
    filesDiv.className = 'event-type-files';

    byType[type].forEach(f => {
      const row = document.createElement('div');
      row.className = 'log-file-row' + (f.Id === selectedFileId ? ' active' : '');
      row.dataset.id       = f.Id;
      row.dataset.type     = f.EventType;
      row.dataset.date     = f.LogDate;
      row.dataset.interval = f.Interval || '';
      row.dataset.size     = String(f.LogFileLength || 0);

      const dateEl = document.createElement('div');
      dateEl.className = 'log-file-date';
      dateEl.textContent = formatLogDate(f.LogDate);

      const intervalEl = document.createElement('span');
      intervalEl.className = 'log-file-interval';
      intervalEl.textContent = f.Interval || '';

      const sizeEl = document.createElement('span');
      sizeEl.className = 'log-file-size';
      sizeEl.textContent = formatBytes(f.LogFileLength || 0);

      row.appendChild(dateEl);
      if (f.Interval) row.appendChild(intervalEl);
      row.appendChild(sizeEl);
      row.addEventListener('click', () => selectFile(row));
      filesDiv.appendChild(row);
    });

    group.appendChild(filesDiv);
    list.appendChild(group);
  });
}

function makePlaceholder(text) {
  const div = document.createElement('div');
  div.className = 'list-placeholder';
  const icon = document.createElement('div');
  icon.className = 'placeholder-icon';
  icon.textContent = '📋';
  const p = document.createElement('p');
  p.textContent = text;
  div.appendChild(icon);
  div.appendChild(p);
  return div;
}

function formatLogDate(isoDate) {
  if (!isoDate) return '—';
  try {
    return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return isoDate; }
}

// ── File selection + CSV download ──────────────────────────────────────────
function selectFile(rowEl) {
  const id       = rowEl.dataset.id;
  const type     = rowEl.dataset.type;
  const date     = rowEl.dataset.date;
  const interval = rowEl.dataset.interval;
  const size     = rowEl.dataset.size;

  document.querySelectorAll('.log-file-row').forEach(r => r.classList.remove('active'));
  rowEl.classList.add('active');
  selectedFileId = id;

  showMainLoading('Loading ' + type + '…');

  chrome.runtime.sendMessage(
    { type: 'fetchEventLogCsv', orgUrl, logId: id },
    (response) => {
      if (chrome.runtime.lastError) {
        showMainError('Extension error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (!response.ok) {
        showMainError(response.error || 'Failed to download log file.');
        return;
      }
      // Parse CSV properly (parseCsv is defined in main.js, loaded before app.js)
      const parsed = parseCsv(response.text);
      const headers = parsed.headers;

      const userCols   = ['USER_ID_DERIVED', 'USER_ID'].filter(n => headers.includes(n));
      const prefixCols = ['KEY_PREFIX'].filter(n => headers.includes(n));

      const ids = userCols.length > 0 ? [...new Set(
        parsed.rows.flatMap(r => userCols.map(c => r[c])).filter(Boolean)
      )] : [];

      const prefixes = prefixCols.length > 0 ? [...new Set(
        parsed.rows.flatMap(r => prefixCols.map(c => r[c])).filter(Boolean)
      )] : [];

      Promise.all([
        fetchUserNamesForIds(ids),
        fetchKeyPrefixesForValues(prefixes),
      ]).then(() => analyseEventLog(response.text, type, { date, interval, size }, userNames, keyPrefixMap));
    }
  );
}

// ── User name prefetch ─────────────────────────────────────────────────────
function prefetchUsers() {
  userNames = {};
}

// ── Key prefix lookup ──────────────────────────────────────────────────────
function fetchKeyPrefixesForValues(prefixes) {
  const unknown = prefixes.filter(p => p && !(p in keyPrefixMap));
  if (unknown.length === 0) return Promise.resolve();
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'fetchKeyPrefixes', orgUrl, prefixes: unknown }, (response) => {
      if (!chrome.runtime.lastError && response && response.ok) {
        Object.assign(keyPrefixMap, response.map);
        // Mark unfound prefixes so we don't re-query them
        unknown.forEach(p => { if (!(p in keyPrefixMap)) keyPrefixMap[p] = null; });
      }
      resolve();
    });
  });
}

function fetchUserNamesForIds(ids) {
  const unknown = ids.filter(id => id && !userNames[id]);
  if (unknown.length === 0) return Promise.resolve();
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'fetchUsers', orgUrl, ids: unknown }, (response) => {
      if (!chrome.runtime.lastError && response && response.ok) {
        Object.assign(userNames, response.map);
      }
      resolve();
    });
  });
}

// ── Main content state helpers ─────────────────────────────────────────────
function showMainEmpty() {
  document.getElementById('main-empty').style.display    = '';
  document.getElementById('main-loading').style.display  = 'none';
  document.getElementById('main-error').style.display    = 'none';
  document.getElementById('main-analysis').style.display = 'none';
}

function showMainLoading(msg) {
  document.getElementById('main-empty').style.display    = 'none';
  document.getElementById('main-loading').style.display  = '';
  document.getElementById('main-error').style.display    = 'none';
  document.getElementById('main-analysis').style.display = 'none';
  const msgEl = document.getElementById('loading-msg');
  if (msgEl) msgEl.textContent = msg || 'Loading…';
}

function showMainError(msg) {
  document.getElementById('main-empty').style.display    = 'none';
  document.getElementById('main-loading').style.display  = 'none';
  document.getElementById('main-analysis').style.display = 'none';
  const errEl = document.getElementById('main-error');
  errEl.style.display = '';
  errEl.textContent = '';
  const icon = document.createElement('div');
  icon.className = 'error-icon';
  icon.textContent = '⚠️';
  const p = document.createElement('p');
  p.textContent = msg;
  errEl.appendChild(icon);
  errEl.appendChild(p);
}

function showSidebarMessage(level, msg) {
  const list    = document.getElementById('sidebar-list');
  const countEl = document.getElementById('sidebar-file-count');
  if (countEl) countEl.textContent = '';

  list.textContent = '';
  const div = document.createElement('div');
  div.className = 'list-placeholder' + (level === 'error' ? ' list-error' : '');
  const icon = document.createElement('div');
  icon.className = 'placeholder-icon';
  icon.textContent = level === 'error' ? '⚠️' : '📋';
  const p = document.createElement('p');
  p.textContent = msg;
  div.appendChild(icon);
  div.appendChild(p);
  list.appendChild(div);
}
