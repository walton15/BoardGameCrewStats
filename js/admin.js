// ── Configuration ────────────────────────────────────────────────────────────
const WORKER_URL = 'https://board-game-crew-stats.moseleywalton.workers.dev';
const IS_LOCAL   = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const editParam = new URLSearchParams(window.location.search).get('edit');
const editId    = editParam ? Number(editParam) : null;

let currentData = null;
let guestCount  = 0;

// ── Worker helper ─────────────────────────────────────────────────────────────

async function workerPost(type, data) {
  const res  = await fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ type, data, env: IS_LOCAL ? 'local' : 'production' }),
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? `Worker error ${res.status}`);
  return json;
}

// ── BGG search ────────────────────────────────────────────────────────────────

async function bggProxy(url) {
  const res = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'bgg-proxy', data: { url } }),
  });
  const text = await res.text();
  return new DOMParser().parseFromString(text, 'text/xml');
}

function hideBggDropdown() {
  document.getElementById('bgg-results').hidden = true;
}

async function searchBGG(query) {
  const dropdown = document.getElementById('bgg-results');
  try {
    const xml = await bggProxy(
      `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(query)}&type=boardgame`
    );
    const items = [...xml.querySelectorAll('item')].slice(0, 10);
    if (!items.length) { dropdown.hidden = true; return; }

    dropdown.innerHTML = items.map(item => {
      const id   = item.getAttribute('id');
      const name = item.querySelector('name[type="primary"]')?.getAttribute('value') ?? '?';
      const year = item.querySelector('yearpublished')?.getAttribute('value') ?? '';
      return `
        <div class="bgg-result" data-id="${id}" data-name="${name.replace(/"/g, '&quot;')}">
          <span class="bgg-result-name">${name}</span>
          ${year ? `<span class="bgg-year">(${year})</span>` : ''}
        </div>
      `;
    }).join('');

    dropdown.querySelectorAll('.bgg-result').forEach(el => {
      el.addEventListener('click', () => selectBGGGame(el.dataset.id, el.dataset.name));
    });
    dropdown.hidden = false;
  } catch {
    dropdown.hidden = true;
  }
}

async function selectBGGGame(id, name) {
  document.getElementById('session-game').value = name;
  hideBggDropdown();

  try {
    const xml = await bggProxy(
      `https://boardgamegeek.com/xmlapi2/thing?id=${id}&type=boardgame`
    );
    const thumbnail = xml.querySelector('thumbnail')?.textContent?.trim();
    const fullImage = xml.querySelector('image')?.textContent?.trim();
    if (thumbnail) {
      document.getElementById('game-image-url').value      = thumbnail;
      document.getElementById('game-image-full-url').value = fullImage || thumbnail;
      document.getElementById('game-image-thumb').src      = thumbnail;
      document.getElementById('game-image-preview').hidden = false;
    }
  } catch {
    // image fetch failed — silently continue without image
  }
}

