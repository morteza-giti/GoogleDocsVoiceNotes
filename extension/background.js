// Talks to Google Drive on behalf of the content script.
// Flow: find the Doc's folder -> pick the next number -> upload the audio there.

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

// Google OAuth "Web application" client ID (see README). Works in Chrome and Edge.
const CLIENT_ID = '421620428538-ducjs7krpape0da7slk0ggiqc7ofuj5i.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive';

function signIn(interactive) {
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?response_type=token' +
    '&client_id=' + encodeURIComponent(CLIENT_ID) +
    '&redirect_uri=' + encodeURIComponent(chrome.identity.getRedirectURL()) +
    '&scope=' + encodeURIComponent(SCOPE);
  return chrome.identity.launchWebAuthFlow({ url, interactive }).then(redirect => {
    const params = new URLSearchParams(new URL(redirect).hash.slice(1));
    return { token: params.get('access_token'), expires: Date.now() + (Number(params.get('expires_in')) - 60) * 1000 };
  });
}

// Reuse the saved token until it expires, then sign in again (silently if possible).
async function getToken() {
  const { auth } = await chrome.storage.local.get('auth');
  if (auth && auth.expires > Date.now()) return auth.token;
  let fresh;
  try {
    fresh = await signIn(false);
  } catch {
    fresh = await signIn(true);
  }
  await chrome.storage.local.set({ auth: fresh });
  return fresh.token;
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

async function fetchAudio(fileId) {
  const token = await getToken();
  const res = await fetch(`${DRIVE}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) throw new Error('Drive error ' + res.status);
  const type = (res.headers.get('content-type') || '').split(';')[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const isMedia = type.startsWith('audio/') || type.startsWith('video/');
  return { base64: btoa(binary), mimeType: isMedia ? type : 'audio/webm' };
}

const handlers = { save: saveVoiceNote, audio: msg => fetchAudio(msg.fileId) };

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg.type];
  if (!handler) return;
  handler(msg)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // keep the channel open for the async reply
});
