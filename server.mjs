import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getDb, searchTorrents, getTorrent, randomTorrent, categoryCounts,
  fleetStats, insertTorrent, topUploaders, magnetFor,
  CATEGORIES, OPEN_LICENSES,
} from './lib/db.mjs';
import {
  layout, logoHeader, searchForm, torrentTable, statsBar,
  esc, fmtSize, fmtDate, health,
} from './lib/pages.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 1337);
const CSS = readFileSync(join(ROOT, 'public', 'style.css'));

getDb(); // open + seed on first run

/* ---------- page handlers ---------- */

function home() {
  const latest = searchTorrents({ sort: 'date', limit: 15 });
  const stats = fleetStats().totals;
  const body = `
${logoHeader()}
${searchForm()}
<div class="banner">🏴‍☠️ Decentralized mirrors online. Open licenses only — no DMCA needed when redistribution is the license. <a href="/policy">Open-source lives on.</a> 🤗
  <div class="fine">Demo instance — listings are placeholder data until the fleet seeds real torrents.</div>
</div>
${torrentTable(latest, { heading: 'Latest Torrents (Verified by Community)', sort: 'date' })}
${statsBar(stats)}`;
  return layout('The Hugging Bay — Search open-source models', body);
}

function search(url) {
  const q = url.searchParams.get('q') || '';
  const cats = url.searchParams.getAll('cat').filter(Boolean);
  const sort = url.searchParams.get('sort') || 'seeds';
  const rows = searchTorrents({ q, cats, sort, limit: 100 });
  const baseQuery = new URLSearchParams(
    [['q', q], ...cats.map((c) => ['cat', c])].filter(([, v]) => v)
  ).toString();
  const body = `
${logoHeader({ small: true })}
${searchForm(q, cats)}
${torrentTable(rows, { heading: `Search results${q ? ` for “${esc(q)}”` : ''} (${rows.length})`, sort, baseQuery })}`;
  return layout(`${q || 'Search'} — The Hugging Bay`, body, { wide: true });
}

function browse(cat) {
  if (cat) {
    if (!CATEGORIES[cat]) return null;
    const rows = searchTorrents({ cats: [cat], sort: 'seeds', limit: 200 });
    const body = `
${logoHeader({ small: true })}
${torrentTable(rows, { heading: `${esc(CATEGORIES[cat].name)} (${rows.length})`, baseQuery: '' })}`;
    return layout(`${CATEGORIES[cat].name} — The Hugging Bay`, body, { wide: true });
  }
  const counts = new Map(categoryCounts().map((c) => [c.category, c]));
  const items = Object.entries(CATEGORIES).map(([key, c]) => {
    const n = counts.get(key);
    return `<tr><td class="type"><a class="cat" style="background:${c.color}" href="/browse/${key}">${c.label}</a></td>
      <td><a href="/browse/${key}"><b>${esc(c.name)}</b></a></td>
      <td class="num">${n ? n.n : 0} torrents</td>
      <td class="num">${n ? fmtSize(n.bytes) : '—'}</td></tr>`;
  }).join('\n');
  const body = `
${logoHeader({ small: true })}
<h2>Browse Models</h2>
<table class="torrents"><thead><tr><th>Type</th><th>Category</th><th>Listings</th><th>Total size</th></tr></thead>
<tbody>${items}</tbody></table>`;
  return layout('Browse — The Hugging Bay', body);
}

function listPage(title, sort) {
  const rows = searchTorrents({ sort, limit: 100 });
  const body = `
${logoHeader({ small: true })}
${torrentTable(rows, { heading: title, sort })}`;
  return layout(`${title} — The Hugging Bay`, body, { wide: true });
}

