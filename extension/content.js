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

  // Turns the browser's recording (webm) into a mono 64 kbps MP3, all inside the browser.
  async function toMp3(recording) {
    const ctx = new AudioContext();
    let audio;
    try {
      audio = await ctx.decodeAudioData(await recording.arrayBuffer());
    } finally {
      ctx.close();
    }
    const samples = audio.getChannelData(0);
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      pcm[i] = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
    }
    const encoder = new lamejs.Mp3Encoder(1, audio.sampleRate, 64);
    const parts = [];
    for (let i = 0; i < pcm.length; i += 1152) {
      const chunk = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
      if (chunk.length) parts.push(chunk);
    }
    parts.push(encoder.flush());
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // Google's own buttons are <div>s, so "disabled" is a CSS class, not a property.
  const isOff = el => el.classList.contains('jfk-button-disabled');
  const setOn = (el, on) => {
    el.classList.toggle('jfk-button-disabled', !on);
    el.setAttribute('aria-disabled', String(!on));
  };

  // Google's "mic" icon (Material Symbols).
  const MIC_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

  function mount(buttonRow) {
    const box = buttonRow.closest('.docos-input');
    if (!box || box.querySelector('.vn-toggle')) return;
    const editor = box.querySelector('.docos-input-contenteditable');
    if (!editor) return;

    // Reuse Docs' own button classes so everything looks native.
    const toggle = document.createElement('div');
    toggle.className = 'vn-toggle';
    toggle.setAttribute('role', 'button');
    toggle.setAttribute('aria-label', 'Record a voice note');
    toggle.dataset.tooltip = 'Record a voice note';
    toggle.innerHTML = MIC_ICON;
    buttonRow.append(toggle);

    const panel = document.createElement('div');
    panel.className = 'vn-panel';
    panel.innerHTML = `
      <input class="vn-label" placeholder="Label (optional)">
      <div class="vn-buttons">
        <div role="button" class="goog-inline-block jfk-button jfk-button-standard vn-start">Start</div>
        <div role="button" class="goog-inline-block jfk-button jfk-button-standard vn-stop jfk-button-disabled">Stop</div>
        <div role="button" class="goog-inline-block jfk-button jfk-button-action vn-save jfk-button-disabled">Add to comment</div>
      </div>
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
    const savedIds = [];

    // Cancelling a draft comment discards the audio that was saved for it.
    box.addEventListener('click', e => {
      if (!e.target.closest('.docos-input-cancel')) return;
      savedIds.splice(0).forEach(fileId => chrome.runtime.sendMessage({ type: 'trash', fileId }));
    }, true);

    $('vn-start').onclick = async () => {
      if (isOff($('vn-start'))) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        chunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          const raw = new Blob(chunks, { type: recorder.mimeType });
          statusEl.textContent = 'Converting to MP3...';
          let note = '';
          try {
            blob = await toMp3(raw);
          } catch (err) {
            blob = raw;
            note = ' (MP3 conversion failed, the original format will be saved)';
          }
          $('vn-player').src = URL.createObjectURL(blob);
          $('vn-player').hidden = false;
          setOn($('vn-save'), true);
          statusEl.textContent = 'Recorded ' + fmt(seconds) + ' - check it, then save.' + note;
        };
        recorder.start();
        seconds = 0;
        timer = setInterval(() => (statusEl.textContent = 'Recording: ' + fmt(++seconds)), 1000);
        statusEl.textContent = 'Recording: 00:00';
        $('vn-player').hidden = true;
        setOn($('vn-save'), false);
        setOn($('vn-start'), false);
        setOn($('vn-stop'), true);
      } catch (err) {
        statusEl.textContent = 'Microphone error: ' + err.name + ' - ' + err.message;
      }
    };

    $('vn-stop').onclick = () => {
      if (isOff($('vn-stop'))) return;
      clearInterval(timer);
      recorder.stop();
      setOn($('vn-start'), true);
      setOn($('vn-stop'), false);
    };

    $('vn-save').onclick = async () => {
      if (isOff($('vn-save'))) return;
      setOn($('vn-save'), false);
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
        setOn($('vn-save'), true);
        return;
      }
      savedIds.push(res.id);
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

  // Audio is fetched through the background script (it holds the Google sign-in)
  // and played from a local blob, so it works without opening Drive.
  const audioCache = new Map();
  function getAudioUrl(fileId) {
    if (!audioCache.has(fileId)) {
      audioCache.set(fileId, chrome.runtime.sendMessage({ type: 'audio', fileId }).then(res => {
        if (!res.ok) throw new Error(res.error);
        const bytes = Uint8Array.from(atob(res.base64), c => c.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: res.mimeType }));
      }));
    }
    return audioCache.get(fileId);
  }

  // Put a real audio player inside any posted voice-note comment.
  function addInlinePlayer(body) {
    if (body.querySelector('.vn-inline-wrap') || !body.textContent.includes('🎙')) return;
    const hrefs = [...body.querySelectorAll('a')].map(a => a.href).join(' ');
    const id = ((body.textContent + ' ' + hrefs).match(/drive\.google\.com\/file\/d\/([\w-]+)/) || [])[1];
    if (!id) return;

    const wrap = document.createElement('div');
    wrap.className = 'vn-inline-wrap';
    wrap.textContent = 'Loading audio...';
    body.append(wrap);

    getAudioUrl(id).then(url => {
      const audio = document.createElement('audio');
      audio.className = 'vn-inline';
      audio.controls = true;
      audio.src = url;
      wrap.textContent = '';
      wrap.append(audio);
    }).catch(err => {
      audioCache.delete(id);
      wrap.textContent = 'Could not load audio: ' + err.message;
    });
  }

  // When a voice-note comment is deleted in Docs, move its audio file to the Drive trash.
  const voiceIdsIn = el => {
    const text = el.textContent + ' ' + [...el.querySelectorAll('a')].map(a => a.href).join(' ');
    return [...text.matchAll(/drive\.google\.com\/file\/d\/([\w-]+)/g)].map(m => m[1]);
  };

  let lastClick = null; // the comment the user last clicked inside
  document.addEventListener('click', e => {
    const t = e.target;
    const thread = t.closest('.docos-anchoreddocoview, .docos-docoview-tesla-conflict');
    if (thread) {
      lastClick = { thread, reply: t.closest('.docos-replyview') };
      return;
    }
    const item = t.closest('[role="menuitem"], .goog-menuitem');
    if (item && lastClick && lastClick.reply && /^delete/i.test(item.textContent.trim())) {
      handleDelete(lastClick);
    }
    lastClick = null;
  }, true);

  function handleDelete({ thread, reply }) {
    // Deleting the first comment deletes the whole discussion; otherwise just that reply.
    const replies = reply.classList.contains('docos-replyview-first')
      ? [...thread.querySelectorAll('.docos-replyview')]
      : [reply];
    const ids = new Set();
    replies.filter(r => r.textContent.includes('🎙')).forEach(r => voiceIdsIn(r).forEach(id => ids.add(id)));
    if (!ids.size) return;

    // Only act once the comment has really disappeared (the user may cancel a confirmation).
    let tries = 0;
    const timer = setInterval(() => {
      if (++tries > 16) return clearInterval(timer);
      if (!replies.every(r => !r.isConnected)) return;
      clearInterval(timer);
      const stillShown = [...document.querySelectorAll('.docos-replyview')].map(r => r.textContent + voiceIdsIn(r)).join(' ');
      ids.forEach(fileId => {
        if (!stillShown.includes(fileId)) chrome.runtime.sendMessage({ type: 'trash', fileId });
      });
    }, 500);
  }

  // Comment boxes appear and disappear as you use the Doc, so watch for new ones.
  let scheduled = false;
  const scan = () => {
    scheduled = false;
    document.querySelectorAll('.docos-input-buttons').forEach(mount);
    document.querySelectorAll('.docos-replyview-body').forEach(addInlinePlayer);
  };
  new MutationObserver(() => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
