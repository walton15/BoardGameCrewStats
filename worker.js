// Cloudflare Worker — BoardGameCrewStats API proxy
// Stores GITHUB_PAT as a secret so the browser never needs a token.
//
// Deploy:
//   1. `npm install -g wrangler` then `wrangler login`
//   2. `wrangler deploy` from this directory
//   3. `wrangler secret put GITHUB_PAT`  (paste a fine-grained PAT with Contents read+write)
//   4. Copy the deployed URL into WORKER_URL in js/admin.js and js/photos.js

const OWNER     = 'walton15';
const REPO      = 'BoardGameCrewStats';
const DATA_PATH = 'data/data.json';

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

    const { type, data } = body ?? {};
    if (!type || !data) return jsonRes({ error: 'Missing type or data' }, 400);

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

    const now = new Date().toISOString().split('T')[0];

    if (type === 'session') {
      const { date, game, placements, guests, updatedBy } = data;
      const nextId = fileData.sessions.length
        ? Math.max(...fileData.sessions.map(s => s.id)) + 1
        : 1;
      fileData.sessions.push({ id: nextId, date, game, placements, guests: guests || [], updatedBy: updatedBy || 'Unknown', updatedAt: now });
      commitMessage = `Add session: ${game} (${date})${updatedBy ? ` by ${updatedBy}` : ''}`;

    } else if (type === 'update-session') {
      const { id, date, game, placements, guests, updatedBy } = data;
      const idx = fileData.sessions.findIndex(s => s.id === id);
      if (idx === -1) return jsonRes({ error: `Session ${id} not found` }, 404);
      fileData.sessions[idx] = { id, date, game, placements, guests: guests || [], updatedBy: updatedBy || 'Unknown', updatedAt: now };
      commitMessage = `Update session: ${game} (${date})${updatedBy ? ` by ${updatedBy}` : ''}`;

    } else if (type === 'delete-session') {
      const { id, deletedBy } = data;
      const idx = fileData.sessions.findIndex(s => s.id === id);
      if (idx === -1) return jsonRes({ error: `Session ${id} not found` }, 404);
      const s = fileData.sessions[idx];
      fileData.sessions.splice(idx, 1);
      commitMessage = `Delete session: ${s.game} (${s.date})${deletedBy ? ` by ${deletedBy}` : ''}`;

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