function detail(infohash) {
  const t = getTorrent(infohash);
  if (!t) return null;
  const [dots, label, color] = health(t);
  const magnet = magnetFor(t);
  const webseeds = t.webseeds_json ? JSON.parse(t.webseeds_json) : [];
  const body = `
${logoHeader({ small: true })}
<div class="detail">
<h2>${esc(t.name)}</h2>
<a class="magnet-box" href="${esc(magnet)}">🧲 ${esc(magnet)}</a>
<dl>
  <dt>Category</dt><dd><a href="/browse/${esc(t.category)}">${esc(CATEGORIES[t.category]?.name || t.category)}</a></dd>
  <dt>Size</dt><dd>${fmtSize(t.size_bytes)}</dd>
  <dt>Infohash</dt><dd><code>${esc(t.infohash)}</code></dd>
  <dt>Swarm</dt><dd><b style="color:#0a7a2f">${t.seeds.toLocaleString()} seeds</b> / ${t.leechers.toLocaleString()} leechers
    — <span style="color:${color}">${dots} ${label}</span></dd>
  <dt>License</dt><dd>${esc(t.license)}</dd>
  <dt>Upstream source</dt><dd>${t.source_url ? `<a href="${esc(t.source_url)}" rel="noopener">${esc(t.source_url)}</a>` : '—'}</dd>
  <dt>Webseeds</dt><dd>${webseeds.length ? webseeds.map((w) => esc(w)).join('<br>') : 'none'}</dd>
  <dt>Verification</dt><dd>${t.verified >= 2 ? '🏴‍☠️✔ Captain-verified — SHA-256 manifest matches upstream release'
    : t.verified === 1 ? '✔ Community-verified' : '<b style="color:#b02a0a">Unverified</b> — checksums not yet confirmed against upstream'}</dd>
  <dt>Uploaded</dt><dd>${esc(fmtDate(t.uploaded_at))} by <b>${esc(t.uploader || 'anonymous')}</b> (${esc(t.uploader_rank || 'Sailor')})</dd>
</dl>
<h2>Description</h2>
<p>${esc(t.description || 'No description.')}</p>
<p class="fine">Verify before you trust: compare the SHA-256 of downloaded files against the upstream release listed above.</p>
</div>`;
  return layout(`${t.name} — The Hugging Bay`, body, { wide: true });
}

function lucky(url) {
  const q = url.searchParams.get('q') || '';
  const cats = url.searchParams.getAll('cat').filter(Boolean);
  const rows = q || cats.length ? searchTorrents({ q, cats, limit: 500 }) : [randomTorrent()];
  const pick = rows[Math.floor(Math.random() * rows.length)];
  return pick ? `/torrent/${pick.infohash}` : '/';
}

function fleet() {
  const { totals, underSeeded } = fleetStats();
  const sailors = topUploaders();
  const crewRows = sailors.map((s, i) =>
    `<tr><td class="num">${i + 1}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.rank)}</td>
     <td class="num">${s.uploads}</td><td class="num">${fmtSize(s.bytes)}</td></tr>`).join('\n');
  const body = `
${logoHeader({ small: true })}
<h2>⚓ Fleet Status</h2>
<p class="notice"><b>${totals.torrents}</b> listings · <b>${fmtSize(totals.bytes || 0)}</b> indexed ·
  <b>${totals.seeds.toLocaleString()}</b> seeds · <b>${totals.leechers.toLocaleString()}</b> leechers</p>
<h2>🆘 Under-seeded — these ships need sailors</h2>
${torrentTable(underSeeded)}
<h2>🏆 Top Sailors</h2>
<table class="torrents"><thead><tr><th>#</th><th>Sailor</th><th>Rank</th><th>Uploads</th><th>Indexed</th></tr></thead>
<tbody>${crewRows}</tbody></table>
<p>Got spare disk? <a href="/about#sailor">Become a Sailor</a> — point your torrent client at the under-seeded list and keep the fleet afloat.</p>`;
  return layout('Fleet Status — The Hugging Bay', body, { wide: true });
}

