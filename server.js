import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 80;
const DIST_DIR = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
const BACKUP_FILE = path.join(DATA_DIR, 'cave_backup.json');
const BACKUPS_HISTORY_DIR = path.join(DATA_DIR, 'backups');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BACKUPS_HISTORY_DIR)) {
  fs.mkdirSync(BACKUPS_HISTORY_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // API : Sauvegarder sur le serveur
  if (pathname === '/api/backup' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      // Protection contre les payloads délirants (> 150MB)
      if (body.length > 150 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload trop volumineux' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const dataToSave = {
          savedAt: new Date().toISOString(),
          bottlesCount: Array.isArray(payload.bottles) ? payload.bottles.length : 0,
          bottles: payload.bottles || [],
          version: '1.0'
        };

        // Écriture du fichier principal
        fs.writeFileSync(BACKUP_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');

        // Écriture d'une copie horodatée dans l'historique
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const historyFile = path.join(BACKUPS_HISTORY_DIR, `backup_${timestamp}.json`);
        fs.writeFileSync(historyFile, JSON.stringify(dataToSave), 'utf-8');

        // Nettoyage historique : garder les 20 plus récentes sauvegardes
        try {
          const files = fs.readdirSync(BACKUPS_HISTORY_DIR)
            .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
            .sort()
            .reverse();
          if (files.length > 20) {
            files.slice(20).forEach(f => fs.unlinkSync(path.join(BACKUPS_HISTORY_DIR, f)));
          }
        } catch (cleanupErr) {
          console.error('Erreur nettoyage historique:', cleanupErr);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Sauvegarde enregistrée avec succès sur le serveur',
          savedAt: dataToSave.savedAt,
          bottlesCount: dataToSave.bottlesCount
        }));
      } catch (err) {
        console.error('Erreur sauvegarde:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Données JSON invalides' }));
      }
    });
    return;
  }

  // API : Récupérer la dernière sauvegarde du serveur
  if (pathname === '/api/backup' && req.method === 'GET') {
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        const content = fs.readFileSync(BACKUP_FILE, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(content);
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erreur lecture sauvegarde' }));
        return;
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Aucune sauvegarde existante sur le serveur' }));
      return;
    }
  }

  // API : Statut du serveur
  if (pathname === '/api/status' && req.method === 'GET') {
    let lastBackup = null;
    let bottlesCount = 0;
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        const stats = fs.statSync(BACKUP_FILE);
        const data = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
        lastBackup = data.savedAt || stats.mtime.toISOString();
        bottlesCount = data.bottlesCount || (data.bottles ? data.bottles.length : 0);
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      lastBackup,
      bottlesCount
    }));
    return;
  }

  // Servir les fichiers statiques (Vite SPA)
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(DIST_DIR, safePath);

  // Si c'est un répertoire ou la racine, servir index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // Si le fichier n'existe pas, fallback SPA vers index.html
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Erreur interne du serveur');
    } else {
      // Cache-control pour les assets hashés de Vite
      if (filePath.includes('/assets/') || filePath.includes('\\assets\\')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍷 Serveur Cave à Vin démarré sur le port ${PORT}`);
  console.log(`📁 Répertoire données : ${DATA_DIR}`);
});
