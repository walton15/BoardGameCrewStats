// ── Configuration ────────────────────────────────────────────────────────────
// Get a free API key at https://api.imgbb.com/ then replace the value below.
const IMGBB_KEY  = '31172bd4104090e1b67cdc19a872693d';
// After deploying worker.js to Cloudflare, replace the URL below.
const WORKER_URL = 'https://board-game-crew-stats.moseleywalton.workers.dev';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

let currentData    = null;
let selectedPlayer = null;
let selectedFile   = null;

// ── Worker helper ─────────────────────────────────────────────────────────────

async function workerPost(type, data) {
  const res  = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, data }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? `Worker error ${res.status}`);
  return json;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  if (!IMGBB_KEY || IMGBB_KEY === 'YOUR_IMGBB_API_KEY') {
    document.getElementById('setup-notice').style.display = 'block';
  }

  await loadData();
  wireUploadArea();
  document.getElementById('btn-upload').addEventListener('click', handleUpload);

  const preselect = new URLSearchParams(window.location.search).get('player');
  if (preselect) selectPlayer(preselect);
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentData = await res.json();
  } catch (err) {
    setStatus(`Could not load player data: ${err.message}`, 'error');
    return;
  }
  buildPlayerGrid();
}

// ── Player grid ───────────────────────────────────────────────────────────────

function buildPlayerGrid() {
  const grid = document.getElementById('player-grid');
  if (!currentData?.players?.length) {
    grid.innerHTML = '<p class="empty-state">No players found.</p>';
    return;
  }

  grid.innerHTML = currentData.players.map(p => `
    <button
      type="button"
      class="photo-player-card"
      data-player-id="${p.id}"
      aria-label="Select ${p.name}"
    >
      <div class="mini-avatar" style="border-color:${p.color}">
        ${p.image
          ? `<img src="${p.image}" alt="${p.name}">`
          : `<span style="color:${p.color}">${p.name[0]}</span>`}
      </div>
      <span class="photo-player-name">${p.name}</span>
      <span class="photo-status-dot ${p.image ? 'has-photo' : 'no-photo'}">
        ${p.image ? '✓ photo' : 'no photo'}
      </span>
    </button>
  `).join('');

  grid.querySelectorAll('.photo-player-card').forEach(btn => {
    btn.addEventListener('click', () => selectPlayer(btn.dataset.playerId));
  });
}

function selectPlayer(id) {
  selectedPlayer = currentData.players.find(p => p.id === id);
  if (!selectedPlayer) return;

  // Highlight selected card
  document.querySelectorAll('.photo-player-card').forEach(c =>
    c.classList.toggle('selected', c.dataset.playerId === id)
  );

  // Show upload card
  const card = document.getElementById('upload-card');
  card.style.display = 'block';
  document.getElementById('upload-card-title').textContent =
    `Upload Photo for ${selectedPlayer.name}`;

  // Reset state
  selectedFile = null;
  document.getElementById('photo-input').value = '';
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('upload-placeholder').style.display = 'flex';
  document.getElementById('btn-upload').disabled = true;
  setStatus('', null);

  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Upload area ───────────────────────────────────────────────────────────────

function wireUploadArea() {
  const area  = document.getElementById('upload-area');
  const input = document.getElementById('photo-input');

  area.addEventListener('click', () => input.click());
  area.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });

  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleFileSelected(input.files[0]);
  });
}

function handleFileSelected(file) {
  if (!file.type.startsWith('image/')) {
    setStatus('Please choose an image file.', 'error');
    return;
  }
  if (file.size > MAX_BYTES) {
    setStatus('Image must be 5 MB or smaller.', 'error');
    return;
  }

  selectedFile = file;
  setStatus('', null);

  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('upload-preview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('upload-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);

  document.getElementById('btn-upload').disabled = false;
}

// ── Upload & save ─────────────────────────────────────────────────────────────

async function handleUpload() {
  if (!selectedFile || !selectedPlayer) return;

  if (!IMGBB_KEY || IMGBB_KEY === 'YOUR_IMGBB_API_KEY') {
    setStatus('imgbb API key not configured — see the setup instructions above.', 'error');
    return;
  }

  const btn = document.getElementById('btn-upload');
  btn.disabled = true;
  setStatus('Uploading photo…', 'info');

  try {
    // Upload image to imgbb
    const base64 = await fileToBase64(selectedFile);
    const form   = new FormData();
    form.append('key', IMGBB_KEY);
    form.append('image', base64);

    const imgRes  = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form });
    const imgJson = await imgRes.json();

    if (!imgJson.success) throw new Error(imgJson.error?.message ?? 'imgbb upload failed');

    const imageUrl = imgJson.data.display_url;
    setStatus('Photo uploaded! Saving to profile…', 'info');

    // Save URL to data.json via Worker
    await workerPost('photo', { playerId: selectedPlayer.id, imageUrl });

    // Update local state and refresh grid
    selectedPlayer.image = imageUrl;
    const idx = currentData.players.findIndex(p => p.id === selectedPlayer.id);
    if (idx !== -1) currentData.players[idx].image = imageUrl;
    buildPlayerGrid();

    // Re-select to keep card highlighted
    document.querySelectorAll('.photo-player-card').forEach(c =>
      c.classList.toggle('selected', c.dataset.playerId === selectedPlayer.id)
    );

    setStatus(`✓ ${selectedPlayer.name}'s photo saved!`, 'success');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setStatus(msg, type) {
  const el = document.getElementById('upload-status');
  el.textContent = msg;
  el.className = 'status-msg';
  if (type) el.classList.add(`status-${type}`, 'visible');
}

init();