function submitPage(msg = '', err = '') {
  const catOpts = Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${esc(c.name)}</option>`).join('');
  const licOpts = OPEN_LICENSES.map((l) => `<option>${esc(l)}</option>`).join('');
  const body = `
${logoHeader({ small: true })}
<h2>Upload a torrent</h2>
${msg ? `<p class="notice">${msg}</p>` : ''}
${err ? `<p class="warn">${err}</p>` : ''}
<p class="warn"><b>Open licenses only.</b> The artifact's license must explicitly permit redistribution.
No gated repos, no leaked weights, no “trust me bro” licenses. Listings start as
<b>Unverified</b> until a Captain confirms the SHA-256 manifest against the upstream release.</p>
<form class="upload" method="post" action="/submit">
  <label>Name</label><input name="name" required maxlength="200" placeholder="Llama-3.1-70B-Instruct">
  <label>Infohash (40-char hex, BTv1)</label><input name="infohash" required pattern="[a-fA-F0-9]{40}" placeholder="e.g. from your torrent client">
  <label>Category</label><select name="category">${catOpts}</select>
  <label>Size (bytes)</label><input name="size_bytes" type="number" required min="1">
  <label>License</label><select name="license">${licOpts}</select>
  <label>Upstream source URL</label><input name="source_url" type="url" placeholder="https://huggingface.co/...">
  <label>Your sailor name</label><input name="uploader" required maxlength="40" placeholder="CaptainHug">
  <label>Description</label><textarea name="description" rows="4" maxlength="2000"></textarea>
  <div class="buttons"><button type="submit">Hoist the flag 🏴‍☠️</button></div>
</form>`;
  return layout('Upload — The Hugging Bay', body);
}

function handleSubmit(form) {
  const infohash = (form.get('infohash') || '').trim().toLowerCase();
  const name = (form.get('name') || '').trim();
  const category = form.get('category');
  const license = form.get('license');
  const size = Number(form.get('size_bytes'));
  const uploader = (form.get('uploader') || '').trim() || 'anonymous';
  if (!/^[a-f0-9]{40}$/.test(infohash)) return submitPage('', 'Infohash must be 40 hex characters.');
  if (!name) return submitPage('', 'Name is required.');
  if (!CATEGORIES[category]) return submitPage('', 'Invalid category.');
  if (!OPEN_LICENSES.includes(license)) return submitPage('', 'License must be one of the accepted open licenses.');
  if (!Number.isFinite(size) || size < 1) return submitPage('', 'Size must be a positive number of bytes.');
  if (getTorrent(infohash)) return submitPage('', 'That infohash is already listed.');
  insertTorrent({
    infohash, name, category, license, size_bytes: Math.round(size),
    uploader, source_url: form.get('source_url') || null,
    description: form.get('description') || null, verified: 0,
  });
  return submitPage(`Listed! <a href="/torrent/${esc(infohash)}">View your listing</a> — it is Unverified until a Captain checks the manifest.`);
}

function apiDocs() {
  const body = `
${logoHeader({ small: true })}
<div class="prose">
<h2>API</h2>
<p>Everything on the Bay is available as JSON. No keys, no rate limits (yet). Intended for the
torrent-creation CLI, seedbox automation, and mirrors.</p>
<pre class="code">GET /api/torrents?q=llama&amp;cat=llm&amp;sort=seeds&amp;limit=50
GET /api/torrent/&lt;infohash&gt;
GET /api/stats
POST /api/torrents        (same fields as the upload form, JSON body)</pre>
<p>Every torrent object includes <code>magnet</code>, <code>infohash</code>, <code>license</code>,
<code>source_url</code>, <code>webseeds</code>, and <code>verified</code> (0 = unverified,
1 = community, 2 = captain).</p>
</div>`;
  return layout('API — The Hugging Bay', body);
}

function about() {
  const body = `
${logoHeader({ small: true })}
<div class="prose">
<h2>What is this?</h2>
<p>The Hugging Bay is a community-run <b>index</b> of BitTorrent magnet links for AI models, weights,
and datasets whose licenses explicitly permit redistribution. Centralized hubs are single points of
failure — policy pressure, geo-blocking, bandwidth caps. A swarm is not. The Bay never hosts files;
it catalogs verified magnets and the fleet does the rest.</p>
<h2 id="sailor">How to become a Sailor</h2>
<ol>
<li><b>Get a torrent client</b> that handles large multi-file torrents well (qBittorrent, Transmission, rtorrent).</li>
<li><b>Pick ships from the <a href="/fleet">under-seeded list</a></b> — sorted so the most at-risk models surface first.</li>
<li><b>Seed long-term.</b> Ratio doesn't matter here; uptime does. A NAS in a closet beats a fast box that vanishes.</li>
<li><b>Verify what you seed:</b> compare SHA-256 checksums against the upstream release linked on each listing.</li>
<li>Optionally <a href="/submit">upload</a> torrents for models we're missing — open licenses only.</li>
</ol>
<h2>Crew ranks</h2>
<p><b>Sailor</b> — seeds and contributes. <b>First Mate</b> — trusted uploader with a track record of
clean manifests. <b>Captain</b> — verifies listings: re-hashes content against upstream checksums and
signs off. Captain-verified listings carry the 🏴‍☠️✔ badge.</p>
<h2>Principles</h2>
<ul>
<li><b>Index only, never host.</b></li>
<li><b>Verification first.</b> Every listing links its upstream source; SHA-256 manifests are checked before the badge.</li>
<li><b>Open licenses only.</b> If the license doesn't permit redistribution, it doesn't sail. See <a href="/policy">policy</a>.</li>
</ul>
<p class="tagline">Sailors unite. ⛵🤗</p>
</div>`;
  return layout('About — The Hugging Bay', body);
}

function policy() {
  const body = `
${logoHeader({ small: true })}
<div class="prose">
<h2>Content policy</h2>
<p>The Hugging Bay indexes only artifacts whose licenses <b>explicitly permit redistribution</b>:
Apache-2.0, MIT, BSD, CC and ODC families, OpenRAIL variants, and community licenses that grant
redistribution rights (e.g. Llama Community, Gemma, Qwen). The pirate flag is aesthetic; the
cargo is legal.</p>
<ul>
<li><b>Never listed:</b> gated or access-controlled repos, leaked or proprietary weights, artifacts
with no license or a no-redistribution clause, and anything containing private data.</li>
<li><b>Attribution preserved:</b> listings must link the upstream source; torrents should include the
original LICENSE and README files.</li>
<li><b>License terms travel with the cargo:</b> some accepted licenses carry conditions
(attribution, NC clauses, acceptable-use policies). Downstream users are bound by them; the Bay
surfaces the license tag on every listing so nobody is surprised.</li>
</ul>
<h2 id="takedown">Takedown</h2>
<p>If something is listed that shouldn't be — wrong license tag, gated content, personal data —
open an issue or contact the crew. Non-compliant listings are removed fast, no drama. We are here
to preserve what's freely given, not to leak what isn't.</p>
</div>`;
  return layout('Policy — The Hugging Bay', body);
}

/* ---------- API ---------- */

function torrentJson(t) {
  return {
    infohash: t.infohash, name: t.name, category: t.category,
    size_bytes: t.size_bytes, size: fmtSize(t.size_bytes),
    seeds: t.seeds, leechers: t.leechers,
    uploader: t.uploader, uploader_rank: t.uploader_rank,
    uploaded_at: t.uploaded_at, license: t.license, source_url: t.source_url,
    description: t.description, verified: t.verified,
    webseeds: t.webseeds_json ? JSON.parse(t.webseeds_json) : [],
    magnet: magnetFor(t),
  };
}

/* ---------- router ---------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const send = (status, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  const json = (status, obj) => send(status, JSON.stringify(obj, null, 2), 'application/json');
  const redirect = (loc) => { res.writeHead(302, { location: loc }); res.end(); };

  try {
    if (path === '/style.css') return send(200, CSS, 'text/css');
    if (req.method === 'GET') {
      if (path === '/') return send(200, home());
      if (path === '/search') return send(200, search(url));
      if (path === '/lucky') return redirect(lucky(url));
      if (path === '/recent') return send(200, listPage('Recent Uploads', 'date'));
      if (path === '/top100') return send(200, listPage('Top 100 (by seeds)', 'seeds'));
      if (path === '/browse') return send(200, browse());
      if (path.startsWith('/browse/')) {
        const page = browse(path.slice(8));
        return page ? send(200, page) : send(404, layout('404', `${logoHeader({ small: true })}<p>Unknown category.</p>`));
      }
      if (path.startsWith('/torrent/')) {
        const page = detail(path.slice(9).toLowerCase());
        return page ? send(200, page) : send(404, layout('404', `${logoHeader({ small: true })}<p>No such torrent. Lost at sea. 🌊</p>`));
      }
      if (path === '/submit') return send(200, submitPage());
      if (path === '/fleet') return send(200, fleet());
      if (path === '/api') return send(200, apiDocs());
      if (path === '/about') return send(200, about());
      if (path === '/policy') return send(200, policy());
      if (path === '/api/stats') {
        const { totals } = fleetStats();
        return json(200, totals);
      }
      if (path === '/api/torrents') {
        const rows = searchTorrents({
          q: url.searchParams.get('q') || '',
          cats: url.searchParams.getAll('cat').filter(Boolean),
          sort: url.searchParams.get('sort') || 'seeds',
          limit: Number(url.searchParams.get('limit') || 100),
        });
        return json(200, rows.map(torrentJson));
      }
      if (path.startsWith('/api/torrent/')) {
        const t = getTorrent(path.slice(13).toLowerCase());
        return t ? json(200, torrentJson(t)) : json(404, { error: 'not found' });
      }
    }
    if (req.method === 'POST' && (path === '/submit' || path === '/api/torrents')) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 64 * 1024) return send(413, 'Too large');
      }
      if (path === '/api/torrents') {
        const data = JSON.parse(body);
        const form = new Map(Object.entries(data).map(([k, v]) => [k, String(v ?? '')]));
        const page = handleSubmit({ get: (k) => form.get(k) });
        const t = getTorrent(String(data.infohash || '').toLowerCase());
        return t ? json(201, torrentJson(t)) : json(400, { error: 'rejected — check fields and license' });
      }
      return send(200, handleSubmit(new URLSearchParams(body)));
    }
    return send(404, layout('404', `${logoHeader({ small: true })}<p>Lost at sea. 🌊 <a href="/">Back to port.</a></p>`));
  } catch (err) {
    console.error(err);
    return send(500, layout('Error', `${logoHeader({ small: true })}<p class="warn">Kraken attack (internal error). Check the server log.</p>`));
  }
});

server.listen(PORT, () => {
  console.log(`🏴‍☠️🤗 The Hugging Bay is sailing at http://localhost:${PORT}`);
});
