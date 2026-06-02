// hush — vanilla frontend
// Loads ./config.json for WS URL + ICE servers.

const cfg = await fetch('./config.json').then(r => r.json());
const ICE = { iceServers: cfg.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }] };

// ---------- STATE ----------
const state = {
  ws: null, room: null, name: '', peerId: null, adminId: null,
  peers: new Map(), settings: {},
  callPCs: new Map(), localStream: null, callKind: null,
  filePCs: new Map(), incoming: new Map(),
};
const $ = (id) => document.getElementById(id);
const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2400); };

// ---------- THEME ----------
function applyTheme(mode) {
  document.documentElement.classList.toggle('light', mode === 'light');
  localStorage.setItem('hush:theme', mode);
  const sel = $('themeSelect'); if (sel) sel.value = mode;
}
applyTheme(localStorage.getItem('hush:theme') || 'dark');
const toggleTheme = () => applyTheme(document.documentElement.classList.contains('light') ? 'dark' : 'light');
$('themeBtn').onclick = toggleTheme;
$('themeBtn2').onclick = toggleTheme;
$('themeSelect').onchange = (e) => applyTheme(e.target.value);

// ---------- SOUNDS ----------
let actx = null; const sndOn = () => localStorage.getItem('hush:sounds') !== '0';
function tone(f, d, dl = 0, type = 'sine') {
  if (!sndOn()) return;
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
  if (actx.state === 'suspended') actx.resume();
  const s = actx.currentTime + dl, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, s);
  g.gain.linearRampToValueAtTime(0.18, s + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, s + d);
  o.connect(g).connect(actx.destination); o.start(s); o.stop(s + d + 0.05);
}
const sfx = { send: () => { tone(880, .08); tone(1320, .1, .05); }, recv: () => { tone(660, .09); tone(990, .12, .06); }, join: () => { tone(523, .1); tone(784, .15, .08); }, leave: () => { tone(784, .1); tone(523, .15, .08); }, call: () => { tone(440, .2, 0, 'triangle'); tone(440, .2, .4, 'triangle'); } };
$('soundsBox').checked = sndOn();
$('soundsBox').onchange = (e) => localStorage.setItem('hush:sounds', e.target.checked ? '1' : '0');

// ---------- ROUTER ----------
function parseRoute() {
  const q = location.search;
  if (q && q.length > 1) return decodeURIComponent(q.slice(1).split('&')[0].split('=')[0]).toLowerCase();
  if (location.hash.startsWith('#room=')) return decodeURIComponent(location.hash.slice(6)).toLowerCase();
  return null;
}
const savedName = localStorage.getItem('hush:name') || '';
if (savedName) { $('nameInput').value = savedName; $('rememberBox').checked = true; }
const presetRoom = parseRoute();
if (presetRoom) $('roomInput').value = presetRoom;

$('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nameInput').value.trim();
  const room = $('roomInput').value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!name || !room) return;
  if ($('rememberBox').checked) localStorage.setItem('hush:name', name); else localStorage.removeItem('hush:name');
  history.replaceState(null, '', '?' + encodeURIComponent(room));
  enterRoom(room, name);
});

// auto-enter if name remembered + room in URL
if (presetRoom && savedName) enterRoom(presetRoom, savedName);

// ---------- ENTER ROOM ----------
function enterRoom(room, name) {
  state.room = room; state.name = name;
  $('landing').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('roomLabel').textContent = '#' + room;
  document.title = `#${room} — hush`;
  connectWS();
}

function connectWS() {
  const url = cfg.wsUrl;
  const ws = new WebSocket(url);
  state.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room: state.room, name: state.name, peerId: state.peerId || undefined }));
  };
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => { toast('Disconnected. Reconnecting…'); setTimeout(connectWS, 1500); };
  ws.onerror = () => { /* surfaced by onclose */ };
}
function send(o) { try { state.ws.send(JSON.stringify(o)); } catch { } }

