// Talks to Google Drive on behalf of the content script.
// Flow: find the Doc's folder -> pick the next number -> upload the audio there.

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

function getToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || 'No token'));
      } else {
        resolve(token);
      }
    });
  });
}

async function drive(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: 'Bearer ' + token, ...(options.headers || {}) }
  });
  if (!res.ok) throw new Error('Drive error ' + res.status + ': ' + (await res.text()));
  return res.json();
}

const clean = s => s.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();

async function saveVoiceNote({ docId, label, base64, mimeType }) {
  const token = await getToken();

  const doc = await drive(`${DRIVE}/${docId}?fields=name,parents&supportsAllDrives=true`, token);
  const folderId = doc.parents && doc.parents[0];
  if (!folderId) throw new Error('This document has no parent folder (is it in "Shared with me"?).');

  const prefix = clean(doc.name) + ' - voice ';
  const q = `'${folderId}' in parents and trashed=false and name contains '${prefix.replace(/'/g, "\\'")}'`;
  const existing = await drive(
    `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    token
  );
  const number = String(existing.files.filter(f => f.name.startsWith(prefix)).length + 1).padStart(3, '0');
  const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
  const name = `${prefix}${number}${label ? ' - ' + clean(label) : ''}.${ext}`;

  const boundary = 'voicenote' + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
    base64 +
    `\r\n--${boundary}--`;

  const file = await drive(
    `${UPLOAD}?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    token,
    { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body }
  );
  return { name: file.name, link: file.webViewLink };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'save') return;
  saveVoiceNote(msg)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // keep the channel open for the async reply
});
