// Pure page views: data in, HTML out. Shared by the Node server and the Cloudflare Worker.
import { CATEGORIES, OPEN_LICENSES, magnetFor } from './shared.mjs';
import { torrentJsonLd } from './discovery.mjs';
import {
  layout, logoHeader, searchForm, torrentTable, statsBar,
  esc, fmtSize, fmtDate, health,
} from './pages.mjs';

export function homeView({ latest, stats }) {
  const body = `
${logoHeader()}
${searchForm()}
<div class="banner">🏴‍☠️ <a href="/mirrors">Decentralized mirrors online.</a> Open licenses only. <a href="/policy">Open-source lives on.</a> 🤗</div>
${torrentTable(latest, { heading: 'Latest Torrents (Verified by Community)', sort: 'date' })}
${statsBar(stats)}`;
  return layout('The Hugging Bay — Search open-source models', body);
}

export function searchView({ q, cats, sort, rows }) {
  const baseQuery = new URLSearchParams(
    [['q', q], ...cats.map((c) => ['cat', c])].filter(([, v]) => v)
  ).toString();
  const body = `
${logoHeader({ small: true })}
${searchForm(q, cats)}
${torrentTable(rows, { heading: `Search results${q ? ` for “${esc(q)}”` : ''} (${rows.length})`, sort, baseQuery })}`;
  return layout(`${q || 'Search'} — The Hugging Bay`, body, { wide: true });
}

export function browseCatView({ cat, rows }) {
  const body = `
${logoHeader({ small: true })}
${torrentTable(rows, { heading: `${esc(CATEGORIES[cat].name)} (${rows.length})`, baseQuery: '' })}`;
  return layout(`${CATEGORIES[cat].name} — The Hugging Bay`, body, { wide: true });
}

