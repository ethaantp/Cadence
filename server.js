import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 80;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DIST_DIR = path.join(__dirname, 'dist');
const DB_PATH = path.join(DATA_DIR, 'cadence.db');

// Ensure persistent data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const getLocalDateKey = (dateObj = new Date()) => {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const DEFAULT_SETTINGS = {
  catName: 'Mochi',
  medicationName: 'Oral Solution',
  dosageLabel: '2.5 mg / 0.5 ml',
  morningTargetTime: '08:00',
  eveningTargetTime: '20:00',
  bottleOpenedDate: getLocalDateKey(new Date()),
  bottleShelfLifeDays: 180,
  caregivers: ['Partner 1', 'Partner 2', 'Pet Sitter'],
  administrationNote:
    'Give directly by mouth or with a small portion of food. Wipe syringe tip clean after each use.'
};

// Initialize SQLite database
const db = new DatabaseSync(DB_PATH);

// Use DELETE journal mode for maximum compatibility with Windows NTFS Docker bind mounts
db.exec('PRAGMA journal_mode = DELETE;');
db.exec('PRAGMA synchronous = NORMAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS household_settings (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS medication_logs (
    date_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Prepared statements
const getSettingsStmt = db.prepare('SELECT data, updated_at FROM household_settings WHERE id = ?');
const upsertSettingsStmt = db.prepare(`
  INSERT INTO household_settings (id, data, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

const getAllLogsStmt = db.prepare('SELECT date_key, data, updated_at FROM medication_logs');
const getLogByDateStmt = db.prepare('SELECT data FROM medication_logs WHERE date_key = ?');
const upsertLogStmt = db.prepare(`
  INSERT INTO medication_logs (date_key, data, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(date_key) DO UPDATE SET
    data = excluded.data,
    updated_at = excluded.updated_at
`);

// Seed default settings if not present
const existingSettingsRow = getSettingsStmt.get('config');
if (!existingSettingsRow) {
  const nowIso = new Date().toISOString();
  upsertSettingsStmt.run('config', JSON.stringify(DEFAULT_SETTINGS), nowIso);
}

function readSettings() {
  const row = getSettingsStmt.get('config');
  if (!row) return { settings: { ...DEFAULT_SETTINGS }, updatedAt: new Date().toISOString() };
  try {
    const parsed = JSON.parse(row.data);
    // Merge over DEFAULT_SETTINGS so future app upgrades automatically receive new default fields
    return {
      settings: { ...DEFAULT_SETTINGS, ...parsed },
      updatedAt: row.updated_at
    };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, updatedAt: row.updated_at };
  }
}

function readAllLogs() {
  const rows = getAllLogsStmt.all();
  const logsByDate = {};
  let latestLogUpdate = '';

  for (const row of rows) {
    try {
      logsByDate[row.date_key] = JSON.parse(row.data);
      if (row.updated_at > latestLogUpdate) {
        latestLogUpdate = row.updated_at;
      }
    } catch {
      // Skip malformed row if any
    }
  }
  return { logsByDate, latestLogUpdate };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 100) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isHtml = ext === '.html';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // ==========================================
    // REST API ROUTES
    // ==========================================
    if (pathname === '/api/state' && req.method === 'GET') {
      const { settings, updatedAt: settingsUpdatedAt } = readSettings();
      const { logsByDate, latestLogUpdate } = readAllLogs();
      const updatedAt = latestLogUpdate > settingsUpdatedAt ? latestLogUpdate : settingsUpdatedAt;
      return sendJson(res, 200, { settings, logsByDate, updatedAt });
    }

    if (pathname === '/api/settings' && req.method === 'PUT') {
      const incoming = await parseJsonBody(req);
      const { settings: currentSettings } = readSettings();
      const nowIso = new Date().toISOString();
      const updatedSettings = {
        ...DEFAULT_SETTINGS,
        ...currentSettings,
        ...incoming
      };
      upsertSettingsStmt.run('config', JSON.stringify(updatedSettings), nowIso);
      return sendJson(res, 200, { settings: updatedSettings, updatedAt: nowIso });
    }

    if (pathname.startsWith('/api/logs/') && req.method === 'PUT') {
      const dateKey = decodeURIComponent(pathname.slice('/api/logs/'.length));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return sendJson(res, 400, { error: 'Invalid dateKey format (expected YYYY-MM-DD)' });
      }

      const incoming = await parseJsonBody(req);
      const nowIso = new Date().toISOString();

      db.exec('BEGIN IMMEDIATE');
      try {
        const existingRow = getLogByDateStmt.get(dateKey);
        let currentRecord = { dateKey };
        if (existingRow) {
          try {
            currentRecord = { dateKey, ...JSON.parse(existingRow.data) };
          } catch {
            currentRecord = { dateKey };
          }
        }

        const updatedRecord = {
          ...currentRecord,
          ...incoming,
          dateKey,
          updatedAt: incoming.updatedAt || nowIso
        };

        upsertLogStmt.run(dateKey, JSON.stringify(updatedRecord), updatedRecord.updatedAt);
        db.exec('COMMIT');
        return sendJson(res, 200, { dateKey, record: updatedRecord });
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }
    }

    if (pathname.startsWith('/api/')) {
      return sendJson(res, 404, { error: 'API endpoint not found' });
    }

    // ==========================================
    // STATIC FRONTEND & SPA FALLBACK
    // ==========================================
    const safeRelativePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const candidatePath = path.join(DIST_DIR, safeRelativePath);

    if (
      pathname !== '/' &&
      candidatePath.startsWith(DIST_DIR) &&
      fs.existsSync(candidatePath) &&
      fs.statSync(candidatePath).isFile()
    ) {
      return serveStaticFile(res, candidatePath);
    }

    const indexHtmlPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      return serveStaticFile(res, indexHtmlPath);
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend build not found. Run "npm run build" first.');
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal server error' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐾 Cadence server listening on http://0.0.0.0:${PORT}`);
  console.log(`💾 Local SQLite database: ${DB_PATH}`);
});

const shutdown = () => {
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
