const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'businessLeaders.json');

async function ensureStoreExists() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(STORE_PATH);
  } catch {
    await fs.writeFile(STORE_PATH, '[]', 'utf8');
  }
}

async function readLeaders() {
  await ensureStoreExists();
  const raw = await fs.readFile(STORE_PATH, 'utf8');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.leaders)) return parsed.leaders;
    return [];
  } catch {
    return [];
  }
}

async function writeLeaders(leaders) {
  await ensureStoreExists();
  const tmpPath = `${STORE_PATH}.tmp`;
  const payload = JSON.stringify(leaders, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf8');
  try {
    // On Windows, rename() cannot always overwrite an existing file.
    await fs.rename(tmpPath, STORE_PATH);
  } catch {
    await fs.copyFile(tmpPath, STORE_PATH);
    await fs.unlink(tmpPath);
  }
}

function newId() {
  try {
    return randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

function normalizeLeader(input, { allowId = false } = {}) {
  const nowIso = new Date().toISOString();

  const leader = {
    ...(allowId && input.id ? { id: String(input.id) } : { id: newId() }),
    name: String(input.name || '').trim(),
    company: String(input.company || '').trim(),
    industry: String(input.industry || '').trim(),
    country: String(input.country || '').trim(),
    image: String(input.image || '').trim(),
    description: String(input.description || '').trim(),
    website: String(input.website || '').trim(),
    isActive: typeof input.isActive === 'boolean' ? input.isActive : true,
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso,
  };

  return leader;
}

module.exports = {
  readLeaders,
  writeLeaders,
  normalizeLeader,
};