// ---------- HANDLERS ----------
function handle(m) {
  switch (m.type) {
    case 'joined':
      state.peerId = m.peerId; state.adminId = m.adminId; state.settings = m.settings;
      $('messages').innerHTML = '';
      (m.history || []).forEach(renderMessage);
      refreshSettings();
      break;
    case 'presence':
      state.peers = new Map(m.peers.map(p => [p.id, p]));
      state.adminId = m.adminId; state.settings = m.settings;
      renderMembers(); refreshSettings();
      break;
    case 'system':
      renderSystem(m.text); if (/joined$/.test(m.text)) sfx.join(); else if (/left$/.test(m.text)) sfx.leave();
      break;
    case 'msg':
      renderMessage(m); if (m.from !== state.peerId) sfx.recv();
      break;
    case 'history':
      $('messages').innerHTML = ''; (m.messages || []).forEach(renderMessage); break;
    case 'signal':
      handleSignal(m.from, m.payload); break;
    case 'peerLeft':
      hangupPeer(m.peerId); break;
    case 'error':
      toast(m.error); break;
  }
}

// ---------- RENDER ----------
function renderMembers() {
  const list = $('memberList'); list.innerHTML = '';
  const peers = Array.from(state.peers.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  $('memberCount').textContent = peers.length;
  peers.forEach(p => {
    const li = document.createElement('li');
    const crown = p.id === state.adminId ? '<span class="crown" title="Admin">♛</span>' : '';
    const you = p.id === state.peerId ? '<span class="you">you</span>' : '';
    li.innerHTML = `${crown}<span>${escapeHTML(p.name)}</span>${you}`;
    list.appendChild(li);
  });
  // transfer select
  const ts = $('transferSelect'); ts.innerHTML = '';
  peers.filter(p => p.id !== state.peerId).forEach(p => {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; ts.appendChild(o);
  });
}
function renderSystem(text) {
  const el = document.createElement('div'); el.className = 'msg system';
  el.innerHTML = `<div class="bubble">${escapeHTML(text)}</div>`;
  $('messages').appendChild(el); scrollChat();
}
function renderMessage(m) {
  if (m.type === 'system') return renderSystem(m.text);
  const me = m.from === state.peerId;
  const wrap = document.createElement('div'); wrap.className = 'msg ' + (me ? 'me' : 'them');
  wrap.dataset.id = m.id;
  const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  let content = '';
  if (m.kind === 'voice' && m.file?.dataUrl) {
    content = `<audio controls preload="metadata" src="${m.file.dataUrl}"></audio>`;
  } else if (m.file?.dataUrl && m.file.mime?.startsWith('image/')) {
    content = `<img src="${m.file.dataUrl}" alt="${escapeHTML(m.file.name)}" />`;
  } else if (m.file?.dataUrl && m.file.mime?.startsWith('video/')) {
    content = `<video controls preload="metadata" src="${m.file.dataUrl}"></video>`;
  } else if (m.file?.dataUrl && m.file.mime?.startsWith('audio/')) {
    content = `<audio controls preload="metadata" src="${m.file.dataUrl}"></audio>`;
  } else if (m.file?.dataUrl) {
    content = `<div class="file">📄 <a href="${m.file.dataUrl}" download="${escapeHTML(m.file.name)}">${escapeHTML(m.file.name)}</a> <span class="muted small">${fmtSize(m.file.size)}</span></div>`;
  } else if (m.file?.transferId) {
    content = `<div class="file" id="ft-${m.file.transferId}">📦 ${escapeHTML(m.file.name)} <span class="muted small">${fmtSize(m.file.size)}</span><div class="progress"><span></span></div></div>`;
  }
  if (m.text) content = `${escapeHTML(m.text)}${content ? '<br/>' + content : ''}`;
  wrap.innerHTML = `<div class="meta">${me ? 'You' : escapeHTML(m.fromName || '?')} · ${time}</div><div class="bubble">${content || ''}</div>`;
  $('messages').appendChild(wrap); scrollChat();
}
function scrollChat() { const el = $('messages'); el.scrollTop = el.scrollHeight; }
function escapeHTML(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtSize(n) { if (!n) return ''; if (n < 1024) return n + 'B'; if (n < 1048576) return (n / 1024).toFixed(1) + 'KB'; return (n / 1048576).toFixed(1) + 'MB'; }

// ---------- COMPOSE ----------
$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('textInput').value.trim(); if (!t) return;
  send({ type: 'msg', kind: 'text', text: t });
  $('textInput').value = ''; sfx.send();
});
$('attachBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  for (const f of e.target.files) await sendFile(f);
  e.target.value = '';
};
async function sendFile(file) {
  const inlineLimit = 200 * 1024;
  if (file.size <= inlineLimit) {
    const dataUrl = await blobToDataURL(file);
    send({ type: 'msg', kind: 'file', file: { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl } });
    sfx.send();
    return;
  }
  // P2P chunked to all peers
  const transferId = 'ft_' + Math.random().toString(36).slice(2, 10);
  const targets = Array.from(state.peers.keys()).filter(id => id !== state.peerId);
  if (!targets.length) { toast('No one else in room'); return; }
  send({ type: 'msg', kind: 'file', file: { name: file.name, mime: file.type, size: file.size, transferId } });
  await Promise.all(targets.map(t => sendFileToPeer(t, file, transferId)));
}
function blobToDataURL(b) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }

