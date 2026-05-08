// ── Configuration ────────────────────────────────────────────────────────────
// After deploying worker.js to Cloudflare, replace the URL below.
const WORKER_URL = 'https://board-game-crew-stats.moseleywalton.workers.dev';

const editParam = new URLSearchParams(window.location.search).get('edit');
const editId    = editParam ? Number(editParam) : null;

let currentData = null;
let guestCount  = 0;

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

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadData() {
  setStatus('Loading data…', 'info');
  try {
    const res = await fetch(`data/data.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentData = await res.json();
    buildPlayerRows(currentData.players);
    populateGameDatalist();
    setStatus('', null);
  } catch (err) {
    setStatus(`Could not load data: ${err.message}`, 'error');
    buildPlayerRows(defaultPlayers());
  }
}

function defaultPlayers() {
  return [
    { id: 'taylor', name: 'Taylor', color: '#e8534a' },
    { id: 'autumn', name: 'Autumn', color: '#e8962a' },
    { id: 'walton', name: 'Walton', color: '#4a90d9' },
    { id: 'jack',   name: 'Jack',   color: '#3dba7a' },
    { id: 'maddy',  name: 'Maddy',  color: '#9b59b6' },
  ];
}

// ── Player rows ───────────────────────────────────────────────────────────────

function buildPlayerRows(players) {
  const container = document.getElementById('player-rows');
  container.innerHTML = players.map(p => `
    <div class="player-placement-row" data-player-id="${p.id}">
      <span class="player-placement-name">
        <span class="player-dot" style="background:${p.color}"></span>
        ${p.name}
      </span>
      <input type="number" class="place-input" min="1" max="20" placeholder="#" aria-label="${p.name} placement">
      <label class="absent-label">
        <input type="checkbox" class="absent-check" aria-label="${p.name} absent"> Absent
      </label>
    </div>
  `).join('');

  container.querySelectorAll('.absent-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const input = cb.closest('.player-placement-row').querySelector('.place-input');
      input.disabled = cb.checked;
      if (cb.checked) input.value = '';
    });
  });
}

// ── Game datalist ─────────────────────────────────────────────────────────────

function populateGameDatalist() {
  if (!currentData) return;
  const list  = document.getElementById('game-suggestions');
  const games = [...new Set(currentData.sessions.map(s => s.game))];
  list.innerHTML = games.map(g => `<option value="${g}">`).join('');
}

// ── Edit mode population ──────────────────────────────────────────────────────

function populateEditForm() {
  if (!currentData) return;
  const session = currentData.sessions.find(s => s.id === editId);
  if (!session) { setStatus('Session not found.', 'error'); return; }

  document.getElementById('session-date').value = session.date;
  document.getElementById('session-game').value = session.game;

  document.querySelectorAll('#player-rows .player-placement-row').forEach(row => {
    const placement   = session.placements.find(p => p.playerId === row.dataset.playerId);
    const placeInput  = row.querySelector('.place-input');
    const absentCheck = row.querySelector('.absent-check');
    if (placement) {
      placeInput.value    = placement.place;
      absentCheck.checked = false;
      placeInput.disabled = false;
    } else {
      absentCheck.checked = true;
      placeInput.disabled = true;
      placeInput.value    = '';
    }
  });

  (session.guests || []).forEach(g => {
    addGuest();
    const rows    = document.querySelectorAll('#guest-entries .guest-entry');
    const lastRow = rows[rows.length - 1];
    lastRow.querySelector('.guest-name-input').value  = g.name;
    lastRow.querySelector('.guest-place-input').value = g.place;
  });
}

// ── Guests ────────────────────────────────────────────────────────────────────

function addGuest() {
  const id  = ++guestCount;
  const row = document.createElement('div');
  row.className = 'guest-entry';
  row.dataset.guestId = id;
  row.innerHTML = `
    <input type="text"   class="guest-name-input"  placeholder="Guest name" aria-label="Guest name">
    <input type="number" class="guest-place-input" min="1" max="20" placeholder="#" aria-label="Guest placement">
    <button type="button" class="btn-remove-guest" aria-label="Remove guest">✕</button>
  `;
  row.querySelector('.btn-remove-guest').addEventListener('click', () => row.remove());
  document.getElementById('guest-entries').appendChild(row);
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(msg, type) {
  const el = document.getElementById('submit-status');
  el.textContent = msg;
  el.className = 'status-msg';
  if (type) el.classList.add(`status-${type}`, 'visible');
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();

  const date = document.getElementById('session-date').value;
  const game = document.getElementById('session-game').value.trim();
  if (!date || !game) {
    setStatus('Date and game name are required.', 'error');
    return;
  }

  const placements = [];
  document.querySelectorAll('#player-rows .player-placement-row').forEach(row => {
    if (row.querySelector('.absent-check').checked) return;
    const place = parseInt(row.querySelector('.place-input').value, 10);
    if (!isNaN(place) && place >= 1) {
      placements.push({ playerId: row.dataset.playerId, place });
    }
  });

  if (!placements.length) {
    setStatus('At least one player must have a placement.', 'error');
    return;
  }

  const guests = [];
  document.querySelectorAll('#guest-entries .guest-entry').forEach(row => {
    const name  = row.querySelector('.guest-name-input').value.trim();
    const place = parseInt(row.querySelector('.guest-place-input').value, 10);
    if (name && !isNaN(place) && place >= 1) guests.push({ name, place });
  });

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  setStatus('Saving…', 'info');

  try {
    if (editId) {
      await workerPost('update-session', { id: editId, date, game, placements, guests });
      setStatus(`✓ Session updated successfully!`, 'success');
    } else {
      await workerPost('session', { date, game, placements, guests });
      setStatus(`✓ "${game}" saved successfully!`, 'success');
      document.getElementById('session-form').reset();
      document.getElementById('guest-entries').innerHTML = '';
      guestCount = 0;
      document.getElementById('session-date').valueAsDate = new Date();
      document.querySelectorAll('.place-input').forEach(i => { i.disabled = false; });
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  if (editId) {
    document.querySelector('.admin-title').textContent = '🎲 Edit Session';
    document.getElementById('btn-submit').textContent = 'Save Changes';
  }

  document.getElementById('session-date').valueAsDate = new Date();
  document.getElementById('btn-add-guest').addEventListener('click', addGuest);
  document.getElementById('session-form').addEventListener('submit', handleSubmit);

  await loadData();
  if (editId) populateEditForm();
}

init();
