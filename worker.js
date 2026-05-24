// Cloudflare Worker — BoardGameCrewStats API
// Data is stored in Cloudflare KV (DATA_KV binding) under keys data-prod and data-local.
// Every write also commits to GitHub in the background via ctx.waitUntil() for version history.

const OWNER = 'walton15';
const REPO  = 'BoardGameCrewStats';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function b64Encode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
}

async function backupToGitHub(key, fileData, env) {
  const DATA_PATH = key === 'data-local' ? 'data/data-local.json' : 'data/data.json';
  const ghHeaders = {
    Accept:        'application/vnd.github.v3+json',
    Authorization: `token ${env.GITHUB_PAT}`,
    'User-Agent':  'BoardGameCrewStats-Worker',
  };

  const getRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DATA_PATH}`,
    { headers: ghHeaders }
  );
  if (!getRes.ok) return;
  const { sha } = await getRes.json();

  await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DATA_PATH}`,
    {
      method:  'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message: `Sync ${DATA_PATH} from KV`,
        content: b64Encode(fileData),
        sha,
      }),
    }
  );
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    if (request.method === 'GET') {
      const url     = new URL(request.url);
      const dataEnv = url.searchParams.get('env') === 'local' ? 'local' : 'prod';
      const key     = dataEnv === 'local' ? 'data-local' : 'data-prod';
      const val     = await env.DATA_KV.get(key);
      if (!val) return jsonRes({ error: 'No data found in KV' }, 404);
      return new Response(val, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (request.method !== 'POST') {
      return jsonRes({ error: 'Method not allowed' }, 405);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

    const { type, data, env: dataEnv } = body ?? {};
    if (!type || !data) return jsonRes({ error: 'Missing type or data' }, 400);

    if (type === 'bgg-proxy') {
      const { url } = data;
      if (!url.startsWith('https://boardgamegeek.com/xmlapi2/')) {
        return jsonRes({ error: 'Only BGG API URLs allowed' }, 400);
      }
      const bggFetch = () => fetch(url, { headers: { 'User-Agent': 'BoardGameCrewStats-Worker', 'Authorization': `Bearer ${env.BGG_TOKEN}` } });
      let bggRes = await bggFetch();
      if (bggRes.status === 202) {
        await new Promise(r => setTimeout(r, 2000));
        bggRes = await bggFetch();
      }
      const text = await bggRes.text();
      return new Response(text, { status: bggRes.status, headers: { ...CORS, 'Content-Type': 'text/xml' } });
    }

    const key      = dataEnv === 'local' ? 'data-local' : 'data-prod';
    const kvVal    = await env.DATA_KV.get(key);
    if (!kvVal) return jsonRes({ error: 'No data found in KV' }, 404);
    const fileData = JSON.parse(kvVal);

    if (type === 'session') {
      const { date, game, gameImage, gameImageFull, rounds, placements, guests } = data;
      const nextId = fileData.sessions.length
        ? Math.max(...fileData.sessions.map(s => s.id)) + 1
        : 1;
      const sessionObj = { id: nextId, date, game };
      if (rounds) sessionObj.rounds = rounds;
      else { sessionObj.placements = placements || []; sessionObj.guests = guests || []; }
      if (gameImage)     sessionObj.gameImage     = gameImage;
      if (gameImageFull) sessionObj.gameImageFull = gameImageFull;
      fileData.sessions.push(sessionObj);

    } else if (type === 'update-session') {
      const { id, date, game, gameImage, gameImageFull, rounds, placements, guests } = data;
      const idx = fileData.sessions.findIndex(s => s.id === id);
      if (idx === -1) return jsonRes({ error: `Session ${id} not found` }, 404);
      const sessionObj = { id, date, game };
      if (rounds) sessionObj.rounds = rounds;
      else { sessionObj.placements = placements || []; sessionObj.guests = guests || []; }
      if (gameImage)     sessionObj.gameImage     = gameImage;
      if (gameImageFull) sessionObj.gameImageFull = gameImageFull;
      fileData.sessions[idx] = sessionObj;

    } else if (type === 'delete-session') {
      const { id } = data;
      const idx = fileData.sessions.findIndex(s => s.id === id);
      if (idx === -1) return jsonRes({ error: `Session ${id} not found` }, 404);
      fileData.sessions.splice(idx, 1);

    } else if (type === 'photo') {
      const { playerId, imageUrl } = data;
      const player = fileData.players.find(p => p.id === playerId);
      if (!player) return jsonRes({ error: 'Player not found' }, 404);
      fileData.players = fileData.players.map(p =>
        p.id === playerId ? { ...p, image: imageUrl } : p
      );

    } else {
      return jsonRes({ error: `Unknown type: ${type}` }, 400);
    }

    await env.DATA_KV.put(key, JSON.stringify(fileData, null, 2));
    ctx.waitUntil(backupToGitHub(key, fileData, env));
    return jsonRes({ success: true });
  },
};
