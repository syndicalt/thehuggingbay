#!/usr/bin/env node
// bay-cli: turn a Hugging Face repo (or any local directory) into a published Bay torrent.
//
//   node bay-cli.mjs create openai/whisper-large-v3 --publish https://thehuggingbay.io
//   node bay-cli.mjs create ./some-local-dir --license MIT --category llm --no-publish
//
// Pipeline: (download) -> hash pieces + SHA-256 manifest -> .torrent + magnet -> publish.
// Zero dependencies; needs Node >= 22 and the `hf` CLI for downloads.
import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, basename, resolve } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { TRACKERS, OPEN_LICENSES, CATEGORIES } from './lib/shared.mjs';

const WS_BASE = process.env.BAY_WS_BASE || 'https://thehuggingbay.io/ws';
const DEFAULT_INDEX = process.env.BAY_INDEX || 'https://thehuggingbay.io';
const FLEET_DIR = process.env.BAY_FLEET || join(homedir(), 'bay-fleet');

// Hugging Face license slug -> Bay license tag. Anything unmapped needs --license.
const HF_LICENSE_MAP = {
  'apache-2.0': 'Apache-2.0', mit: 'MIT', 'bsd-3-clause': 'BSD-3-Clause',
  'gpl-3.0': 'GPL-3.0', 'agpl-3.0': 'AGPL-3.0',
  'cc0-1.0': 'CC0-1.0', 'cc-by-4.0': 'CC-BY-4.0', 'cc-by-sa-4.0': 'CC-BY-SA-4.0',
  'cc-by-nc-4.0': 'CC-BY-NC-4.0', 'odc-by': 'ODC-By-1.0',
  openrail: 'OpenRAIL', 'openrail++': 'OpenRAIL++-M', 'creativeml-openrail-m': 'OpenRAIL',
  'llama3.1': 'Llama-3.1-Community', gemma: 'Gemma', qwen: 'Qwen-License',
};

const PIPELINE_CATEGORY = {
  'text-generation': 'llm', 'text2text-generation': 'llm',
  'feature-extraction': 'emb', 'sentence-similarity': 'emb',
  'automatic-speech-recognition': 'aud', 'text-to-speech': 'aud', 'text-to-audio': 'aud',
  'text-to-image': 'vis', 'image-to-text': 'vis', 'image-text-to-text': 'vis',
  'image-classification': 'vis', 'object-detection': 'vis',
};

function bencode(v) {
  if (Buffer.isBuffer(v)) return Buffer.concat([Buffer.from(v.length + ':'), v]);
  if (typeof v === 'string') return bencode(Buffer.from(v, 'utf8'));
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`non-integer in bencode: ${v}`);
    return Buffer.from('i' + v + 'e');
  }
  if (Array.isArray(v)) return Buffer.concat([Buffer.from('l'), ...v.map(bencode), Buffer.from('e')]);
  const keys = Object.keys(v).sort();
  return Buffer.concat([
    Buffer.from('d'),
    ...keys.flatMap((k) => [bencode(k), bencode(v[k])]),
    Buffer.from('e'),
  ]);
}

function walkFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue; // .cache/, .gitattributes etc.
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push({ abs, path: relative(root, abs), size: statSync(abs).size });
    }
  };
  walk(root);
  if (!out.length) throw new Error(`no files found under ${root}`);
  return out;
}

function pickPieceLength(totalSize) {
  // Aim for ~2000 pieces, power of two, clamped to [256 KiB, 16 MiB].
  let p = 256 * 1024;
  while (p < totalSize / 2000 && p < 16 * 1024 * 1024) p *= 2;
  return p;
}