// ---------- VOICE RECORDING ----------
let rec = null, recChunks = [], recStart = 0;
const micBtn = $('micBtn');
function pickMime() {
  const opts = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const m of opts) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
async function startRec() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = pickMime();
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recChunks = []; recStart = Date.now();
    rec.ondataavailable = (e) => { if (e.data?.size) recChunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recChunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size < 1000) return;
      const dur = (Date.now() - recStart) / 1000;
      const dataUrl = await blobToDataURL(blob);
      send({ type: 'msg', kind: 'voice', duration: dur, file: { name: `voice-${Date.now()}.webm`, mime: blob.type, size: blob.size, dataUrl } });
      sfx.send();
    };
    rec.start();
    micBtn.classList.add('recording'); micBtn.textContent = '⏺';
  } catch (e) { toast('Mic permission denied'); }
}
function stopRec() {
  if (!rec) return;
  try { rec.stop(); } catch { }
  rec = null;
  micBtn.classList.remove('recording'); micBtn.textContent = '🎤';
}
// hold to record (touch + mouse)
['mousedown', 'touchstart'].forEach(ev => micBtn.addEventListener(ev, (e) => { e.preventDefault(); startRec(); }));
['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => micBtn.addEventListener(ev, (e) => { e.preventDefault(); stopRec(); }));

// ---------- SIDEBAR / SETTINGS DRAWER ----------
$('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
$('settingsBtn').onclick = () => $('settingsDrawer').classList.remove('hidden');
$('closeSettings').onclick = () => $('settingsDrawer').classList.add('hidden');

function refreshSettings() {
  const isAdmin = state.adminId === state.peerId;
  $('retentionInput').value = state.settings.messageRetentionMinutes ?? 1440;
  $('emptyResetInput').value = state.settings.emptyResetMinutes ?? 10;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('locked', !isAdmin));
  $('adminHint').textContent = isAdmin ? 'You are the admin.' : 'Only admins can change these.';
}
$('saveSettings').onclick = () => {
  if (state.adminId !== state.peerId) return toast('Admin only');
  send({ type: 'updateSettings',
    messageRetentionMinutes: parseInt($('retentionInput').value) || 0,
    emptyResetMinutes: parseInt($('emptyResetInput').value) || 0,
  });
  toast('Settings saved');
};
$('clearHistoryBtn').onclick = () => { if (state.adminId === state.peerId && confirm('Clear chat history for everyone?')) send({ type: 'clearHistory' }); };
$('transferBtn').onclick = () => {
  if (state.adminId !== state.peerId) return toast('Admin only');
  const to = $('transferSelect').value; if (!to) return;
  send({ type: 'transferAdmin', to });
};

// ---------- WEBRTC CALLS ----------
$('callAudioBtn').onclick = () => startCall('audio');
$('callVideoBtn').onclick = () => startCall('video');
$('endCallBtn').onclick = () => endCall();
$('muteBtn').onclick = () => {
  if (!state.localStream) return;
  const tr = state.localStream.getAudioTracks()[0]; if (!tr) return;
  tr.enabled = !tr.enabled; $('muteBtn').textContent = tr.enabled ? '🎙 Mute' : '🔇 Muted';
};
$('vidBtn').onclick = () => {
  if (!state.localStream) return;
  const tr = state.localStream.getVideoTracks()[0]; if (!tr) return;
  tr.enabled = !tr.enabled; $('vidBtn').textContent = tr.enabled ? '📷 Video' : '🚫 Video off';
};

async function startCall(kind) {
  if (state.localStream) return;
  try {
    state.callKind = kind;
    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: kind === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 } } : false,
    });
  } catch { toast('Camera/mic permission denied'); return; }
  $('callBar').classList.remove('hidden');
  addVideo('self', state.localStream, true);
  sfx.call();
  for (const id of state.peers.keys()) if (id !== state.peerId) await dialPeer(id);
}
function endCall() {
  state.localStream?.getTracks().forEach(t => t.stop()); state.localStream = null;
  state.callPCs.forEach((pc, id) => { try { pc.close(); } catch { }; send({ type: 'signal', to: id, payload: { kind: 'hangup', purpose: 'call' } }); });
  state.callPCs.clear();
  $('videos').innerHTML = ''; $('callBar').classList.add('hidden'); state.callKind = null;
}
function hangupPeer(id) {
  const pc = state.callPCs.get(id); if (pc) { try { pc.close(); } catch { }; state.callPCs.delete(id); }
  const v = document.getElementById('vid-' + id); if (v) v.remove();
}
function addVideo(id, stream, muted = false) {
  let v = document.getElementById('vid-' + id);
  if (!v) { v = document.createElement('video'); v.id = 'vid-' + id; v.autoplay = true; v.playsInline = true; if (muted) v.muted = true; $('videos').appendChild(v); }
  v.srcObject = stream;
}
function createCallPC(peerId) {
  const pc = new RTCPeerConnection(ICE);
  state.callPCs.set(peerId, pc);
  state.localStream?.getTracks().forEach(t => pc.addTrack(t, state.localStream));
  pc.onicecandidate = (e) => e.candidate && send({ type: 'signal', to: peerId, payload: { kind: 'ice', purpose: 'call', candidate: e.candidate.toJSON() } });
  const remote = new MediaStream();
  pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach(t => remote.addTrack(t)); addVideo(peerId, remote); };
  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) hangupPeer(peerId); };
  return pc;
}
async function dialPeer(peerId) {
  const pc = createCallPC(peerId);
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  send({ type: 'signal', to: peerId, payload: { kind: 'offer', purpose: 'call', sdp: offer } });
}

