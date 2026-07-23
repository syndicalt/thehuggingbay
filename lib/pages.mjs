import { CATEGORIES, OPEN_LICENSES, magnetFor } from './db.mjs';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function fmtSize(bytes) {
  if (bytes >= 1024 ** 4) return (bytes / 1024 ** 4).toFixed(2) + ' TB';
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + ' GB';
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + ' MB';
  return (bytes / 1024).toFixed(0) + ' KB';
}

export function fmtDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = d.toTimeString().slice(0, 5);
  if (sameDay) return `Today ${hm}`;
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Y-day ${hm}`;
  return d.toISOString().slice(0, 10);
}

export function health(t) {
  if (t.seeds >= 500) return ['◉◉◉', 'Excellent', '#0a7a2f'];
  if (t.seeds >= 50) return ['◉◉○', 'Healthy', '#5a8a0a'];
  if (t.seeds >= 5) return ['◉○○', 'Fair', '#b07a0a'];
  return ['○○○', 'At risk', '#b02a0a'];
}

const verifiedBadge = (v) =>
  v >= 2 ? '<span class="badge captain" title="Captain-verified: SHA-256 manifest matches upstream release">🏴‍☠️✔</span>'
  : v === 1 ? '<span class="badge community" title="Community-verified">✔</span>'
  : '<span class="badge unverified" title="Unverified — checksums not yet confirmed">?</span>';

function catBadge(cat) {
  const c = CATEGORIES[cat] || { label: cat.toUpperCase(), color: '#eee' };
  return `<a class="cat" style="background:${c.color}" href="/browse/${esc(cat)}">${esc(c.label)}</a>`;
}

export function layout(title, body, { wide = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🤗</text></svg>">
</head>
<body>
<div class="page${wide ? ' wide' : ''}">
${body}
<footer>
  <nav>
    <a href="/submit">Upload</a> | <a href="/fleet">Fleet Status</a> | <a href="/api">API</a> |
    <a href="/policy">Policy</a> | <a href="/policy#takedown">Takedown</a> | <a href="/about">About</a>
  </nav>
  <p class="tagline">🤗 Hug more. Gatekeep less. 🏴‍☠️</p>
  <p class="fine">The Hugging Bay indexes magnet links for openly-licensed AI artifacts only. No files are hosted here.</p>
</footer>
</div>
</body>
</html>`;
}

export function logoHeader({ small = false } = {}) {
  return `
<header class="${small ? 'small' : ''}">
  <a class="logo" href="/"><span class="logo-emoji">🏴‍☠️🤗⛵</span>
  <h1>The Hugging Bay</h1></a>
  <nav class="topnav">
    <a href="/">Search Models</a> | <a href="/browse">Browse Models</a> |
    <a href="/recent">Recent Uploads</a> | <a href="/top100">Top 100</a>
  </nav>
</header>`;
}

export function searchForm(q = '', cats = []) {
  const allChecked = cats.length === 0 ? 'checked' : '';
  const boxes = Object.entries(CATEGORIES).map(([key, c]) =>
    `<label><input type="checkbox" name="cat" value="${key}" ${cats.includes(key) ? 'checked' : ''}> ${esc(c.name)}</label>`
  ).join('\n');
  return `
<form class="search" action="/search" method="get">
  <input type="search" name="q" value="${esc(q)}" placeholder="Search open-source models..." autofocus>
  <div class="cats">
    <label><input type="checkbox" name="cat" value="" ${allChecked} onclick="this.form.querySelectorAll('[name=cat]').forEach(c=>{if(c!==this)c.checked=false})"> All</label>
    ${boxes}
  </div>
  <div class="buttons">
    <button type="submit">Search Torrents</button>
    <button type="submit" formaction="/lucky">I'm Feeling Lucky</button>
  </div>
</form>`;
}

export function torrentTable(rows, { heading = '', sort = 'seeds', baseQuery = '' } = {}) {
  const sortLink = (key, label) => {
    const arrow = sort === key ? ' ↓' : '';
    return `<a href="?${baseQuery}${baseQuery ? '&' : ''}sort=${key}">${label}${arrow}</a>`;
  };
  const body = rows.map((t) => {
    const [dots, label, color] = health(t);
    return `<tr>
  <td class="type">${catBadge(t.category)}</td>
  <td class="name">
    <a class="tname" href="/torrent/${esc(t.infohash)}">${esc(t.name)}</a> ${verifiedBadge(t.verified)}
    <a class="mag" href="${esc(magnetFor(t))}" title="Magnet link">🧲</a>
    <div class="sub">Uploaded ${esc(fmtDate(t.uploaded_at))}, by <b>${esc(t.uploader || 'anonymous')}</b>
      · ${esc(t.license)} · <span style="color:${color}" title="Health: ${label}">${dots}</span></div>
  </td>
  <td class="num">${fmtSize(t.size_bytes)}</td>
  <td class="num seeds">${t.seeds.toLocaleString()}</td>
  <td class="num leech">${t.leechers.toLocaleString()}</td>
  <td class="date">${esc(fmtDate(t.uploaded_at))}</td>
</tr>`;
  }).join('\n');
  return `
${heading ? `<h2>${heading}</h2>` : ''}
<table class="torrents">
<thead><tr>
  <th>Type</th>
  <th>${sortLink('name', 'Name')} <span class="dim">(Order by: ${esc(sort)})</span></th>
  <th>${sortLink('size', 'Size')}</th>
  <th>${sortLink('seeds', 'Seeds')}</th>
  <th>Leechers</th>
  <th>${sortLink('date', 'Uploaded')}</th>
</tr></thead>
<tbody>${body || '<tr><td colspan="6" class="empty">No torrents found. The sea is calm... too calm.</td></tr>'}</tbody>
</table>`;
}

export function statsBar(stats) {
  return `<p class="statsbar">Hugging Bay Proxy List: 12 | Total models: ${stats.torrents.toLocaleString()} |
    Total capacity indexed: ${fmtSize(stats.bytes || 0)} | Total peers: ${(stats.seeds + stats.leechers).toLocaleString()}</p>`;
}
