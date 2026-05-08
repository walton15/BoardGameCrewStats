async function loadData() {
  const res = await fetch('data/data.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function calcStats(players, sessions) {
  const ranked = players.map(player => {
    const places = sessions
      .map(s => s.placements.find(p => p.playerId === player.id)?.place)
      .filter(p => p !== undefined);

    const avg = places.length
      ? +(places.reduce((a, b) => a + b, 0) / places.length).toFixed(2)
      : null;

    return {
      ...player,
      avg,
      best:         places.length ? Math.min(...places) : null,
      worst:        places.length ? Math.max(...places) : null,
      sessionCount: places.length,
    };
  });

  return ranked.sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  });
}

function placeIcon(n) {
  if (n === 1) return '🥇';
  if (n === 2) return '🥈';
  if (n === 3) return '🥉';
  return `#${n}`;
}

// ── Podium ─────────────────────────────────────────────────────────────────

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

  const heights = { 1: 140, 2: 100, 3: 75 };
  const medals  = { 1: '🥇', 2: '🥈', 3: '🥉' };

  el.innerHTML = order.map(({ p, rank }) => `
    <div class="podium-item podium-rank-${rank}">
      <div class="podium-info">
        <span class="podium-player-name">${p.name}</span>
        <div class="podium-avatar" style="border-color:${rank === 1 ? 'var(--rank1)' : rank === 2 ? 'var(--rank2)' : 'var(--rank3)'}">
          ${p.image
            ? `<img src="${p.image}" alt="${p.name}">`
            : `<span style="color:${p.color}">${p.name[0]}</span>`}
        </div>
        <span class="podium-avg">avg&nbsp;${p.avg?.toFixed(2) ?? '—'}</span>
      </div>
      <div class="podium-block" style="height:${heights[rank]}px">
        <span class="podium-medal">${medals[rank]}</span>
        <span class="podium-num">${rank}</span>
      </div>
    </div>
  `).join('');
}

// ── Rankings table ──────────────────────────────────────────────────────────

function renderRankings(ranked) {
  const tbody = document.getElementById('rankings-body');
  const icons = ['🥇', '🥈', '🥉'];

  tbody.innerHTML = ranked.map((p, i) => {
    const rank = i + 1;
    return `
      <tr class="rank-row rank-tier-${Math.min(rank, 4)}">
        <td class="td-rank">${rank <= 3 ? icons[rank - 1] : `#${rank}`}</td>
        <td class="td-player">
          <span class="player-dot" style="background:${p.color}"></span>
          ${p.name}
        </td>
        <td class="td-avg">${p.avg?.toFixed(2) ?? '—'}</td>
        <td class="td-worst">${p.worst !== null ? `#${p.worst}` : '—'}</td>
        <td>${p.sessionCount}</td>
      </tr>
    `;
  }).join('');
}

// ── Chart ───────────────────────────────────────────────────────────────────

function renderChart(ranked, sessions) {
  const el = document.getElementById('placementChart');
  if (!sessions.length) {
    el.closest('.chart-wrap').innerHTML = '<p class="empty-state">No sessions to chart yet.</p>';
    return;
  }

  const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));

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

  new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          reverse: true,
          min: 1,
          ticks: {
            stepSize: 1,
            callback: v => `#${v}`,
            color: '#c9b97a',
            font: { size: 13 },
          },
          grid: { color: 'rgba(201,185,122,0.12)' },
          title: { display: true, text: 'Placement', color: '#c9b97a' },
        },
        x: {
          ticks: { color: '#c9b97a', maxRotation: 40, font: { size: 12 } },
          grid: { color: 'rgba(201,185,122,0.08)' },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: '#f0e6d3',
            font: { size: 13 },
            usePointStyle: true,
          },
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
      },
    },
  });
}

// ── Sessions ────────────────────────────────────────────────────────────────

function renderSessions(sessions, players) {
  const container = document.getElementById('sessions-container');
  const pMap = Object.fromEntries(players.map(p => [p.id, p]));
  const sorted = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!sorted.length) {
    container.innerHTML = '<p class="empty-state">No sessions yet.</p>';
    return;
  }

  container.innerHTML = sorted.map(s => {
    const d = new Date(s.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const participants = [
      ...s.placements.map(p => ({
        name: pMap[p.playerId]?.name ?? p.playerId,
        place: p.place,
        color: pMap[p.playerId]?.color ?? '#888',
        isGuest: false,
      })),
      ...(s.guests || []).map(g => ({
        name: g.name,
        place: g.place,
        color: null,
        isGuest: true,
      })),
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

// ── Init ────────────────────────────────────────────────────────────────────

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
