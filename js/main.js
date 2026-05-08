// ── Sort state ───────────────────────────────────────────────────────────────

let rankingData = [];
let sortCol = 'avg';
let sortDir = 'asc';

const SORT_DEFAULTS = {
  player:   'desc',
  avg:      'asc',
  firsts:   'desc',
  lasts:    'desc',
  sessions: 'desc',
};

// ── Data ─────────────────────────────────────────────────────────────────────

async function loadData() {
  const res = await fetch(`data/data.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function calcStats(players, sessions) {
  const ranked = players.map(player => {
    let firstCount = 0;
    let lastCount  = 0;
    const places   = [];

    sessions.forEach(s => {
      const found = s.placements.find(p => p.playerId === player.id);
      if (!found) return;
      places.push(found.place);
      if (found.place === 1) firstCount++;
      const worstPlace = Math.max(
        ...s.placements.map(p => p.place),
        ...(s.guests || []).map(g => g.place),
      );
      if (found.place === worstPlace) lastCount++;
    });

    const avg = places.length
      ? +(places.reduce((a, b) => a + b, 0) / places.length).toFixed(2)
      : null;

    return { ...player, avg, sessionCount: places.length, firstCount, lastCount };
  }).sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  });

  return ranked.map((p, i) => ({ ...p, avgRank: i + 1 }));
}

function placeIcon(n) {
  if (n === 1) return '🥇';
  if (n === 2) return '🥈';
  if (n === 3) return '🥉';
  return `#${n}`;
}

// ── Podium ────────────────────────────────────────────────────────────────────

function renderPodium(ranked) {
  const el = document.getElementById('podium-container');
  if (!ranked.length || ranked[0].avg === null) {
    el.innerHTML = '<p class="empty-state">No sessions yet — add one via the admin page!</p>';
    return;
  }

  const top = ranked.slice(0, Math.min(3, ranked.length));
  const order = [];
  if (top[1]) order.push({ p: top[1], rank: 2 });
  order.push(       { p: top[0], rank: 1 });
  if (top[2]) order.push({ p: top[2], rank: 3 });

  const heights    = { 1: 140, 2: 100, 3: 75 };
  const medals     = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const rankColors = { 1: 'var(--rank1)', 2: 'var(--rank2)', 3: 'var(--rank3)' };

  el.innerHTML = order.map(({ p, rank }) => `
    <div class="podium-item podium-rank-${rank}">
      <div class="podium-info">
        <a href="photos.html?player=${p.id}" class="podium-link" title="Update ${p.name}'s photo">
          <span class="podium-player-name">${p.name}</span>
          <div class="podium-avatar" style="border-color:${rankColors[rank]}">
            ${p.image
              ? `<img src="${p.image}" alt="${p.name}">`
              : `<span style="color:${p.color}">${p.name[0]}</span>`}
          </div>
        </a>
        <span class="podium-avg">avg&nbsp;${p.avg?.toFixed(2) ?? '—'}</span>
      </div>
      <div class="podium-block" style="height:${heights[rank]}px">
        <span class="podium-medal">${medals[rank]}</span>
        <span class="podium-num">${rank}</span>
      </div>
    </div>
  `).join('');
}

// ── Rankings table ────────────────────────────────────────────────────────────

function getSortedRankings() {
  return [...rankingData].sort((a, b) => {
    let va, vb;
    switch (sortCol) {
      case 'player':   va = a.name;         vb = b.name;         break;
      case 'avg':      va = a.avg ?? 999;   vb = b.avg ?? 999;   break;
      case 'firsts':   va = a.firstCount;   vb = b.firstCount;   break;
      case 'lasts':    va = a.lastCount;    vb = b.lastCount;    break;
      case 'sessions': va = a.sessionCount; vb = b.sessionCount; break;
      default: return 0;
    }
    if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === 'asc' ? va - vb : vb - va;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) {
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function renderRankingsBody() {
  const icons = ['🥇', '🥈', '🥉'];
  document.getElementById('rankings-body').innerHTML = getSortedRankings().map(p => {
    const rank = p.avgRank;
    return `
      <tr class="rank-row rank-tier-${Math.min(rank, 4)}">
        <td class="td-rank">${rank <= 3 ? icons[rank - 1] : `#${rank}`}</td>
        <td>
          <div class="td-player">
            <span class="player-dot" style="background:${p.color}"></span>
            <a href="photos.html?player=${p.id}" class="player-photo-link">${p.name}</a>
          </div>
        </td>
        <td class="td-avg">${p.avg?.toFixed(2) ?? '—'}</td>
        <td class="td-firsts">${p.firstCount}</td>
        <td class="td-lasts">${p.lastCount}</td>
        <td>${p.sessionCount}</td>
      </tr>
    `;
  }).join('');
}

function renderRankings(ranked) {
  rankingData = ranked;

  document.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      sortDir = sortCol === col
        ? (sortDir === 'asc' ? 'desc' : 'asc')
        : SORT_DEFAULTS[col];
      sortCol = col;
      updateSortHeaders();
      renderRankingsBody();
    });
  });

  updateSortHeaders();
  renderRankingsBody();
}

// ── Chart ─────────────────────────────────────────────────────────────────────

const VISIBLE_POINTS = 6;

function renderChart(ranked, sessions) {
  const el = document.getElementById('placementChart');
  if (!sessions.length) {
    el.closest('.chart-wrap').innerHTML = '<p class="empty-state">No sessions to chart yet.</p>';
    return;
  }

  const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const canPan = sorted.length > VISIBLE_POINTS;

  const labels = sorted.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    return `${s.game} (${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
  });

  const datasets = ranked.map(p => ({
    label: p.name,
    data: sorted.map(s => {
      const found = s.placements.find(pl => pl.playerId === p.id);
      return found ? found.place : null;
    }),
    borderColor: p.color,
    backgroundColor: p.color + '22',
    tension: 0.3,
    pointRadius: 6,
    pointHoverRadius: 9,
    pointBackgroundColor: p.color,
    pointBorderColor: '#fff',
    pointBorderWidth: 2,
    spanGaps: false,
  }));

  let currentMin = canPan ? sorted.length - VISIBLE_POINTS : 0;
  const maxMin   = labels.length - VISIBLE_POINTS;

  const chart = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700, easing: 'easeInOutQuart' },
      layout: { padding: { top: 14, bottom: 4 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          reverse: true,
          min: 1,
          ticks: { stepSize: 1, callback: v => `#${v}`, color: '#c9b97a', font: { size: 13 } },
          grid: { color: 'rgba(201,185,122,0.12)' },
          title: { display: true, text: 'Placement', color: '#c9b97a' },
        },
        x: {
          min: canPan ? labels[currentMin] : undefined,
          max: canPan ? labels[currentMin + VISIBLE_POINTS - 1] : undefined,
          ticks: { color: '#c9b97a', maxRotation: 40, font: { size: 12 } },
          grid: { color: 'rgba(201,185,122,0.08)' },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#f0e6d3', font: { size: 13 }, usePointStyle: true },
        },
        tooltip: {
          backgroundColor: 'rgba(8,18,10,0.94)',
          borderColor: 'rgba(201,185,122,0.4)',
          borderWidth: 1,
          titleColor: '#c9b97a',
          bodyColor: '#f0e6d3',
          callbacks: {
            label: ctx => ctx.raw !== null
              ? ` ${ctx.dataset.label}: #${ctx.raw} place`
              : ` ${ctx.dataset.label}: absent`,
          },
        },
        zoom: { pan: { enabled: false } },
      },
    },
  });

  if (!canPan) return;

  const wrap = el.closest('.chart-wrap');

  // Controls row (arrows + hint) placed after the chart wrap
  const controls = document.createElement('div');
  controls.className = 'chart-pan-controls';
  controls.innerHTML = `
    <button type="button" class="chart-arrow" id="chart-prev" aria-label="Pan to earlier sessions">&#8249;</button>
    <p class="chart-pan-hint">&#8592; Drag or swipe to explore all sessions &#8594;</p>
    <button type="button" class="chart-arrow" id="chart-next" aria-label="Pan to later sessions">&#8250;</button>
  `;
  wrap.insertAdjacentElement('afterend', controls);

  const prevBtn = controls.querySelector('#chart-prev');
  const nextBtn = controls.querySelector('#chart-next');

  function updatePanUI() {
    const atStart = currentMin <= 0;
    const atEnd   = currentMin >= maxMin;
    prevBtn.disabled      = atStart;
    nextBtn.disabled      = atEnd;
    prevBtn.style.opacity = atStart ? '0.2' : '1';
    nextBtn.style.opacity = atEnd   ? '0.2' : '1';
  }

  function applyWindow(newMin, animate = false) {
    currentMin = Math.max(0, Math.min(maxMin, Math.round(newMin)));
    chart.options.scales.x.min = labels[currentMin];
    chart.options.scales.x.max = labels[currentMin + VISIBLE_POINTS - 1];
    chart.update(animate ? undefined : 'none');
    updatePanUI();
  }

  prevBtn.addEventListener('click', () => applyWindow(currentMin - 1, true));
  nextBtn.addEventListener('click', () => applyWindow(currentMin + 1, true));

  // ── Mouse drag ────────────────────────────────────────────────────────────
  let dragStartX   = null;
  let dragStartMin = null;

  el.style.cursor = 'grab';

  el.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragStartX   = e.clientX;
    dragStartMin = currentMin;
    el.style.cursor = 'grabbing';
    e.preventDefault();
  });

  el.addEventListener('mousemove', e => {
    if (dragStartX === null) return;
    const pixPerLabel = chart.scales.x.width / VISIBLE_POINTS;
    applyWindow(dragStartMin + (dragStartX - e.clientX) / pixPerLabel);
  });

  const stopDrag = () => {
    if (dragStartX === null) return;
    dragStartX = null;
    el.style.cursor = 'grab';
  };
  el.addEventListener('mouseup',    stopDrag);
  el.addEventListener('mouseleave', stopDrag);

  // ── Touch swipe (Hammer.js) ───────────────────────────────────────────────
  if (window.Hammer) {
    const mc = new Hammer.Manager(el);
    mc.add(new Hammer.Pan({ direction: Hammer.DIRECTION_HORIZONTAL, threshold: 5 }));
    let touchStartMin = null;
    mc.on('panstart', ()  => { touchStartMin = currentMin; });
    mc.on('panmove',  ev  => {
      if (touchStartMin === null) return;
      const pixPerLabel = chart.scales.x.width / VISIBLE_POINTS;
      applyWindow(touchStartMin - ev.deltaX / pixPerLabel);
    });
    mc.on('panend', () => { touchStartMin = null; });
  }

  updatePanUI();
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function renderSessions(sessions, players) {
  const container = document.getElementById('sessions-container');
  const pMap = Object.fromEntries(players.map(p => [p.id, p]));
  const sorted = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!sorted.length) { container.innerHTML = '<p class="empty-state">No sessions yet.</p>'; return; }

  container.innerHTML = sorted.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const participants = [
      ...s.placements.map(p => ({
        name: pMap[p.playerId]?.name ?? p.playerId,
        place: p.place, color: pMap[p.playerId]?.color ?? '#888', isGuest: false,
      })),
      ...(s.guests || []).map(g => ({ name: g.name, place: g.place, color: null, isGuest: true })),
    ].sort((a, b) => a.place - b.place || (a.isGuest ? 1 : -1));

    const rows = participants.map(p => `
      <tr class="${p.isGuest ? 'guest-row' : ''}">
        <td class="td-place">${placeIcon(p.place)}</td>
        <td class="td-name">
          ${!p.isGuest ? `<span class="player-dot" style="background:${p.color}"></span>` : ''}
          ${p.name}
          ${p.isGuest ? '<span class="guest-badge">Guest</span>' : ''}
        </td>
      </tr>
    `).join('');

    return `
      <div class="session-card">
        <div class="session-head">
          <div class="session-game">🎲 ${s.game}</div>
          <div class="session-date">${dateStr}</div>
        </div>
        <table class="session-table"><tbody>${rows}</tbody></table>
      </div>
    `;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const { players, sessions } = await loadData();
    const ranked = calcStats(players, sessions);
    renderPodium(ranked);
    renderRankings(ranked);
    renderChart(ranked, sessions);
    renderSessions(sessions, players);
  } catch (err) {
    console.error(err);
    document.querySelector('main').innerHTML = `
      <div class="error-state">
        <p>⚠️ Could not load game data.</p>
        <p><small>${err.message}</small></p>
        <p><small>If running locally, use a local server — e.g. <code>npx serve .</code></small></p>
      </div>
    `;
  }
}

init();