// ---------- FILE TRANSFER (WebRTC) ----------
async function sendFileToPeer(peerId, file, transferId) {
  const pc = new RTCPeerConnection(ICE);
  const dc = pc.createDataChannel('file', { ordered: true });
  state.filePCs.set(peerId + ':' + transferId, { pc, dc });
  pc.onicecandidate = (e) => e.candidate && send({ type: 'signal', to: peerId, payload: { kind: 'ice', purpose: 'file', candidate: e.candidate.toJSON(), transferId } });
  dc.binaryType = 'arraybuffer';
  dc.bufferedAmountLowThreshold = 256 * 1024;
  const CHUNK = 16 * 1024;
  let sent = 0;
  dc.onopen = async () => {
    const buf = await file.arrayBuffer();
    while (sent < buf.byteLength) {
      if (dc.bufferedAmount > 1024 * 1024) await new Promise(r => dc.onbufferedamountlow = () => r());
      const end = Math.min(sent + CHUNK, buf.byteLength);
      dc.send(buf.slice(sent, end)); sent = end;
      updateProgress(transferId, sent / buf.byteLength);
    }
    dc.send('__END__');
    setTimeout(() => { try { pc.close(); } catch { }; state.filePCs.delete(peerId + ':' + transferId); }, 2000);
  };
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  send({ type: 'signal', to: peerId, payload: { kind: 'offer', purpose: 'file', sdp: offer, transferId, meta: { name: file.name, mime: file.type, size: file.size } } });
}
function updateProgress(tid, ratio) {
  const el = document.getElementById('ft-' + tid); if (!el) return;
  const bar = el.querySelector('.progress > span'); if (bar) bar.style.width = (ratio * 100).toFixed(0) + '%';
}

