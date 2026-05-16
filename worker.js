// Cloudflare Worker — BoardGameCrewStats API proxy
// Stores GITHUB_PAT as a secret so the browser never needs a token.
//
// Deploy:
//   1. `npm install -g wrangler` then `wrangler login`
//   2. `wrangler deploy` from this directory
//   3. `wrangler secret put GITHUB_PAT`  (paste a fine-grained PAT with Contents read+write)
//   4. Copy the deployed URL into WORKER_URL in js/admin.js and js/photos.js

const OWNER = 'walton15';
const REPO  = 'BoardGameCrewStats';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function b64Decode(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str.replace(/\n/g, '')))));
}

function b64Encode(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))));
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }
    if (request.method !== 'POST') {
      return jsonRes({ error: 'Method not allowed' }, 405);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonRes({ error: 'Invalid JSON body' }, 400); }

    const { type, data, env } = body ?? {};
    if (!type || !data) return jsonRes({ error: 'Missing type or data' }, 400);

    const DATA_PATH = env === 'local' ? 'data/data-local.json' : 'data/data.json';

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

    const ghHeaders = {
      Accept:        'application/vnd.github.v3+json',
      Authorization: `token ${env.GITHUB_PAT}`,
      'User-Agent':  'BoardGameCrewStats-Worker',
    };

    // Always re-fetch the latest SHA to avoid conflicts
    const getRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DATA_PATH}`,
      { headers: ghHeaders }
    );
    if (!getRes.ok) {
      const err = await getRes.json().catch(() => ({}));
      return jsonRes({ error: err.message ?? `GitHub GET ${getRes.status}` }, 502);
    }
    const getJson  = await getRes.json();
    const sha      = getJson.sha;
    const fileData = b64Decode(getJson.content);

    let commitMessage;

    if (type === 'session') {
      const { date, game, gameImage, placements, guests } = data;
      const nextId = fileData.sessions.length
        ? Math.max(...fileData.sessions.map(s => s.id)) + 1
        : 1;
      const sessionObj = { id: nextId, date, game, placements, guests: guests || [] };
      if (gameImage) sessionObj.gameImage = gameImage;
      fileData.sessions.push(sessionObj);
      commitMessage = `${env === 'local' ? 'LOCAL: ' : ''}Add session: ${game} (${date})`;

    } else if (type === 'update-session') {
      const { id, date, game, gameImage, placements, guests } = data;
      const idx = fileData.sessions.findIndex(s => s.id === id);
      if (idx === -1) return jsonRes({ error: `Session ${id} not found` }, 404);
      const sessionObj = { id, date, game, placements, guests: guests || [] };
      if (gameImage) sessionObj.gameImage = gameImage;
      fileData.sessions[idx] = sessionObj;
      commitMessage = `${env === 'local' ? 'LOCAL: ' : ''}Update session: ${game} (${date})`;

    } else if (type === 'delete-session') {
      const { id } = data;
      const idx = fileData.sessions.findIndex(s => s.id === id);
      if (idx === -1) return jsonRes({ error: `Session ${id} not found` }, 404);
      const s = fileData.sessions[idx];
      fileData.sessions.splice(idx, 1);
      commitMessage = `${env === 'local' ? 'LOCAL: ' : ''}Delete session: ${s.game} (${s.date})`;

    } else if (type === 'photo') {
      const { playerId, imageUrl } = data;
      const player = fileData.players.find(p => p.id === playerId);
      if (!player) return jsonRes({ error: 'Player not found' }, 404);
      fileData.players = fileData.players.map(p =>
        p.id === playerId ? { ...p, image: imageUrl } : p
      );
      commitMessage = `Update photo for ${player.name}`;

    } else {
      return jsonRes({ error: `Unknown type: ${type}` }, 400);
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${DATA_PATH}`,
      {
        method:  'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: commitMessage, content: b64Encode(fileData), sha }),
      }
    );

    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      return jsonRes({ error: err.message ?? `GitHub PUT ${putRes.status}` }, 502);
    }

    const putJson = await putRes.json();
    return jsonRes({ success: true, sha: putJson.content.sha });
  },
};
