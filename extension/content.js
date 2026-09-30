// Adds a floating mic button to every Google Doc. Records, saves to Drive via
// the background script, then tries to drop the link into the open comment box.

(() => {
  const docId = (location.pathname.match(/\/document\/d\/([^/]+)/) || [])[1];
  if (!docId) return;

  const fab = document.createElement('button');
  fab.id = 'vn-fab';
  fab.textContent = '🎙';
  fab.title = 'Voice note';

  const panel = document.createElement('div');
  panel.id = 'vn-panel';
  panel.innerHTML = `
    <b>Voice note</b><br>
    <input id="vn-label" placeholder="Optional label (e.g. pronunciation)">
    <button id="vn-start">Start</button><button id="vn-stop" disabled>Stop</button>
    <button id="vn-save" disabled>Save to Drive</button>
    <audio id="vn-player" controls hidden></audio>
    <div id="vn-status">Ready</div>
    <div id="vn-result"></div>`;
  document.body.append(fab, panel);

  const $ = id => panel.querySelector('#' + id);
  const statusEl = $('vn-status');
  fab.onclick = () => panel.classList.toggle('open');

  // Remember the last comment box the user clicked in, so we can paste the link there.
  let lastEditable = null;
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (panel.contains(el) || fab.contains(el)) return;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') lastEditable = el;
  });

  const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  let recorder, chunks = [], timer, seconds = 0, blob;

  $('vn-start').onclick = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        blob = new Blob(chunks, { type: recorder.mimeType });
        $('vn-player').src = URL.createObjectURL(blob);
        $('vn-player').hidden = false;
        $('vn-save').disabled = false;
        statusEl.textContent = 'Recorded ' + fmt(seconds) + ' - check it, then save.';
      };
      recorder.start();
      seconds = 0;
      timer = setInterval(() => (statusEl.textContent = 'Recording: ' + fmt(++seconds)), 1000);
      statusEl.textContent = 'Recording: 00:00';
      $('vn-player').hidden = true;
      $('vn-save').disabled = true;
      $('vn-start').disabled = true;
      $('vn-stop').disabled = false;
    } catch (err) {
      statusEl.textContent = 'Microphone error: ' + err.name + ' - ' + err.message;
    }
  };

  $('vn-stop').onclick = () => {
    clearInterval(timer);
    recorder.stop();
    $('vn-start').disabled = false;
    $('vn-stop').disabled = true;
  };

  const toBase64 = b => new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.readAsDataURL(b);
  });

  $('vn-save').onclick = async () => {
    $('vn-save').disabled = true;
    statusEl.textContent = 'Saving to Drive...';
    const res = await chrome.runtime.sendMessage({
      type: 'save',
      docId,
      label: $('vn-label').value,
      base64: await toBase64(blob),
      mimeType: blob.type.split(';')[0]
    });
    if (!res.ok) {
      statusEl.textContent = 'Save failed: ' + res.error;
      $('vn-save').disabled = false;
      return;
    }
    statusEl.textContent = 'Saved as: ' + res.name;
    const text = '🎙 ' + res.link;
    let inserted = false;
    if (lastEditable && document.contains(lastEditable)) {
      lastEditable.focus();
      inserted = document.execCommand('insertText', false, text);
    }
    $('vn-result').innerHTML = inserted
      ? 'Link added to your comment box.'
      : '<button id="vn-copy">Copy link</button> (paste it into your comment)';
    const copy = $('vn-copy');
    if (copy) copy.onclick = () => navigator.clipboard.writeText(text).then(() => (copy.textContent = 'Copied!'));
  };
})();
