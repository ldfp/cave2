/**
 * Service to handle server backup, restore and local file export
 */

export async function sendBackupToServer(bottles) {
  const payload = {
    bottles: bottles || [],
    clientTimestamp: new Date().toISOString()
  };

  const response = await fetch('/api/backup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Erreur serveur (HTTP ${response.status})`);
  }

  return await response.json();
}

export async function fetchServerBackup() {
  const response = await fetch('/api/backup');
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
  const dataToExport = {
    exportDate: new Date().toISOString(),
    bottlesCount: bottles.length,
    bottles: bottles
  };

  const jsonStr = JSON.stringify(dataToExport, null, 2);
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
