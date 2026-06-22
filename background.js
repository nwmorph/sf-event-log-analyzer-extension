const NEWTAB_URL = chrome.runtime.getURL('newtab/index.html');
const API_VERSION = 'v65.0';
const csvCache = {};

chrome.action.onClicked.addListener(async (tab) => {
  const existing = await chrome.tabs.query({ url: NEWTAB_URL });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: NEWTAB_URL });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'orgDetected' && message.orgUrl) {
    chrome.storage.session.set({ orgUrl: message.orgUrl });
    return;
  }

  if (message.type === 'fetchEventLogFiles') {
    fetchEventLogFiles(message.orgUrl, message.startDate, message.endDate, message.eventType)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetchEventLogCsv') {
    fetchEventLogCsv(message.orgUrl, message.logId)
      .then(text => sendResponse({ ok: true, text }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'fetchUsers') {
    fetchUsers(message.orgUrl, message.ids)
      .then(map => sendResponse({ ok: true, map }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── URL helpers ────────────────────────────────────────────────────────────
function toApiUrl(orgUrl) {
  try {
    const host = new URL(orgUrl).hostname;
    if (host.endsWith('.lightning.force.com')) {
      return `https://${host.replace('.lightning.force.com', '.my.salesforce.com')}`;
    }
    if (host.endsWith('.visual.force.com')) {
      return `https://${host.replace('.visual.force.com', '.my.salesforce.com')}`;
    }
    return orgUrl;
  } catch { return orgUrl; }
}

async function getSessionToken(orgUrl) {
  const apiUrl = toApiUrl(orgUrl);
  for (const url of [apiUrl, orgUrl]) {
    const cookie = await chrome.cookies.get({ url, name: 'sid' });
    if (cookie) return cookie.value;
    const fb = await chrome.cookies.get({ url, name: 'sidCommunity' });
    if (fb) return fb.value;
  }
  throw new Error('Not logged in to this Salesforce org. Please log in and try again.');
}

// ── API functions ──────────────────────────────────────────────────────────
async function fetchEventLogFiles(orgUrl, startDate, endDate, eventType) {
  const sid = await getSessionToken(orgUrl);
  const apiUrl = toApiUrl(orgUrl);

  let where = '';
  const conditions = [];
  if (startDate) conditions.push(`LogDate >= ${startDate}T00:00:00Z`);
  if (endDate)   conditions.push(`LogDate <= ${endDate}T23:59:59Z`);
  if (eventType) conditions.push(`EventType = '${eventType.replace(/'/g, "\\'")}'`);
  if (conditions.length) where = `WHERE ${conditions.join(' AND ')}`;

  const q = encodeURIComponent(
    `SELECT Id, EventType, LogDate, LogFileLength, Interval, Sequence, CreatedDate
     FROM EventLogFile
     ${where}
     ORDER BY LogDate DESC, EventType ASC
     LIMIT 1000`
  );

  const res = await fetch(`${apiUrl}/services/data/${API_VERSION}/query/?q=${q}`, {
    headers: { 'Authorization': `Bearer ${sid}` }
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 || res.status === 401) throw new Error('ACCESS_DENIED');
    throw new Error(`API error ${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

async function fetchEventLogCsv(orgUrl, logId) {
  if (csvCache[logId]) return csvCache[logId];

  const sid = await getSessionToken(orgUrl);
  const apiUrl = toApiUrl(orgUrl);
  const url = `${apiUrl}/services/data/${API_VERSION}/sobjects/EventLogFile/${logId}/LogFile`;

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${sid}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Download error ${res.status}: ${text.substring(0, 200)}`);
  }
  const text = await res.text();
  csvCache[logId] = text;
  return text;
}

async function fetchUsers(orgUrl, ids) {
  if (!ids || ids.length === 0) return {};
  const sid = await getSessionToken(orgUrl);
  const apiUrl = toApiUrl(orgUrl);
  const idList = ids.slice(0, 200).map(id => `'${id}'`).join(',');
  const q = encodeURIComponent(`SELECT Id, Name FROM User WHERE Id IN (${idList}) LIMIT 200`);
  const res = await fetch(`${apiUrl}/services/data/${API_VERSION}/query/?q=${q}`, {
    headers: { 'Authorization': `Bearer ${sid}` }
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map = {};
  (data.records || []).forEach(u => { map[u.Id] = u.Name; });
  return map;
}
