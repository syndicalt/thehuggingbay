#!/usr/bin/env node
// bay-scrape: refresh real swarm stats for every listed torrent.
// Scrapes the Bay's UDP trackers (BEP-15) and pushes seed/leech counts to the index.
//
//   BAY_INDEX=https://thehuggingbay.io BAY_SCRAPE_TOKEN=... node bay-scrape.mjs
//
// Run from cron/systemd-timer on any fleet box. Zero dependencies.
import { createSocket } from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { TRACKERS } from './lib/shared.mjs';

const INDEX = process.env.BAY_INDEX || 'https://thehuggingbay.io';
const TOKEN = process.env.BAY_SCRAPE_TOKEN;
const TIMEOUT_MS = 8000;
const BATCH = 70; // max infohashes per scrape packet (BEP-15 limit is 74)

function udpRequest(host, port, buildPacket, expectAction) {
  return new Promise((resolve, reject) => {
    const sock = createSocket('udp4');
    const tid = randomBytes(4);
    const timer = setTimeout(() => { sock.close(); reject(new Error('timeout')); }, TIMEOUT_MS);
    sock.on('error', (e) => { clearTimeout(timer); sock.close(); reject(e); });
    sock.on('message', (msg) => {
      if (msg.length < 8 || msg.readUInt32BE(0) !== expectAction || !msg.subarray(4, 8).equals(tid)) return;
      clearTimeout(timer);
      sock.close();
      resolve(msg);
    });
    sock.send(buildPacket(tid), port, host);
  });
}

async function scrapeTracker(tracker, infohashes) {
  const { hostname, port } = new URL(tracker);
  // connect
  const conn = await udpRequest(hostname, Number(port), (tid) => {
    const b = Buffer.alloc(16);
    b.writeBigUInt64BE(0x41727101980n, 0); // protocol magic
    b.writeUInt32BE(0, 8);                 // action: connect
    tid.copy(b, 12);
    return b;
  }, 0);
  const connId = conn.subarray(8, 16);
  // scrape in batches
  const results = new Map();
  for (let i = 0; i < infohashes.length; i += BATCH) {
    const batch = infohashes.slice(i, i + BATCH);
    const resp = await udpRequest(hostname, Number(port), (tid) => {
      const b = Buffer.alloc(16 + 20 * batch.length);
      connId.copy(b, 0);
      b.writeUInt32BE(2, 8);               // action: scrape
      tid.copy(b, 12);
      batch.forEach((h, j) => Buffer.from(h, 'hex').copy(b, 16 + 20 * j));
      return b;
    }, 2);
    batch.forEach((h, j) => {
      const off = 8 + 12 * j;
      if (resp.length >= off + 12) {
        results.set(h, { seeds: resp.readUInt32BE(off), leechers: resp.readUInt32BE(off + 8) });
      }
    });
  }
  return results;
}

async function main() {
  // Infohashes as CLI args = dry-run scrape of just those (no index round-trip).
  const argHashes = process.argv.slice(2).filter((h) => /^[a-f0-9]{40}$/i.test(h));
  const listed = argHashes.length ? [] : await (await fetch(`${INDEX}/api/torrents?limit=500`)).json();
  const infohashes = argHashes.length ? argHashes.map((h) => h.toLowerCase()) : listed.map((t) => t.infohash);
  if (!infohashes.length) { console.log('nothing listed, nothing to scrape'); return; }

  // Best result across trackers (a torrent may be registered on only some of them).
  const best = new Map(infohashes.map((h) => [h, { seeds: 0, leechers: 0 }]));
  for (const tracker of TRACKERS) {
    try {
      const res = await scrapeTracker(tracker, infohashes);
      for (const [h, s] of res) {
        const b = best.get(h);
        if (s.seeds > b.seeds) best.set(h, s);
      }
      console.log(`${tracker}: ${res.size} responses`);
    } catch (e) {
      console.error(`${tracker}: ${e.message}`);
    }
  }

  const updates = [...best.entries()].map(([infohash, s]) => ({ infohash, ...s }));
  if (!TOKEN || argHashes.length) {
    console.log('BAY_SCRAPE_TOKEN not set — dry run:');
    for (const u of updates) console.log(` ${u.infohash} seeds=${u.seeds} leechers=${u.leechers}`);
    return;
  }
  const res = await fetch(`${INDEX}/api/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ updates }),
  });
  console.log(`pushed ${updates.length} updates -> ${res.status}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