async function hashContent(files, pieceLength, totalSize) {
  const pieces = [];
  let pieceHasher = createHash('sha1');
  let pieceFill = 0;
  let done = 0;
  for (const f of files) {
    const fileHasher = createHash('sha256');
    for await (let chunk of createReadStream(f.abs)) {
      fileHasher.update(chunk);
      done += chunk.length;
      while (chunk.length) {
        const take = Math.min(chunk.length, pieceLength - pieceFill);
        pieceHasher.update(chunk.subarray(0, take));
        pieceFill += take;
        chunk = chunk.subarray(take);
        if (pieceFill === pieceLength) {
          pieces.push(pieceHasher.digest());
          pieceHasher = createHash('sha1');
          pieceFill = 0;
        }
      }
    }
    f.sha256 = fileHasher.digest('hex');
    process.stderr.write(`\r  hashing: ${(done / totalSize * 100).toFixed(1).padStart(5)}%  (${f.path.slice(0, 60)})${' '.repeat(20)}`);
  }
  if (pieceFill > 0) pieces.push(pieceHasher.digest());
  process.stderr.write('\n');
  return Buffer.concat(pieces);
}

async function hfModelInfo(repoId) {
  const res = await fetch(`https://huggingface.co/api/models/${repoId}`);
  if (!res.ok) throw new Error(`Hugging Face API ${res.status} for ${repoId}`);
  return res.json();
}

function hfDownload(repoId, dir) {
  console.log(`↓ downloading ${repoId} -> ${dir}`);
  const r = spawnSync('hf', ['download', repoId, '--local-dir', dir], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PATH: `${homedir()}/.local/bin:${process.env.PATH}` },
  });
  if (r.status !== 0) throw new Error(`hf download failed (exit ${r.status})`);
}