async function handleSignal(from, payload) {
  if (!payload) return;
  if (payload.kind === 'hangup') return hangupPeer(from);
  if (payload.purpose === 'call') return handleCallSignal(from, payload);
  if (payload.purpose === 'file') return handleFileSignal(from, payload);
}
async function handleCallSignal(from, p) {
  if (p.kind === 'offer') {
    if (!state.localStream) {
      // auto-accept by joining call w/ same kind (audio default)
      const kind = (p.sdp?.sdp || '').includes('m=video') ? 'video' : 'audio';
      try {
        state.callKind = kind;
        state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
        $('callBar').classList.remove('hidden'); addVideo('self', state.localStream, true); sfx.call();
      } catch { return; }
    }
    const pc = createCallPC(from);
    await pc.setRemoteDescription(p.sdp);
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    send({ type: 'signal', to: from, payload: { kind: 'answer', purpose: 'call', sdp: ans } });
  } else if (p.kind === 'answer') {
    const pc = state.callPCs.get(from); if (pc) await pc.setRemoteDescription(p.sdp);
  } else if (p.kind === 'ice') {
    const pc = state.callPCs.get(from); if (pc) await pc.addIceCandidate(p.candidate).catch(() => { });
  }
}
async function handleFileSignal(from, p) {
  const key = from + ':' + p.transferId;
  if (p.kind === 'offer') {
    const pc = new RTCPeerConnection(ICE);
    state.filePCs.set(key, { pc });
    pc.onicecandidate = (e) => e.candidate && send({ type: 'signal', to: from, payload: { kind: 'ice', purpose: 'file', transferId: p.transferId, candidate: e.candidate.toJSON() } });
    pc.ondatachannel = (e) => {
      const dc = e.channel; dc.binaryType = 'arraybuffer';
      const entry = { chunks: [], received: 0, meta: p.meta };
      state.incoming.set(p.transferId, entry);
      dc.onmessage = (ev) => {
        if (typeof ev.data === 'string' && ev.data === '__END__') {
          const blob = new Blob(entry.chunks, { type: entry.meta.mime || 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const el = document.getElementById('ft-' + p.transferId);
          if (el) {
            el.innerHTML = `📦 <a href="${url}" download="${escapeHTML(entry.meta.name)}">${escapeHTML(entry.meta.name)}</a> <span class="muted small">${fmtSize(entry.meta.size)}</span>`;
          }
          state.incoming.delete(p.transferId);
          setTimeout(() => { try { pc.close(); } catch { }; state.filePCs.delete(key); }, 1000);
        } else {
          entry.chunks.push(ev.data); entry.received += ev.data.byteLength;
          updateProgress(p.transferId, entry.received / entry.meta.size);
        }
      };
    };
    await pc.setRemoteDescription(p.sdp);
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
    send({ type: 'signal', to: from, payload: { kind: 'answer', purpose: 'file', sdp: ans, transferId: p.transferId } });
  } else if (p.kind === 'answer') {
    const ent = state.filePCs.get(key); if (ent?.pc.signalingState === 'have-local-offer') await ent.pc.setRemoteDescription(p.sdp);
  } else if (p.kind === 'ice') {
    const ent = state.filePCs.get(key); if (ent) await ent.pc.addIceCandidate(p.candidate).catch(() => { });
  }
}
