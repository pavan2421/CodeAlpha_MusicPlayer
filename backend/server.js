import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream, statSync, createWriteStream } from 'fs';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import * as mm from 'music-metadata';
import mime from 'mime';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_FILE = path.join(__dirname, 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

await fs.mkdir(UPLOAD_DIR, { recursive: true }).catch(()=>{});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(PUBLIC_DIR));

// ---- DB helpers ----
async function readDB() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return { tracks: [], playlists: {} };
  }
}
async function writeDB(db) {
  await fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// ---- Utils ----
function parseFromFilename(name) {
  const withoutExt = name.replace(/\.[^/.]+$/, '');
  const g = withoutExt.match(/(.*?)-(.*?)(?:\s*\[(.*?)\])?$/);
  if (g) {
    return { artist: g[1].trim(), title: g[2].trim(), genre: (g[3]||'').trim() };
  }
  return { title: withoutExt, artist: '', genre: '' };
}

// ---- Upload handling ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// ---- Music APIs ----

// POST /api/music/upload  (multipart/form-data: files[])
app.post('/api/music/upload', upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  const db = await readDB();
  const created = [];
  for (const f of files) {
    const id = uuidv4();
    let metaParsed = parseFromFilename(f.originalname);
    let duration = 0;
    try {
      const metadata = await mm.parseFile(f.path, { duration: true });
      const common = metadata.common || {};
      duration = metadata.format?.duration || 0;
      metaParsed = {
        title: common.title || metaParsed.title || f.originalname,
        artist: (common.artist || '').toString() || metaParsed.artist,
        album: (common.album || '').toString() || '',
        genre: Array.isArray(common.genre) ? common.genre[0] || '' : (common.genre || metaParsed.genre || '')
      };
    } catch (e) {
      // best-effort; ignore parse errors
    }
    const track = {
      id,
      type: 'file',
      path: f.filename,
      title: metaParsed.title || f.originalname,
      artist: metaParsed.artist || '',
      album: metaParsed.album || '',
      genre: metaParsed.genre || '',
      duration
    };
    db.tracks.push(track);
    created.push(track);
  }
  await writeDB(db);
  res.json({ ok: true, tracks: created });
});

// POST /api/music/url  { url, title?, artist?, album?, genre? }
app.post('/api/music/url', async (req, res) => {
  const { url, title='', artist='', album='', genre='' } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'url required' });
  const db = await readDB();
  const id = uuidv4();
  const name = url.split('/').pop() || 'Stream';
  const hints = parseFromFilename(name);
  const track = {
    id,
    type: 'url',
    src: url,
    title: title || hints.title || name,
    artist: artist || hints.artist || '',
    album: album || '',
    genre: genre || hints.genre || '',
    duration: 0
  };
  db.tracks.push(track);
  await writeDB(db);
  res.json({ ok: true, track });
});

// GET /api/music
app.get('/api/music', async (req, res) => {
  const db = await readDB();
  res.json({ tracks: db.tracks });
});

// DELETE /api/music/:id
app.delete('/api/music/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  const idx = db.tracks.findIndex(t => t.id === id);
  if (idx === -1) return res.status(404).json({ ok:false, error: 'not found' });
  const t = db.tracks[idx];
  db.tracks.splice(idx, 1);
  // remove from playlists
  Object.values(db.playlists).forEach(pl => {
    pl.trackIds = pl.trackIds.filter(x => x !== id);
  });
  if (t.type === 'file' && t.path) {
    const full = path.join(UPLOAD_DIR, t.path);
    try { await fs.unlink(full); } catch(e){}
  }
  await writeDB(db);
  res.json({ ok: true });
});

// GET /api/music/stream/:id  (supports range requests)
app.get('/api/music/stream/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  const t = db.tracks.find(x => x.id === id);
  if (!t) return res.status(404).end();
  if (t.type !== 'file') return res.status(400).end();

  const full = path.join(UPLOAD_DIR, t.path);
  let stats;
  try {
    stats = statSync(full);
  } catch(e) {
    return res.status(404).end();
  }
  const total = stats.size;
  const range = req.headers.range;
  const contentType = mime.getType(full) || 'audio/mpeg';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunk = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk,
      'Content-Type': contentType
    });
    createReadStream(full, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': total,
      'Content-Type': contentType
    });
    createReadStream(full).pipe(res);
  }
});

// ---- Playlists APIs ----

// GET /api/playlists
app.get('/api/playlists', async (req, res) => {
  const db = await readDB();
  res.json({ playlists: db.playlists });
});

// POST /api/playlists  { name }
app.post('/api/playlists', async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ ok:false, error:'name required' });
  const db = await readDB();
  const id = uuidv4();
  db.playlists[id] = { id, name: name.trim(), trackIds: [] };
  await writeDB(db);
  res.json({ ok:true, playlist: db.playlists[id] });
});

// PUT /api/playlists/:id  { name }
app.put('/api/playlists/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  const db = await readDB();
  const pl = db.playlists[id];
  if (!pl) return res.status(404).json({ ok:false, error:'not found' });
  if (name && name.trim()) pl.name = name.trim();
  await writeDB(db);
  res.json({ ok:true, playlist: pl });
});

// DELETE /api/playlists/:id
app.delete('/api/playlists/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  if (!db.playlists[id]) return res.status(404).json({ ok:false, error:'not found' });
  delete db.playlists[id];
  await writeDB(db);
  res.json({ ok:true });
});

// POST /api/playlists/:id/tracks  { trackId }
app.post('/api/playlists/:id/tracks', async (req, res) => {
  const { id } = req.params;
  const { trackId } = req.body || {};
  const db = await readDB();
  const pl = db.playlists[id];
  if (!pl) return res.status(404).json({ ok:false, error:'playlist not found' });
  if (!db.tracks.find(t => t.id === trackId)) return res.status(400).json({ ok:false, error:'track not found' });
  if (!pl.trackIds.includes(trackId)) pl.trackIds.push(trackId);
  await writeDB(db);
  res.json({ ok:true, playlist: pl });
});

// DELETE /api/playlists/:id/tracks/:trackId
app.delete('/api/playlists/:id/tracks/:trackId', async (req, res) => {
  const { id, trackId } = req.params;
  const db = await readDB();
  const pl = db.playlists[id];
  if (!pl) return res.status(404).json({ ok:false, error:'playlist not found' });
  pl.trackIds = pl.trackIds.filter(x => x !== trackId);
  await writeDB(db);
  res.json({ ok:true, playlist: pl });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
