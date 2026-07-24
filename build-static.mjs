// Static export for GitHub Pages: spawns the server, crawls every route into docs/,
// rewrites absolute links for the Pages base path, and injects client-side JS for
// search/filter/sort (no backend on Pages).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_DIR ? join(ROOT, process.env.OUT_DIR) : join(ROOT, 'docs');
const BASE = process.env.BASE_PATH ?? '/thehuggingbay';
// BAY_ORIGIN=https://thehuggingbay.io crawls the live index (real catalog);
// unset, it spawns the local dev server (demo catalog).
const LIVE = process.env.BAY_ORIGIN || null;
const PORT = 13999;
const ORIGIN = LIVE || `http://localhost:${PORT}`;

const server = LIVE ? null : spawn('node', [join(ROOT, 'server.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { await fetch(ORIGIN + '/api/stats'); return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no response from ${ORIGIN}`);
}

const rewrite = (html) => html
  .replaceAll('action="/search"', `action="${BASE}/search/"`)
  .replaceAll('formaction="/lucky"', `formaction="${BASE}/lucky/"`)
  .replace(/((?:href|src)=")\/(?!\/)/g, `$1${BASE}/`);

function outFile(route) {
  if (route === '/') return join(OUT, 'index.html');
  return join(OUT, route.replace(/^\//, ''), 'index.html');
}

async function save(route, { inject = '', file } = {}) {
  const res = await fetch(ORIGIN + route);
  if (!res.ok) throw new Error(`${route} -> ${res.status}`);
  let html = rewrite(await res.text());
  if (inject) html = html.replace('</body>', inject + '\n</body>');
  const path = file ? join(OUT, file) : outFile(route.split('?')[0]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}

const SEARCH_JS = `<script>
(function () {
  const p = new URLSearchParams(location.search);
  const q = (p.get('q') || '').trim().toLowerCase();
  const cats = p.getAll('cat').filter(Boolean);
  const sort = p.get('sort') || 'seeds';
  const tbody = document.querySelector('table.torrents tbody');
  if (!tbody) return;
  const rows = [...tbody.querySelectorAll('tr[data-name]')];
  let shown = 0;
  for (const r of rows) {
    const hay = r.dataset.name + ' ' + r.querySelector('.sub').textContent.toLowerCase();
    const ok = (!q || hay.includes(q)) && (!cats.length || cats.includes(r.dataset.cat));
    r.style.display = ok ? '' : 'none';
    if (ok) shown++;
  }
  const key = {
    seeds: (r) => -Number(r.dataset.seeds),
    size: (r) => -Number(r.dataset.size),
    date: (r) => -Date.parse(r.dataset.date),
    name: (r) => r.dataset.name,
  }[sort] || ((r) => -Number(r.dataset.seeds));
  rows.map((r) => [key(r), r]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .forEach(([, r]) => tbody.appendChild(r));
  const h2 = document.querySelector('h2');
  if (h2) h2.textContent = 'Search results' + (q ? ' for \\u201c' + q + '\\u201d' : '') + ' (' + shown + ')';
  const input = document.querySelector('input[type=search]');
  if (input) input.value = p.get('q') || '';
  document.querySelectorAll('.cats input').forEach((c) => {
    c.checked = cats.length ? cats.includes(c.value) : c.value === '';
  });
  // keep q/cat when clicking a sort header
  document.querySelectorAll('thead a').forEach((a) => {
    const s = new URL(a.href).searchParams.get('sort');
    if (!s) return;
    const np = new URLSearchParams(location.search);
    np.set('sort', s);
    a.href = '?' + np.toString();
  });
})();
</script>`;

const STATIC_NOTE = `<p class="warn"><b>Static mirror:</b> this copy of the Bay is read-only, so uploads are
disabled here. Use the <a href="https://thehuggingbay.io/submit">primary index</a>, run your own
(<code>node server.mjs</code>), or open a GitHub issue with your magnet + license + upstream link.</p>`;

async function main() {
  await waitForServer();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, '.nojekyll'), '');
  cpSync(join(ROOT, 'public', 'style.css'), join(OUT, 'style.css'));
  cpSync(join(ROOT, 'public', 'banner.webp'), join(OUT, 'banner.webp'));
  cpSync(join(ROOT, 'public', 'card.jpg'), join(OUT, 'card.jpg'));

  const torrents = await (await fetch(`${ORIGIN}/api/torrents?limit=500`)).json();
  mkdirSync(join(OUT, 'api'), { recursive: true });
  writeFileSync(join(OUT, 'api', 'torrents.json'), JSON.stringify(torrents, null, 2));
  const stats = await (await fetch(`${ORIGIN}/api/stats`)).json();
  writeFileSync(join(OUT, 'api', 'stats.json'), JSON.stringify(stats, null, 2));
  for (const f of ['llms.txt', 'openapi.json']) {
    writeFileSync(join(OUT, f), await (await fetch(`${ORIGIN}/${f}`)).text());
  }

  const cats = ['llm', 'emb', 'vis', 'aud', 'agt', 'data', 'app', 'meme'];
  await save('/');
  await save('/search?sort=seeds', { inject: SEARCH_JS, file: 'search/index.html' });
  await save('/recent');
  await save('/top100');
  await save('/browse');
  for (const c of cats) await save(`/browse/${c}`);
  for (const t of torrents) await save(`/torrent/${t.infohash}`);
  await save('/fleet');
  await save('/about');
  await save('/policy');
  await save('/api');
  await save('/catalog');
  await save('/mirrors');

  const submitRes = rewrite(await (await fetch(`${ORIGIN}/submit`)).text())
    .replace('<h2>Upload a torrent</h2>', `<h2>Upload a torrent</h2>\n${STATIC_NOTE}`)
    .replace('<form class="upload"', '<form class="upload" onsubmit="alert(\'Static demo — run the server locally to upload.\'); return false;"');
  mkdirSync(join(OUT, 'submit'), { recursive: true });
  writeFileSync(join(OUT, 'submit', 'index.html'), submitRes);

  const luckyTargets = JSON.stringify(torrents.map((t) => `${BASE}/torrent/${t.infohash}/`));
  mkdirSync(join(OUT, 'lucky'), { recursive: true });
  writeFileSync(join(OUT, 'lucky', 'index.html'), `<!doctype html><meta charset="utf-8">
<title>I'm Feeling Lucky</title>
<script>const t=${luckyTargets};location.replace(t[Math.floor(Math.random()*t.length)]);</script>`);

  console.log(`Static site built (${torrents.length} torrents, base path "${BASE}")`);
}

main().then(
  () => { server?.kill(); process.exit(0); },
  (err) => { console.error(err); server?.kill(); process.exit(1); },
);
