import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
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

// Compute SHA-256 hash of dataset to check for changes
function computeDatasetHash(bottles) {
  if (!Array.isArray(bottles)) return '';
  const hash = crypto.createHash('sha256');
  for (const b of bottles) {
    hash.update(String(b.id || ''));
    hash.update(String(b['Domaine / Propriété'] || ''));
    hash.update(String(b['Cuvée / Style'] || ''));
    hash.update(String(b['Appellation / IGP'] || ''));
    hash.update(String(b['Région'] || ''));
    hash.update(String(b['Type de vin'] || ''));
    hash.update(String(b['Millésime'] || ''));
    hash.update(String(b['Quantité'] || 0));
    // Include photo if present
    const photo = b.photo || b.image;
    if (photo) {
      hash.update(photo.slice(0, 100));
      hash.update(String(photo.length));
      hash.update(photo.slice(-100));
    }
  }
  return hash.digest('hex');
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Encoding, If-None-Match');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // API : Sauvegarder sur le serveur
  if (pathname === '/api/backup' && req.method === 'POST') {
    const chunks = [];
    let receivedBytes = 0;

    req.on('data', chunk => {
      receivedBytes += chunk.length;
      if (receivedBytes > 150 * 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload trop volumineux' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const rawBuffer = Buffer.concat(chunks);
        let jsonStr = '';

        // Décompression à la volée si envoyé en gzip
        if (req.headers['content-encoding'] === 'gzip') {
          jsonStr = zlib.gunzipSync(rawBuffer).toString('utf-8');
        } else {
          jsonStr = rawBuffer.toString('utf-8');
        }

        const payload = JSON.parse(jsonStr);

        // Nettoyage et déduplication des photos (suppression du champ b.image dupliqué si b.photo existe)
        const cleanedBottles = (payload.bottles || []).map(b => {
          const item = { ...b };
          const p = item.photo || item.image;
          if (p) {
            item.photo = p;
          }
          delete item.image; // Évite de doubler le poids en mémoire
          return item;
        });

        // Vérifier si des modifications ont eu lieu par rapport au fichier existant
        let previousHash = '';
        if (fs.existsSync(BACKUP_FILE)) {
          try {
            const existingData = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
            previousHash = computeDatasetHash(existingData.bottles);
          } catch (e) {}
        }

        const currentHash = computeDatasetHash(cleanedBottles);
        const hasChanged = previousHash !== currentHash;

        const dataToSave = {
          savedAt: new Date().toISOString(),
          bottlesCount: cleanedBottles.length,
          bottles: cleanedBottles,
          version: '1.1'
        };

        // Écriture du fichier principal (format compact sans indentations superflues pour un gain de temps I/O)
        fs.writeFileSync(BACKUP_FILE, JSON.stringify(dataToSave), 'utf-8');

        // N'écrire dans l'historique que si les données ont réellement changé
        if (hasChanged) {
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
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Sauvegarde enregistrée avec succès sur le serveur',
          savedAt: dataToSave.savedAt,
          bottlesCount: dataToSave.bottlesCount,
          unchanged: !hasChanged
        }));
      } catch (err) {
        console.error('Erreur sauvegarde:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Erreur traitement: ${err.message}` }));
      }
    });
    return;
  }

  // API : Récupérer la dernière sauvegarde du serveur
  if (pathname === '/api/backup' && req.method === 'GET') {
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        const fileBuffer = fs.readFileSync(BACKUP_FILE);
        const acceptEncoding = req.headers['accept-encoding'] || '';

        // Si le client supporte gzip, compresser la réponse pour un chargement ultra-rapide
        if (acceptEncoding.includes('gzip')) {
          const gzipped = zlib.gzipSync(fileBuffer);
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Encoding': 'gzip',
            'Cache-Control': 'no-cache'
          });
          res.end(gzipped);
        } else {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache'
          });
          res.end(fileBuffer);
        }
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