export function browseIndexView({ counts }) {
  const byCat = new Map(counts.map((c) => [c.category, c]));
  const items = Object.entries(CATEGORIES).map(([key, c]) => {
    const n = byCat.get(key);
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

export function listView(title, sort, rows) {
  const body = `
${logoHeader({ small: true })}
${torrentTable(rows, { heading: title, sort })}`;
  return layout(`${title} — The Hugging Bay`, body, { wide: true });
}

export function detailView(t) {
  const [dots, label, color] = health(t);
  const magnet = magnetFor(t);
  const webseeds = t.webseeds_json ? JSON.parse(t.webseeds_json) : [];
  const files = t.files_json ? JSON.parse(t.files_json) : [];
  const fileRows = files.map((f) =>
    `<tr><td>${esc(f.path)}</td><td class="num">${fmtSize(f.size)}</td>
     <td><code style="font-size:11px">${esc(f.sha256 || '—')}</code></td></tr>`).join('\n');
  const body = `
${logoHeader({ small: true })}
<div class="detail">
<h2>${esc(t.name)}</h2>
<a class="magnet-box" href="${esc(magnet)}">🧲 ${esc(magnet)}</a>
${t.has_torrent ? `<p><a class="dl-torrent" href="/torrent/${esc(t.infohash)}.torrent">⬇ Download .torrent</a>
  <span class="fine">— recommended: the .torrent carries webseeds, so it downloads straight from the
  source even with no peers. Magnets need a peer to start.</span></p>` : ''}
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
${files.length ? `<h2>Files (${files.length}) + SHA-256 manifest</h2>
<table class="torrents"><thead><tr><th>Path</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>${fileRows}</tbody></table>` : ''}
<p class="fine">Verify before you trust: compare the SHA-256 of downloaded files against the upstream release listed above.</p>
</div>
<script type="application/ld+json">${JSON.stringify(torrentJsonLd(t, magnet)).replace(/</g, '\\u003c')}</script>`;
  return layout(`${t.name} — The Hugging Bay`, body, { wide: true });
}

export function fleetView({ totals, underSeeded, sailors }) {
  const crewRows = sailors.map((s, i) =>
    `<tr><td class="num">${i + 1}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.rank)}</td>
     <td class="num">${s.uploads}</td><td class="num">${fmtSize(s.bytes)}</td></tr>`).join('\n');
  const body = `
${logoHeader({ small: true })}
<h2>⚓ Fleet Status</h2>
<p class="notice"><b>${totals.torrents}</b> listings · <b>${fmtSize(totals.bytes || 0)}</b> indexed ·
  <b>${(totals.seeds || 0).toLocaleString()}</b> seeds · <b>${(totals.leechers || 0).toLocaleString()}</b> leechers</p>
<h2>🆘 Under-seeded — these ships need sailors</h2>
${torrentTable(underSeeded)}
<h2>🏆 Top Sailors</h2>
<table class="torrents"><thead><tr><th>#</th><th>Sailor</th><th>Rank</th><th>Uploads</th><th>Indexed</th></tr></thead>
<tbody>${crewRows}</tbody></table>
<p>Got spare disk? <a href="/about#sailor">Become a Sailor</a> — point your torrent client at the under-seeded list and keep the fleet afloat.</p>`;
  return layout('Fleet Status — The Hugging Bay', body, { wide: true });
}

export function submitView(msg = '', err = '') {
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
<p class="notice">Prefer the CLI: <code>node bay-cli.mjs create &lt;hf-repo-or-dir&gt; --publish</code> builds the
torrent, computes the manifest, and publishes here in one step.</p>
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

export function apiDocsView() {
  const body = `
${logoHeader({ small: true })}
<div class="prose">
<h2>API</h2>
<p>Everything on the Bay is available as JSON. No keys. Rate limits: 120 reads/min and
10 writes/min per IP. Machine-readable spec at <a href="/openapi.json">/openapi.json</a>;
agent orientation at <a href="/llms.txt">/llms.txt</a>. Intended for the
<code>bay-cli</code> torrent tool, seedbox automation, mirrors, and agents.</p>
<pre class="code">GET /api/torrents?q=llama&amp;cat=llm&amp;sort=seeds&amp;limit=50
GET /api/torrent/&lt;infohash&gt;
GET /torrent/&lt;infohash&gt;.torrent   (the .torrent file — has webseeds, no peer needed)
GET /api/stats
POST /api/torrents        (same fields as the upload form, JSON body)
POST /api/scrape          (seed-count updates; bearer token, used by the fleet scraper)</pre>
<p>Every torrent object includes <code>magnet</code>, <code>infohash</code>, <code>license</code>,
<code>source_url</code>, <code>webseeds</code>, <code>files</code> (SHA-256 manifest), and
<code>verified</code> (0 = unverified, 1 = community, 2 = captain).</p>
</div>`;
  return layout('API — The Hugging Bay', body);
}

export function aboutView() {
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

export function policyView() {
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
email <a href="mailto:takedown@thehuggingbay.io"><b>takedown@thehuggingbay.io</b></a> or open an issue.
Include the listing URL or infohash and the basis for removal. Non-compliant listings are removed
fast, no drama. We are here to preserve what's freely given, not to leak what isn't.</p>
</div>`;
  return layout('Policy — The Hugging Bay', body);
}

export function catalogView({ latest }) {
  const body = `
${logoHeader({ small: true })}
<div class="prose">
<h2>⚓ The catalog is a torrent</h2>
<p>The Bay's entire index — every listing, magnet, license tag, and SHA-256 manifest — is
periodically snapshotted into a small torrent of its own. Anyone seeding the catalog carries
the whole map. If this site ever disappears, the swarm keeps both the models <i>and the
index to them</i>.</p>
${latest ? `
<p><b>Latest snapshot:</b> <a href="/torrent/${esc(latest.infohash)}">${esc(latest.name)}</a>
(${fmtSize(latest.size_bytes)}, ${esc(fmtDate(latest.uploaded_at))})</p>
<a class="magnet-box" href="${esc(magnetFor(latest))}">🧲 ${esc(magnetFor(latest))}</a>
<p>Inside: <code>catalog.json</code> (machine-readable, same shape as <a href="/api">the API</a>)
and a README. Verify listings by re-hashing against each entry's SHA-256 manifest.</p>
<p><a href="/search?q=hugging-bay-catalog">All previous snapshots</a> stay listed and seedable.</p>`
    : '<p class="warn">No catalog snapshot published yet. The first one is coming.</p>'}
<p class="fine">Snapshots are CC0 — take them, mirror them, fork the Bay itself. That's the point.</p>
</div>`;
  return layout('Catalog — The Hugging Bay', body);
}

export function mirrorsView({ latest }) {
  const body = `
${logoHeader({ small: true })}
<div class="prose">
<h2>🪞 Mirrors</h2>
<p>The Bay is served from more than one place, and the index itself is downloadable. If one
copy goes dark, use another:</p>
<ul>
<li><b>Primary:</b> <a href="https://thehuggingbay.io">thehuggingbay.io</a> (live index, uploads enabled)</li>
<li><b>Static mirror:</b> <a href="https://the-hugging-bay.syndicalt.workers.dev" rel="noopener">the-hugging-bay.syndicalt.workers.dev</a> — read-only snapshot, refreshed daily</li>
<li><b>Static mirror:</b> <a href="https://syndicalt.github.io/thehuggingbay/" rel="noopener">syndicalt.github.io/thehuggingbay</a> — read-only snapshot on GitHub Pages, refreshed daily</li>
<li><b>The catalog torrent:</b> <a href="/catalog">the whole index as a magnet</a>${latest ? ` — currently <code>${esc(latest.infohash.slice(0, 12))}…</code>` : ''}</li>
</ul>
<h2>Run your own</h2>
<pre class="code">git clone https://github.com/syndicalt/thehuggingbay
cd thehuggingbay && node server.mjs   # zero dependencies, Node ≥ 22.5</pre>
<p>Every page is also exportable as flat HTML (<code>npm run build:static</code>) — host it
anywhere that serves files. The swarm doesn't care where the map came from.</p>
</div>`;
  return layout('Mirrors — The Hugging Bay', body);
}

export function notFoundView(msg = 'Lost at sea. 🌊 <a href="/">Back to port.</a>') {
  return layout('404', `${logoHeader({ small: true })}<p>${msg}</p>`);
}

export function errorView() {
  return layout('Error', `${logoHeader({ small: true })}<p class="warn">Kraken attack (internal error). Check the server log.</p>`);
}

export function torrentJson(t) {
  return {
    infohash: t.infohash, name: t.name, category: t.category,
    size_bytes: t.size_bytes, size: fmtSize(t.size_bytes),
    seeds: t.seeds, leechers: t.leechers,
    uploader: t.uploader, uploader_rank: t.uploader_rank,
    uploaded_at: t.uploaded_at, license: t.license, source_url: t.source_url,
    description: t.description, verified: t.verified,
    webseeds: t.webseeds_json ? JSON.parse(t.webseeds_json) : [],
    files: t.files_json ? JSON.parse(t.files_json) : [],
    magnet: magnetFor(t),
    torrent_url: t.has_torrent ? `https://thehuggingbay.io/torrent/${t.infohash}.torrent` : null,
  };
}
