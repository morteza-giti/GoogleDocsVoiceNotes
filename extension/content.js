// Adds a 🎙 button to every Google Docs comment box (next to Comment / Cancel).
// Clicking it opens a small recorder inside that comment box. Saving uploads the
// audio to Drive (via background.js) and puts the link into THAT comment's text.

(() => {
  const docId = (location.pathname.match(/\/document\/d\/([^/]+)/) || [])[1];
  if (!docId) return;

  const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  const toBase64 = b => new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.readAsDataURL(b);
  });

  function mount(buttonRow) {
    const box = buttonRow.closest('.docos-input');
    if (!box || box.querySelector('.vn-toggle')) return;
    const editor = box.querySelector('.docos-input-contenteditable');
    if (!editor) return;

    const toggle = document.createElement('div');
    toggle.className = 'vn-toggle';
    toggle.setAttribute('role', 'button');
    toggle.title = 'Record a voice note';
    toggle.textContent = '🎙';
    buttonRow.append(toggle);

    const panel = document.createElement('div');
    panel.className = 'vn-panel';
    panel.innerHTML = `
      <input class="vn-label" placeholder="Optional label (e.g. pronunciation)">
      <button class="vn-start">Start</button>
      <button class="vn-stop" disabled>Stop</button>
      <button class="vn-save" disabled>Save &amp; add link</button>
      <audio class="vn-player" controls hidden></audio>
      <div class="vn-status">Ready</div>
      <div class="vn-result"></div>`;
    buttonRow.after(panel);

    const $ = cls => panel.querySelector('.' + cls);
    const statusEl = $('vn-status');

    // Keep typing and clicking inside our panel from reaching Google Docs.
    ['keydown', 'keypress', 'keyup'].forEach(t => panel.addEventListener(t, e => e.stopPropagation()));
    toggle.addEventListener('mousedown', e => e.preventDefault());
    toggle.onclick = () => panel.classList.toggle('open');

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

    $('vn-save').onclick = async () => {
      $('vn-save').disabled = true;
      statusEl.textContent = 'Saving to Drive...';
      const label = $('vn-label').value.trim();
      const res = await chrome.runtime.sendMessage({
        type: 'save',
        docId,
        label,
        base64: await toBase64(blob),
        mimeType: blob.type.split(';')[0]
      });
      if (!res.ok) {
        statusEl.textContent = 'Save failed: ' + res.error;
        $('vn-save').disabled = false;
        return;
      }
      statusEl.textContent = 'Saved as: ' + res.name;
      const text = '🎙 ' + (label || 'Voice note') + ': ' + res.link + ' ';
      let inserted = false;
      if (document.contains(editor)) {
        editor.focus();
        inserted = document.execCommand('insertText', false, text);
      }
      $('vn-result').innerHTML = inserted
        ? 'Link added to your comment - press Comment to post it.'
        : '<button class="vn-copy">Copy link</button> (paste it into your comment)';
      const copy = $('vn-copy');
      if (copy) copy.onclick = () => navigator.clipboard.writeText(text).then(() => (copy.textContent = 'Copied!'));
    };
  }

  // Comment boxes appear and disappear as you use the Doc, so watch for new ones.
  let scheduled = false;
  const scan = () => {
    scheduled = false;
    document.querySelectorAll('.docos-input-buttons').forEach(mount);
  };
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