async function cmdCreate(target, opts) {
  let dir, sourceUrl = opts.source || null, license = opts.license || null;
  let category = opts.category || null, description = opts.description || null;
  let org = null, repo = null;

  const isHfId = /^[\w.-]+\/[\w.-]+$/.test(target) && !existsSync(target);
  if (isHfId) {
    [org, repo] = target.split('/');
    const info = await hfModelInfo(target);
    if (info.gated) throw new Error(`${target} is GATED on Hugging Face — the Bay does not list gated repos.`);
    const hfLicense = info.cardData?.license
      ?? info.tags?.find((t) => t.startsWith('license:'))?.slice(8);
    if (!license) {
      license = HF_LICENSE_MAP[hfLicense];
      if (!license) throw new Error(`unmapped HF license "${hfLicense}" — pass --license explicitly (must permit redistribution).`);
    }
    category ||= PIPELINE_CATEGORY[info.pipeline_tag] || 'llm';
    sourceUrl ||= `https://huggingface.co/${target}`;
    description ||= `Full mirror of the ${target} Hugging Face repository (${info.pipeline_tag || 'model'}).`;
    dir = join(FLEET_DIR, repo);
    if (!opts['skip-download']) hfDownload(target, dir);
  } else {
    dir = resolve(target);
    if (!statSync(dir).isDirectory()) throw new Error(`${dir} is not a directory`);
    if (!license) throw new Error('local directory: --license is required');
    category ||= 'llm';
  }
  if (!OPEN_LICENSES.includes(license)) throw new Error(`license "${license}" is not on the accepted open-license list`);
  if (!CATEGORIES[category]) throw new Error(`unknown category "${category}"`);

  const name = opts.name || basename(dir);
  const files = walkFiles(dir);
  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const pieceLength = pickPieceLength(totalSize);
  console.log(`⚒ ${name}: ${files.length} files, ${(totalSize / 1024 ** 3).toFixed(2)} GiB, piece size ${pieceLength / 1024 ** 2} MiB`);

  const pieces = await hashContent(files, pieceLength, totalSize);

  // Webseeds (BEP-19 multi-file: client appends "<name>/<path>" to a base ending in "/").
  // HF repos get the Bay's redirect shim; --webseed adds any HTTP mirror whose directory
  // layout matches <base>/<name>/<path>. The torrent name must match the directory the
  // mirror serves (for the shim: the HF repo short name).
  const extraSeeds = (opts.webseed || []).map((w) => {
    if (!/^https?:\/\//.test(w)) throw new Error(`webseed must be an http(s) URL: ${w}`);
    return w.endsWith('/') ? w : w + '/';
  });
  const webseeds = [
    ...(org && repo === name ? [`${WS_BASE}/${org}/`] : []),
    ...extraSeeds,
  ];

  const info = {
    files: files.map((f) => ({ length: f.size, path: f.path.split('/') })),
    name,
    'piece length': pieceLength,
    pieces,
  };
  const torrent = {
    announce: TRACKERS[0],
    'announce-list': TRACKERS.map((t) => [t]),
    comment: `The Hugging Bay | ${license} | ${sourceUrl || 'local'}`,
    'created by': 'bay-cli/0.1',
    'creation date': Math.floor(Date.now() / 1000),
    info,
    ...(webseeds.length ? { 'url-list': webseeds } : {}),
  };
  const infohash = createHash('sha1').update(bencode(info)).digest('hex');

  const outDir = opts.out || join(FLEET_DIR, 'torrents');
  mkdirSync(outDir, { recursive: true });
  const torrentPath = join(outDir, `${name}.torrent`);
  writeFileSync(torrentPath, bencode(torrent));
  const manifest = {
    name, infohash, category, license, source_url: sourceUrl,
    size_bytes: totalSize, piece_length: pieceLength, webseeds,
    files: files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
  };
  writeFileSync(join(outDir, `${name}.manifest.json`), JSON.stringify(manifest, null, 2));

  const magnet = `magnet:?xt=urn:btih:${infohash}&dn=${encodeURIComponent(name)}`
    + TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('')
    + webseeds.map((w) => `&ws=${encodeURIComponent(w)}`).join('');
  console.log(`✔ torrent: ${torrentPath}`);
  console.log(`✔ infohash: ${infohash}`);
  console.log(`🧲 ${magnet}`);

  if (opts.publish !== false) {
    const index = typeof opts.publish === 'string' ? opts.publish : DEFAULT_INDEX;
    const body = {
      ...manifest,
      uploader: opts.uploader || process.env.BAY_UPLOADER || userInfo().username,
      description,
    };
    const res = await fetch(`${index}/api/torrents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 201) console.log(`⚓ published to ${index}/torrent/${infohash}`);
    else console.error(`✘ publish failed (${res.status}): ${await res.text()}`);
  }
  return { torrentPath, infohash, name };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    category: { type: 'string' },
    license: { type: 'string' },
    source: { type: 'string' },
    description: { type: 'string' },
    uploader: { type: 'string' },
    out: { type: 'string' },
    webseed: { type: 'string', multiple: true },
    publish: { type: 'string' },
    'no-publish': { type: 'boolean' },
    'skip-download': { type: 'boolean' },
  },
});

const [cmd, target] = positionals;
if (cmd !== 'create' || !target) {
  console.log(`bay-cli — create & publish Hugging Bay torrents

Usage:
  node bay-cli.mjs create <org/repo | local-dir> [options]

Options:
  --license <tag>      Bay license tag (auto-detected from HF; required for local dirs)
  --category <cat>     ${Object.keys(CATEGORIES).join('|')} (auto-detected from HF)
  --name <name>        torrent name (default: directory name)
  --uploader <name>    sailor name (default: $BAY_UPLOADER or OS user)
  --publish <url>      index to publish to (default: ${DEFAULT_INDEX})
  --no-publish         build the torrent but don't publish the listing
  --skip-download      HF repo already downloaded to $BAY_FLEET/<repo>
  --out <dir>          output dir for .torrent + manifest (default: $BAY_FLEET/torrents)
  --webseed <url>      extra BEP-19 webseed base (repeatable); the mirror must serve files
                       at <url>/<torrent-name>/<file-path>. HF repos get the Bay shim
                       webseed automatically; use this for non-HF mirrors.`);
  process.exit(cmd ? 1 : 0);
}
cmdCreate(target, { ...values, publish: values['no-publish'] ? false : values.publish })
  .catch((err) => { console.error(`✘ ${err.message}`); process.exit(1); });
