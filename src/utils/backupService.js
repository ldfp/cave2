/**
 * Service to handle server backup, restore and local file export
 * Features deduplication, gzip compression streaming and progress optimization.
 */

/**
 * Clean bottles by removing duplicated image property and keeping only photo
 */
export function cleanBottlesForBackup(bottles) {
  if (!Array.isArray(bottles)) return [];
  return bottles.map(b => {
    const item = { ...b };
    const p = item.photo || item.image;
    if (p) {
      item.photo = p;
    }
    delete item.image; // Supprime la duplication qui doublait la taille du payload
    return item;
  });
}

/**
 * Sends backup to server with stream compression if supported by browser
 */
export async function sendBackupToServer(bottles) {
  const cleaned = cleanBottlesForBackup(bottles);
  const payload = {
    bottles: cleaned,
    clientTimestamp: new Date().toISOString()
  };

  const jsonString = JSON.stringify(payload);

  // Check if native browser CompressionStream is available
  if (typeof CompressionStream !== 'undefined') {
    try {
      const blob = new Blob([jsonString], { type: 'application/json' });
      const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
      const compressedBlob = await new Response(stream).blob();

      const response = await fetch('/api/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip'
        },
        body: compressedBlob
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erreur serveur (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (compressionErr) {
      console.warn('Compression échouée, fallback envoi standard:', compressionErr);
    }
  }

  // Standard fallback
  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: jsonString
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erreur serveur (HTTP ${response.status})`);
  }

  return await response.json();
}

export async function fetchServerBackup() {
  const response = await fetch('/api/backup', {
    headers: {
      'Accept-Encoding': 'gzip, deflate'
    }
  });

  if (response.status === 404) {
    return null; // Aucune sauvegarde existante
  }
  if (!response.ok) {
    throw new Error(`Erreur récupération sauvegarde (HTTP ${response.status})`);
  }
  return await response.json();
}

export async function fetchServerStatus() {
  try {
    const response = await fetch('/api/status');
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // Peut échouer si en mode statique GitHub Pages
  }
  return null;
}

export function exportBackupToFile(bottles) {
  const cleaned = cleanBottlesForBackup(bottles);
  const dataToExport = {
    exportDate: new Date().toISOString(),
    bottlesCount: cleaned.length,
    bottles: cleaned
  };

  // Compact JSON string to avoid massive whitespace in 30MB file
  const jsonStr = JSON.stringify(dataToExport);
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `cave_a_vin_sauvegarde_${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
