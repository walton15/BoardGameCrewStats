const IS_LOCAL   = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const WORKER_URL = 'https://board-game-crew-stats.moseleywalton.workers.dev';

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
  const res = await fetch(`${WORKER_URL}?env=${IS_LOCAL ? 'local' : 'prod'}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function getRounds(s) {
  return s.rounds ?? [{ placements: s.placements || [], guests: s.guests || [] }];
}

function calcStats(players, sessions) {
  const ranked = players.map(player => {
    let firstCount  = 0;
    let lastCount   = 0;
    const sessionAvgs = [];

    sessions.forEach(s => {
      const rounds = getRounds(s);
      const roundPlaces = [];

      rounds.forEach(round => {
        const found = round.placements.find(p => p.playerId === player.id);
        if (!found) return;
        roundPlaces.push(found.place);
        if (found.place === 1) firstCount++;
        const worstInRound = Math.max(
          ...round.placements.map(p => p.place),
          ...(round.guests || []).map(g => g.place),
        );
        if (found.place === worstInRound) lastCount++;
      });

      if (!roundPlaces.length) return;
      sessionAvgs.push(roundPlaces.reduce((a, b) => a + b, 0) / roundPlaces.length);
    });

    const avg = sessionAvgs.length
      ? +(sessionAvgs.reduce((a, b) => a + b, 0) / sessionAvgs.length).toFixed(2)
      : null;

    return { ...player, avg, sessionCount: sessionAvgs.length, firstCount, lastCount };
  }).sort((a, b) => {
    if (a.avg === null && b.avg === null) return 0;
    if (a.avg === null) return 1;
    if (b.avg === null) return -1;
    return a.avg - b.avg;
  });

  return ranked.map((p, _, arr) => {
    const rank = p.avg === null
      ? arr.filter(q => q.avg !== null).length + 1
      : arr.filter(q => q.avg !== null && q.avg < p.avg).length + 1;
    return { ...p, avgRank: rank };
  });
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

  const byRank = {};
  for (const p of ranked) {
    if (p.avg === null || p.avgRank > 3) continue;
    (byRank[p.avgRank] ??= []).push(p);
  }

  if (!byRank[1]) {
    el.innerHTML = '<p class="empty-state">No sessions yet — add one via the admin page!</p>';
    return;
  }

  const heights    = { 1: 140, 2: 100, 3: 75 };
  const medals     = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const rankColors = { 1: 'var(--rank1)', 2: 'var(--rank2)', 3: 'var(--rank3)' };

  const order = [];
  if (byRank[2]) order.push(2);
  order.push(1);
  if (byRank[3]) order.push(3);

  el.innerHTML = order.map(rank => {
    const players = byRank[rank];
    const tied = players.length > 1;

    const playerEntry = p => `
      <a href="photos.html?player=${p.id}" class="podium-link" title="Update ${p.name}'s photo">
        <span class="podium-player-name">${p.name}</span>
        <div class="podium-avatar" style="border-color:${rankColors[rank]}">
          ${p.image
            ? `<img src="${p.image}" alt="${p.name}">`
            : `<span style="color:${p.color}">${p.name[0]}</span>`}
        </div>
      </a>
      <span class="podium-avg">avg&nbsp;${p.avg?.toFixed(2) ?? '—'}</span>
    `;

    const playerInfos = tied
      ? players.map(p => `<div class="podium-tied-player">${playerEntry(p)}</div>`).join('')
      : playerEntry(players[0]);

    return `
      <div class="podium-item podium-rank-${rank}${tied ? ' podium-item-tied' : ''}">
        <div class="podium-info${tied ? ' podium-info-tied' : ''}">
          ${playerInfos}
        </div>
        <div class="podium-block" style="height:${heights[rank]}px">
          <span class="podium-medal">${medals[rank]}</span>
          <span class="podium-num">${rank}</span>
        </div>
      </div>
    `;
  }).join('');
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
      const rounds = getRounds(s);
      const places = rounds.flatMap(r => r.placements.filter(pl => pl.playerId === p.id).map(pl => pl.place));
      if (!places.length) return null;
      return +(places.reduce((a, b) => a + b, 0) / places.length).toFixed(2);
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

  const PAN_DURATION = 500;
  let panAnimStart   = -Infinity;
  let prevTickMap    = new Map(); // label-key → old x pixel
  let newLabelShift  = 0;        // pixels new labels are offset from their final x

  function easeInOutQuart(t) {
    return t < 0.5 ? 8*t*t*t*t : 1 - 8*(1-t)*(1-t)*(1-t)*(1-t);
  }

  const boldTitlePlugin = {
    id: 'boldTitlePlugin',
    afterDraw(chart) {
      const xAxis = chart.scales.x;
      const { ctx } = chart;
      const startY = xAxis.top + 17;

      const elapsed  = performance.now() - panAnimStart;
      const progress = easeInOutQuart(Math.min(elapsed / PAN_DURATION, 1));

      const tickWidth  = xAxis.width / VISIBLE_POINTS;
      const halfTick   = tickWidth / 2;
      const fontSize   = Math.max(8, Math.min(11, tickWidth / 9));
      const lineHeight = fontSize + 4;

      ctx.save();
      ctx.beginPath();
      ctx.rect(xAxis.left - halfTick, xAxis.top, xAxis.width + halfTick * 2, chart.height - xAxis.top);
      ctx.clip();

      function drawLines(lines, x) {
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, li) => {
          ctx.fillStyle = '#c9b97a';
          ctx.font = (li === lines.length - 1)
            ? `400 ${fontSize}px "Crimson Text", Georgia, serif`
            : `bold ${fontSize}px "Cinzel", "Times New Roman", serif`;
          ctx.fillText(line, x, startY + li * lineHeight);
        });
      }

      const currentValues = new Set(xAxis.ticks.map(t => t.value));

      // Draw exiting labels sliding off screen
      if (progress < 1) {
        prevTickMap.forEach(({ x: oldX, lines }, value) => {
          if (currentValues.has(value)) return;
          drawLines(lines, oldX - newLabelShift * progress);
        });
      }

      // Draw current labels (entering or sliding)
      xAxis.ticks.forEach((tick, i) => {
        const finalX = xAxis.getPixelForTick(i);
        const lines  = Array.isArray(tick.label) ? tick.label : [tick.label];

        let x;
        if (progress >= 1) {
          x = finalX;
        } else if (prevTickMap.has(tick.value)) {
          const prevX = prevTickMap.get(tick.value).x;
          x = prevX + (finalX - prevX) * progress;
        } else {
          const startX = finalX + newLabelShift;
          x = startX + (finalX - startX) * progress;
        }

        drawLines(lines, x);
      });
      ctx.restore();
    },
  };

  const chart = new Chart(el.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    plugins: [boldTitlePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: PAN_DURATION, easing: 'easeInOutQuart' },
      events: ['click'],
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { right: 36 } },
      scales: {
        y: {
          afterFit: scale => { scale.width = 36; },
          reverse: true,
          min: 0.5,
          ticks: { stepSize: 1, callback: v => Number.isInteger(v) ? `#${v}` : null, color: '#c9b97a', font: { size: 13 } },
          grid: { color: 'rgba(201,185,122,0.12)' },
        },
        x: {
          afterFit: scale => { scale.paddingLeft = 8; scale.paddingRight = 8; },
          min: canPan ? labels[currentMin] : undefined,
          max: canPan ? labels[currentMin + VISIBLE_POINTS - 1] : undefined,
          ticks: {
            color: 'transparent',
            maxRotation: 0,
            minRotation: 0,
            autoSkip: false,
            font: { size: 12 },
            callback: function(value) {
              const label = this.getLabelForValue(value);
              const parenIdx = label.lastIndexOf(' (');
              if (parenIdx === -1) return label;
              const game = label.slice(0, parenIdx);
              const date = label.slice(parenIdx + 1);
              const maxChars = 14;
              const words = game.split(' ');
              const lines = [];
              let line = '';
              for (const word of words) {
                const test = line ? `${line} ${word}` : word;
                if (test.length <= maxChars) {
                  line = test;
                } else {
                  if (line) lines.push(line);
                  line = word;
                }
              }
              if (line) lines.push(line);
              return [...lines, date];
            },
          },
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
              ? ` ${ctx.dataset.label}: ${ctx.raw % 1 === 0 ? `#${ctx.raw}` : `avg ${ctx.raw}`} place`
              : ` ${ctx.dataset.label}: absent`,
          },
        },
        zoom: { pan: { enabled: false } },
      },
    },
  });

  document.addEventListener('click', e => {
    if (e.target !== el) {
      chart.tooltip.setActiveElements([], {});
      chart.update('none');
    }
  });

  if (!canPan) return;

  const wrap = el.closest('.chart-wrap');

  // Controls row (arrows + hint) placed after the chart wrap
  const controls = document.createElement('div');
  controls.className = 'chart-pan-controls';
  controls.innerHTML = `
    <button type="button" class="chart-arrow" id="chart-prev" aria-label="Pan to earlier sessions">&#8249;</button>
    <p class="chart-pan-hint">Use the arrows to explore all sessions</p>
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
    const targetMin = Math.max(0, Math.min(maxMin, Math.round(newMin)));

    if (!animate || targetMin === currentMin) {
      currentMin = targetMin;
      panAnimStart = -Infinity;
      prevTickMap.clear();
      chart.options.scales.x.min = labels[currentMin];
      chart.options.scales.x.max = labels[currentMin + VISIBLE_POINTS - 1];
      chart.update('none');
      updatePanUI();
      return;
    }

    // Snapshot current tick positions + label text before the scale changes
    const xAxis = chart.scales.x;
    prevTickMap.clear();
    xAxis.ticks.forEach((tick, i) => {
      const lines = Array.isArray(tick.label) ? tick.label : [tick.label];
      prevTickMap.set(tick.value, { x: xAxis.getPixelForTick(i), lines });
    });

    // New labels enter from the opposite direction of the pan
    const tickWidth   = xAxis.width / VISIBLE_POINTS;
    const direction   = targetMin > currentMin ? 1 : -1;
    newLabelShift     = direction * tickWidth;

    currentMin    = targetMin;
    panAnimStart  = performance.now();
    chart.options.scales.x.min = labels[currentMin];
    chart.options.scales.x.max = labels[currentMin + VISIBLE_POINTS - 1];
    chart.update();
    updatePanUI();
  }

  prevBtn.addEventListener('click', () => applyWindow(currentMin - 1, true));
  nextBtn.addEventListener('click', () => applyWindow(currentMin + 1, true));

  updatePanUI();
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function renderSessions(sessions, players) {
  const container = document.getElementById('sessions-container');
  const pMap = Object.fromEntries(players.map(p => [p.id, p]));
  const sorted = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!sorted.length) { container.innerHTML = '<p class="empty-state">No sessions yet.</p>'; return; }

  container.innerHTML = sorted.map(s => {
    const rounds = getRounds(s);
    const isMultiRound = rounds.length > 1;

    const d = new Date(s.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const bgImage   = s.gameImageFull || s.gameImage;
    const cardStyle = bgImage ? ` style="--game-bg:url('${bgImage}')"` : '';
    const thumbHtml = s.gameImage
      ? `<img class="session-game-thumb" src="${s.gameImage}" alt="${s.game}">`
      : '🎲';

    const badgeHtml  = isMultiRound ? `<span class="session-rounds-badge">${rounds.length} rounds</span>` : '';
    const toggleHtml = isMultiRound
      ? `<button type="button" class="session-toggle-btn" data-session-id="${s.id}" aria-expanded="false" aria-label="Expand rounds">&#8964;</button>`
      : '';

    // Compute per-player average placements across all rounds
    const allPlayerIds  = new Set(rounds.flatMap(r => r.placements.map(p => p.playerId)));
    const allGuestNames = [...new Set(rounds.flatMap(r => (r.guests || []).map(g => g.name)))];

    const summaryParticipants = [
      ...[...allPlayerIds].map(pid => {
        const places = rounds.flatMap(r => r.placements.filter(p => p.playerId === pid).map(p => p.place));
        const avg = places.reduce((a, b) => a + b, 0) / places.length;
        return { name: pMap[pid]?.name ?? pid, color: pMap[pid]?.color ?? '#888', avg, isGuest: false };
      }),
      ...allGuestNames.map(name => {
        const places = rounds.flatMap(r => (r.guests || []).filter(g => g.name === name).map(g => g.place));
        const avg = places.reduce((a, b) => a + b, 0) / places.length;
        return { name, color: null, avg, isGuest: true };
      }),
    ].sort((a, b) => a.avg - b.avg || (a.isGuest ? 1 : -1));

    const absentRows = players
      .filter(p => !allPlayerIds.has(p.id))
      .map(p => `
        <tr class="absent-row">
          <td class="td-place">💤</td>
          <td class="td-name">
            <span class="player-dot" style="background:${p.color}"></span>
            ${p.name}
          </td>
        </tr>
      `).join('');

    const summaryRows = summaryParticipants.map(p => {
      const placeDisplay = isMultiRound
        ? (p.avg % 1 === 0 ? `avg ${p.avg.toFixed(0)}` : `avg ${p.avg.toFixed(2)}`)
        : placeIcon(p.avg);
      return `
        <tr class="${p.isGuest ? 'guest-row' : ''}">
          <td class="td-place">${placeDisplay}</td>
          <td class="td-name">
            ${!p.isGuest ? `<span class="player-dot" style="background:${p.color}"></span>` : ''}
            ${p.name}
            ${p.isGuest ? '<span class="guest-badge">Guest</span>' : ''}
          </td>
        </tr>
      `;
    }).join('');

    // Per-round detail tables (multi-round only, hidden by default)
    const roundDetailHtml = isMultiRound ? `
      <div class="session-rounds-detail" id="rounds-detail-${s.id}" hidden>
        ${rounds.map((round, idx) => {
          const roundParticipants = [
            ...round.placements.map(p => ({
              name: pMap[p.playerId]?.name ?? p.playerId,
              place: p.place, color: pMap[p.playerId]?.color ?? '#888', isGuest: false,
            })),
            ...(round.guests || []).map(g => ({ name: g.name, place: g.place, color: null, isGuest: true })),
          ].sort((a, b) => a.place - b.place || (a.isGuest ? 1 : -1));

          const roundRows = roundParticipants.map(p => `
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
            <div class="session-round-header">Round ${idx + 1}</div>
            <table class="session-table"><tbody>${roundRows}</tbody></table>
          `;
        }).join('')}
      </div>
    ` : '';

    return `
      <div class="session-card"${cardStyle}>
        <div class="session-head">
          <div>
            <div class="session-game">${thumbHtml} ${s.game} ${badgeHtml}</div>
            <div class="session-date">${dateStr}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem;">
            ${toggleHtml}
            <a href="session.html?edit=${s.id}" class="btn-edit-session">Edit</a>
          </div>
        </div>
        <table class="session-table"><tbody>${summaryRows}${absentRows}</tbody></table>
        ${roundDetailHtml}
      </div>
    `;
  }).join('');

  // Expand/collapse round detail via event delegation
  container.addEventListener('click', e => {
    const btn = e.target.closest('.session-toggle-btn');
    if (!btn) return;
    const sid    = btn.dataset.sessionId;
    const detail = document.getElementById(`rounds-detail-${sid}`);
    if (!detail) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!expanded));
    btn.innerHTML  = expanded ? '&#8964;' : '&#8963;';
    detail.hidden  = expanded;
  });
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
