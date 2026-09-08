// Just Us — tiny backend
// Stores everything in plain text (JSON) files on disk. No database.
// Files: data/messages.txt, data/presence.txt, data/seen.txt

const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const MSG_FILE = path.join(DATA_DIR, 'messages.txt');
const PRESENCE_FILE = path.join(DATA_DIR, 'presence.txt');
const SEEN_FILE = path.join(DATA_DIR, 'seen.txt');
const VALID_USERS = ['Tom', 'Jerry'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

// ---- Daily password ----
// Change this each day and tell the other person. Case-insensitive.
// Today's password:
const DAILY_PASSWORD = 'pussy';

app.use('/images', express.static(IMAGES_DIR));

async function ensureFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  try { await fs.access(MSG_FILE); } catch { await fs.writeFile(MSG_FILE, '[]'); }
  try { await fs.access(PRESENCE_FILE); } catch { await fs.writeFile(PRESENCE_FILE, '{}'); }
  try { await fs.access(SEEN_FILE); } catch { await fs.writeFile(SEEN_FILE, '{}'); }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGES_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().slice(0, 8);
      cb(null, crypto.randomUUID() + ext);
    }
  }),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  }
});

// Simple write queue so two requests can't corrupt a file by writing at the same time.
let queue = Promise.resolve();
function queued(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function readJsonFile(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function writeJsonFile(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function isValidUser(u) { return VALID_USERS.includes(u); }

// ---- Messages ----

app.get('/api/messages', async (req, res) => {
  const all = await readJsonFile(MSG_FILE, []);
  res.json(all);
});

app.post('/api/messages', async (req, res) => {
  const { sender, text, image } = req.body || {};
  const cleanText = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
  const cleanImage = typeof image === 'string' ? image : null;
  if (!isValidUser(sender) || (!cleanText && !cleanImage)) {
    return res.status(400).json({ error: 'sender must be Tom or Jerry, and text or image is required' });
  }
  await queued(async () => {
    const all = await readJsonFile(MSG_FILE, []);
    all.push({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      sender,
      text: cleanText,
      image: cleanImage, // filename under /images/, or null
      ts: Date.now(),
      clearedBy: []
    });
    await writeJsonFile(MSG_FILE, all);
  });
  res.json({ ok: true });
});

// Upload an image, get back a filename to attach to a message.
app.post('/api/upload', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image received' });
    res.json({ filename: req.file.filename });
  });
});

// Clear chat for one user. A message is deleted for good once BOTH users have cleared it.
app.post('/api/clear', async (req, res) => {
  const { user } = req.body || {};
  if (!isValidUser(user)) return res.status(400).json({ error: 'user must be Tom or Jerry' });
  await queued(async () => {
    const all = await readJsonFile(MSG_FILE, []);
    const toDelete = [];
    const updated = all
      .map(m => {
        const clearedBy = m.clearedBy || [];
        if (!clearedBy.includes(user)) clearedBy.push(user);
        return { ...m, clearedBy };
      })
      .filter(m => {
        const fullyCleared = (m.clearedBy || []).length >= 2;
        if (fullyCleared && m.image) toDelete.push(m.image);
        return !fullyCleared;
      });
    await writeJsonFile(MSG_FILE, updated);
    await Promise.all(toDelete.map(filename =>
      fs.unlink(path.join(IMAGES_DIR, filename)).catch(() => {})
    ));
  });
  res.json({ ok: true });
});

// ---- Presence (online/offline) ----

app.post('/api/heartbeat', async (req, res) => {
  const { user } = req.body || {};
  if (!isValidUser(user)) return res.status(400).json({ error: 'user must be Tom or Jerry' });
  await queued(async () => {
    const presence = await readJsonFile(PRESENCE_FILE, {});
    presence[user] = Date.now();
    await writeJsonFile(PRESENCE_FILE, presence);
  });
  res.json({ ok: true });
});

app.get('/api/presence', async (req, res) => {
  const presence = await readJsonFile(PRESENCE_FILE, {});
  res.json(presence);
});

// ---- Seen / read receipts ----
// Records, per user, the id of the newest message they've viewed and when.
// { "Tom": { "lastSeenId": "...", "seenAt": 1234567890 }, "Jerry": {...} }

app.post('/api/seen', async (req, res) => {
  const { user, lastSeenId } = req.body || {};
  if (!isValidUser(user) || !lastSeenId) {
    return res.status(400).json({ error: 'user must be Tom or Jerry, and lastSeenId is required' });
  }
  await queued(async () => {
    const seen = await readJsonFile(SEEN_FILE, {});
    seen[user] = { lastSeenId, seenAt: Date.now() };
    await writeJsonFile(SEEN_FILE, seen);
  });
  res.json({ ok: true });
});

app.get('/api/seen', async (req, res) => {
  const seen = await readJsonFile(SEEN_FILE, {});
  res.json(seen);
});

// ---- Password gate ----
// Checked once per device per day on the client before it lets someone
// pick Tom or Jerry. Kept server-side so the password isn't just sitting
// in the page source.

app.post('/api/verify-password', (req, res) => {
  const { password } = req.body || {};
  const ok = typeof password === 'string' &&
    password.trim().toLowerCase() === DAILY_PASSWORD.trim().toLowerCase();
  res.json({ ok });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
ensureFiles().then(() => {
  app.listen(PORT, () => console.log('Just Us server running on port ' + PORT));
});