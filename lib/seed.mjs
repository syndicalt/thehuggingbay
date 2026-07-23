// Demo catalog. Infohashes are SHA-1 of the listing name — they are placeholders
// and do NOT point at real swarms. Replace with real torrents as the fleet seeds them.
import { createHash } from 'node:crypto';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const TB = 1024 ** 4;

const UPLOADERS = [
  ['CaptainHug', 'Captain'],
  ['SeaLLM', 'Captain'],
  ['VectorJack', 'First Mate'],
  ['DataBuccaneer', 'First Mate'],
  ['UI-Corsair', 'Sailor'],
  ['PetabytePete', 'First Mate'],
];

// [name, category, size, license, source, uploader, seeds, leechers, daysAgo, verified, description]
const LISTINGS = [
  ['DeepSeek-R1-0528', 'llm', 688 * GB, 'MIT', 'https://huggingface.co/deepseek-ai/DeepSeek-R1-0528', 'SeaLLM', 1834, 412, 2, 2,
    'Full FP8 weights of the DeepSeek-R1-0528 reasoning model. Multi-file layout mirrors the upstream HF repo.'],
  ['Llama-3.1-70B-Instruct', 'llm', 131.6 * GB, 'Llama-3.1-Community', 'https://huggingface.co/meta-llama/Llama-3.1-70B-Instruct', 'CaptainHug', 1245, 178, 1, 2,
    'BF16 safetensors, tokenizer, and config. Redistribution permitted under the Llama 3.1 Community License with attribution.'],
  ['Qwen3-235B-A22B-Instruct', 'llm', 439.1 * GB, 'Apache-2.0', 'https://huggingface.co/Qwen/Qwen3-235B-A22B', 'SeaLLM', 967, 203, 4, 2,
    'Mixture-of-experts flagship, BF16 shards. Webseeds point back at the upstream repo.'],
  ['gpt-oss-120b', 'llm', 65.3 * GB, 'Apache-2.0', 'https://huggingface.co/openai/gpt-oss-120b', 'CaptainHug', 2210, 340, 3, 2,
    'MXFP4 release of gpt-oss-120b, fits a single 80 GB GPU.'],
  ['Kimi-K2-Instruct', 'llm', 1.03 * TB, 'Modified-MIT', 'https://huggingface.co/moonshotai/Kimi-K2-Instruct', 'PetabytePete', 148, 96, 6, 2,
    '1T-parameter MoE, FP8 block format. The biggest ship in the harbor — seeders with real bandwidth wanted.'],
  ['GLM-4.5-Air', 'llm', 213 * GB, 'MIT', 'https://huggingface.co/zai-org/GLM-4.5-Air', 'SeaLLM', 421, 88, 8, 2,
    'BF16 weights of the 106B GLM-4.5-Air.'],
  ['Mistral-Small-3.2-24B-Instruct', 'llm', 47.1 * GB, 'Apache-2.0', 'https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506', 'CaptainHug', 856, 102, 5, 2,
    'BF16 safetensors plus Tekken tokenizer.'],
  ['Phi-4', 'llm', 29.3 * GB, 'MIT', 'https://huggingface.co/microsoft/phi-4', 'UI-Corsair', 634, 71, 9, 1,
    '14B dense model, MIT-licensed, great laptop-class daily driver.'],
  ['Qwen3-Embedding-8B', 'emb', 16.1 * GB, 'Apache-2.0', 'https://huggingface.co/Qwen/Qwen3-Embedding-8B', 'VectorJack', 512, 44, 3, 2,
    'Top-of-leaderboard multilingual embedding model.'],
  ['bge-m3', 'emb', 2.3 * GB, 'MIT', 'https://huggingface.co/BAAI/bge-m3', 'VectorJack', 780, 39, 12, 2,
    'Dense + sparse + multi-vector retrieval in one checkpoint.'],
  ['nomic-embed-text-v1.5', 'emb', 547 * MB, 'Apache-2.0', 'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5', 'VectorJack', 921, 25, 15, 2,
    'Long-context text embeddings with Matryoshka dimensions.'],
  ['FLUX.1-schnell', 'vis', 23.8 * GB, 'Apache-2.0', 'https://huggingface.co/black-forest-labs/FLUX.1-schnell', 'UI-Corsair', 1105, 214, 2, 2,
    'Fast distilled text-to-image transformer, full pipeline weights.'],
  ['Qwen2.5-VL-72B-Instruct', 'vis', 137.2 * GB, 'Qwen-License', 'https://huggingface.co/Qwen/Qwen2.5-VL-72B-Instruct', 'SeaLLM', 289, 67, 7, 2,
    'Vision-language flagship: grounding, video understanding, document parsing.'],
  ['stable-diffusion-xl-base-1.0', 'vis', 13.9 * GB, 'OpenRAIL++-M', 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0', 'UI-Corsair', 1450, 90, 30, 2,
    'The classic. Base UNet, both text encoders, VAE.'],
  ['whisper-large-v3', 'aud', 3.1 * GB, 'Apache-2.0', 'https://huggingface.co/openai/whisper-large-v3', 'CaptainHug', 1320, 48, 20, 2,
    'Speech recognition workhorse, safetensors + original OpenAI checkpoint.'],
  ['Kokoro-82M', 'aud', 327 * MB, 'Apache-2.0', 'https://huggingface.co/hexgrad/Kokoro-82M', 'UI-Corsair', 610, 22, 11, 1,
    'Tiny high-quality TTS. Fits on anything.'],
  ['OpenHands-LM-32B', 'agt', 64.7 * GB, 'MIT', 'https://huggingface.co/all-hands/openhands-lm-32b-v0.1', 'DataBuccaneer', 187, 34, 10, 1,
    'Coding-agent tuned 32B for autonomous software tasks.'],
  ['Qwen3-Coder-30B-A3B-Instruct', 'agt', 61.1 * GB, 'Apache-2.0', 'https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct', 'SeaLLM', 402, 77, 4, 2,
    'Agentic coding MoE — strong tool-use and repo-scale editing.'],
  ['fineweb-edu-sample-100BT', 'data', 231.4 * GB, 'ODC-By-1.0', 'https://huggingface.co/datasets/HuggingFaceFW/fineweb-edu', 'DataBuccaneer', 96, 41, 14, 2,
    '100B-token educational-quality web sample. Parquet shards, original layout.'],
  ['OpenOrca', 'data', 6.4 * GB, 'MIT', 'https://huggingface.co/datasets/Open-Orca/OpenOrca', 'DataBuccaneer', 240, 12, 40, 2,
    'Classic instruction-tuning dataset, parquet.'],
  ['smollm-corpus', 'data', 1.1 * TB, 'ODC-By-1.0', 'https://huggingface.co/datasets/HuggingFaceTB/smollm-corpus', 'PetabytePete', 31, 18, 22, 1,
    'Full pretraining corpus for small models. Under-seeded — sailors needed.'],
  ['comfyui-portable-linux', 'app', 1.9 * GB, 'GPL-3.0', 'https://github.com/comfyanonymous/ComfyUI', 'UI-Corsair', 505, 27, 6, 1,
    'Portable ComfyUI bundle with common custom nodes preinstalled.'],
  ['hugging-bay-sticker-pack', 'meme', 12 * MB, 'CC0-1.0', 'https://thehuggingbay.example/stickers', 'CaptainHug', 333, 4, 1, 2,
    'The official 🤗🏴‍☠️ sticker pack. Hug more. Gatekeep less.'],
];

export function seedDb(db) {
  const insertUploader = db.prepare('INSERT INTO uploaders (name, rank) VALUES (?, ?)');
  for (const [name, rank] of UPLOADERS) insertUploader.run(name, rank);
  const uploaderIds = new Map(
    db.prepare('SELECT id, name FROM uploaders').all().map((u) => [u.name, u.id])
  );

  const insert = db.prepare(`
    INSERT INTO torrents (infohash, name, category, size_bytes, seeds, leechers,
      uploader_id, uploaded_at, license, source_url, description, verified, webseeds_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [name, cat, size, license, source, uploader, seeds, leechers, daysAgo, verified, desc] of LISTINGS) {
    const infohash = createHash('sha1').update(`the-hugging-bay:${name}`).digest('hex');
    const uploadedAt = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    const webseeds = source && source.includes('huggingface.co')
      ? JSON.stringify([`${source}/resolve/main/`])
      : null;
    insert.run(
      infohash, name, cat, Math.round(size), seeds, leechers,
      uploaderIds.get(uploader), uploadedAt, license, source, desc, verified, webseeds,
    );
  }
}