function initBGGSearch() {
  const gameInput = document.getElementById('session-game');
  const dropdown  = document.getElementById('bgg-results');
  let debounce;

  gameInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = gameInput.value.trim();
    if (q.length < 2) { hideBggDropdown(); return; }
    debounce = setTimeout(() => searchBGG(q), 500);
  });

  gameInput.addEventListener('focus', () => {
    const q = gameInput.value.trim();
    if (q.length >= 2) searchBGG(q);
  });

  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target) && e.target !== gameInput) hideBggDropdown();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideBggDropdown();
  });

  document.getElementById('btn-clear-image').addEventListener('click', () => {
    document.getElementById('game-image-url').value      = '';
    document.getElementById('game-image-full-url').value = '';
    document.getElementById('game-image-thumb').src      = '';
    document.getElementById('game-image-preview').hidden = true;
  });
}

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadData() {
  setStatus('Loading data…', 'info');
  try {
    const res = await fetch(`${WORKER_URL}?env=${IS_LOCAL ? 'local' : 'prod'}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    currentData = await res.json();
    initRounds(currentData.players);
    populateGameDatalist();
    setStatus('', null);
  } catch (err) {
    setStatus(`Could not load data: ${err.message}`, 'error');
    initRounds(defaultPlayers());
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

// ── Game datalist ─────────────────────────────────────────────────────────────

function populateGameDatalist() {
  if (!currentData) return;
  const list  = document.getElementById('game-suggestions');
  const games = [...new Set(currentData.sessions.map(s => s.game))];
  list.innerHTML = games.map(g => `<option value="${g}">`).join('');
}

// ── Round tabs ────────────────────────────────────────────────────────────────

function buildRoundPanel(roundIdx, players) {
  const panel = document.createElement('div');
  panel.className       = 'round-panel';
  panel.dataset.roundIdx = roundIdx;

  const rowsId    = `player-rows-${roundIdx}`;
  const guestsId  = `guest-entries-${roundIdx}`;
  const addGuestId = `btn-add-guest-${roundIdx}`;

  panel.innerHTML = `
    <div class="round-section-label">Player Placements</div>
    <div id="${rowsId}"></div>
    <div class="round-section-label" style="margin-top:1.25rem;">Guests <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional)</span></div>
    <p style="font-size:0.82rem;color:var(--muted);margin-bottom:0.75rem;font-style:italic;">
      Guests are shown in sessions but excluded from overall rankings.
    </p>
    <div id="${guestsId}" class="guest-entries"></div>
    <button type="button" id="${addGuestId}" class="btn-add-guest">+ Add Guest</button>
  `;

  const rowsContainer = panel.querySelector(`#${rowsId}`);
  rowsContainer.innerHTML = players.map(p => `
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

  rowsContainer.querySelectorAll('.absent-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const input = cb.closest('.player-placement-row').querySelector('.place-input');
      input.disabled = cb.checked;
      if (cb.checked) input.value = '';
    });
  });

  panel.querySelector(`#${addGuestId}`).addEventListener('click', () => addGuestToRound(roundIdx));

  return panel;
}

function addGuestToRound(roundIdx) {
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
  document.getElementById(`guest-entries-${roundIdx}`).appendChild(row);
}

function updateTabCloseVisibility() {
  const tabs = document.querySelectorAll('#round-tabs-bar .round-tab');
  tabs.forEach(tab => {
    tab.querySelector('.round-tab-close').style.display = tabs.length <= 1 ? 'none' : '';
  });
}

function switchTab(idx) {
  document.querySelectorAll('#round-panels .round-panel').forEach((panel, i) => {
    panel.style.display = i === idx ? 'block' : 'none';
  });
  document.querySelectorAll('#round-tabs-bar .round-tab').forEach((tab, i) => {
    tab.classList.toggle('active', i === idx);
  });
}

function deleteRound(idx) {
  const tabs   = [...document.querySelectorAll('#round-tabs-bar .round-tab')];
  const panels = [...document.querySelectorAll('#round-panels .round-panel')];
  if (tabs.length <= 1) return;

  tabs[idx].remove();
  panels[idx].remove();

  // Re-label remaining tabs
  document.querySelectorAll('#round-tabs-bar .round-tab').forEach((tab, i) => {
    tab.querySelector('.round-tab-label').textContent = `Round ${i + 1}`;
  });

  const newActive = Math.min(idx, tabs.length - 2);
  updateTabCloseVisibility();
  switchTab(newActive);
}

function addRound() {
  const players = currentData?.players || defaultPlayers();
  const idx     = document.querySelectorAll('#round-panels .round-panel').length;

  const tab = document.createElement('button');
  tab.type      = 'button';
  tab.className = 'round-tab';
  tab.innerHTML = `<span class="round-tab-label">Round ${idx + 1}</span><span class="round-tab-close" aria-label="Delete round ${idx + 1}">×</span>`;
  document.getElementById('round-tabs-bar').appendChild(tab);

  const panel = buildRoundPanel(idx, players);
  document.getElementById('round-panels').appendChild(panel);

  updateTabCloseVisibility();
  switchTab(idx);
}

function initRounds(players) {
  document.getElementById('round-tabs-bar').innerHTML = '';
  document.getElementById('round-panels').innerHTML   = '';
  guestCount = 0;
  addRound();
}

// ── Edit mode population ──────────────────────────────────────────────────────

function getRoundsFromSession(session) {
  return session.rounds ?? [{ placements: session.placements || [], guests: session.guests || [] }];
}

function populateEditForm() {
  if (!currentData) return;
  const session = currentData.sessions.find(s => s.id === editId);
  if (!session) { setStatus('Session not found.', 'error'); return; }

  document.getElementById('session-date').value = session.date;
  document.getElementById('session-game').value = session.game;

  if (session.gameImage) {
    document.getElementById('game-image-url').value      = session.gameImage;
    document.getElementById('game-image-full-url').value = session.gameImageFull || session.gameImage;
    document.getElementById('game-image-thumb').src      = session.gameImage;
    document.getElementById('game-image-preview').hidden = false;
  }

  const rounds = getRoundsFromSession(session);

  // Clear the auto-created Round 1 from initRounds, then rebuild from session data
  document.getElementById('round-tabs-bar').innerHTML = '';
  document.getElementById('round-panels').innerHTML   = '';

  rounds.forEach((round, idx) => {
    addRound();

    const panels = document.querySelectorAll('#round-panels .round-panel');
    const panel  = panels[panels.length - 1];

    panel.querySelectorAll('.player-placement-row').forEach(row => {
      const placement   = round.placements.find(p => p.playerId === row.dataset.playerId);
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

    (round.guests || []).forEach(g => {
      addGuestToRound(idx);
      const guestRows = document.querySelectorAll(`#guest-entries-${idx} .guest-entry`);
      const lastRow   = guestRows[guestRows.length - 1];
      lastRow.querySelector('.guest-name-input').value  = g.name;
      lastRow.querySelector('.guest-place-input').value = g.place;
    });
  });

  switchTab(0);
}

// ── Status ────────────────────────────────────────────────────────────────────

function setStatus(msg, type) {
  const el = document.getElementById('submit-status');
  el.textContent = msg;
  el.className = 'status-msg';
  if (type) el.classList.add(`status-${type}`, 'visible');
}

function setDeleteStatus(msg, type) {
  const el = document.getElementById('delete-status');
  el.textContent = msg;
  el.className = 'status-msg';
  if (type) el.classList.add(`status-${type}`, 'visible');
}

// ── Delete ────────────────────────────────────────────────────────────────────

function initDeleteSection() {
  if (!editId) return;
  document.getElementById('delete-section').style.display = 'block';

  document.getElementById('btn-delete').addEventListener('click', () => {
    document.getElementById('delete-prompt').style.display  = 'none';
    document.getElementById('delete-confirm').style.display = 'block';
  });

  document.getElementById('btn-cancel-delete').addEventListener('click', () => {
    document.getElementById('delete-confirm').style.display = 'none';
    document.getElementById('delete-prompt').style.display  = 'block';
  });

  document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    const btn = document.getElementById('btn-confirm-delete');
    btn.disabled = true;
    setDeleteStatus('Deleting…', 'info');
    try {
      await workerPost('delete-session', { id: editId });
      setDeleteStatus('Session deleted.', 'success');
      setTimeout(() => { window.location.href = 'index.html'; }, 1200);
    } catch (err) {
      setDeleteStatus(`Error: ${err.message}`, 'error');
      btn.disabled = false;
    }
  });
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function handleSubmit(e) {
  e.preventDefault();

  const date          = document.getElementById('session-date').value;
  const game          = document.getElementById('session-game').value.trim();
  const gameImage     = document.getElementById('game-image-url').value || null;
  const gameImageFull = document.getElementById('game-image-full-url').value || null;

  if (!date || !game) {
    setStatus('Date and game name are required.', 'error');
    return;
  }

  const rounds = [];
  document.querySelectorAll('#round-panels .round-panel').forEach((panel, idx) => {
    const placements = [];
    panel.querySelectorAll('.player-placement-row').forEach(row => {
      if (row.querySelector('.absent-check').checked) return;
      const place = parseInt(row.querySelector('.place-input').value, 10);
      if (!isNaN(place) && place >= 1) placements.push({ playerId: row.dataset.playerId, place });
    });

    const guests = [];
    panel.querySelectorAll('.guest-entry').forEach(row => {
      const name  = row.querySelector('.guest-name-input').value.trim();
      const place = parseInt(row.querySelector('.guest-place-input').value, 10);
      if (name && !isNaN(place) && place >= 1) guests.push({ name, place });
    });

    rounds.push({ placements, guests });
  });

  if (!rounds.some(r => r.placements.length > 0)) {
    setStatus('At least one player must have a placement.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  setStatus('Saving…', 'info');

  try {
    if (editId) {
      await workerPost('update-session', { id: editId, date, game, gameImage, gameImageFull, rounds });
      setStatus('✓ Session updated successfully!', 'success');
    } else {
      await workerPost('session', { date, game, gameImage, gameImageFull, rounds });
      setStatus(`✓ "${game}" saved successfully!`, 'success');
      document.getElementById('session-form').reset();
      document.getElementById('game-image-url').value      = '';
      document.getElementById('game-image-full-url').value = '';
      document.getElementById('game-image-preview').hidden = true;
      hideBggDropdown();
      guestCount = 0;
      document.getElementById('session-date').valueAsDate = new Date();
      initRounds(currentData?.players || defaultPlayers());
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  if (IS_LOCAL) {
    const banner = document.createElement('div');
    banner.className = 'local-env-banner';
    banner.textContent = '⚠ Local Environment — data saved to data-local.json';
    document.querySelector('.admin-main').prepend(banner);
  }

  if (editId) {
    document.querySelector('.admin-title').textContent = '🎲 Edit Session';
    document.getElementById('btn-submit').textContent = 'Save Changes';
  }

  document.getElementById('session-date').valueAsDate = new Date();
  document.getElementById('btn-add-round').addEventListener('click', addRound);
  document.getElementById('session-form').addEventListener('submit', handleSubmit);

  // Wire tab bar with event delegation once — avoids stale closures across initRounds resets
  document.getElementById('round-tabs-bar').addEventListener('click', e => {
    const closeBtn = e.target.closest('.round-tab-close');
    const tab      = e.target.closest('.round-tab');
    if (!tab) return;
    const tabs = [...document.querySelectorAll('#round-tabs-bar .round-tab')];
    const idx  = tabs.indexOf(tab);
    if (closeBtn) { e.stopPropagation(); deleteRound(idx); }
    else switchTab(idx);
  });

  await loadData();
  if (editId) populateEditForm();
  initDeleteSection();
  initBGGSearch();
}

init();
