/**
 * Analyzes a wine bottle label image using Gemini Vision API
 * and extracts wine characteristics in structured JSON format.
 */

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

export async function analyzeWineLabel(base64DataUrl, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Clé API Gemini manquante. Veuillez renseigner votre clé API dans les paramètres.");
  }

  // Extract base64 and mime type
  const matches = base64DataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Format d'image non valide.");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];

  const prompt = `Tu es un sommelier expert et un spécialiste de l'oenologie.
Analyse précisément cette photo d'étiquette de bouteille de vin (ou de champagne/spiritueux).
Extrais toutes les informations visibles et déduis les informations oenologiques évidentes (terroir, région viticole, type de vin).

Réponds UNIQUEMENT sous forme d'un objet JSON strict avec exactement cette structure (sans balises markdown supplémentaires) :
{
  "domaine": "Nom du domaine, château, maison ou propriétaire viticole",
  "cuvee": "Nom de la cuvée, lieu-dit, clos ou mention spéciale (ex: Grande Réserve, Brut, etc. ou laisser vide si aucun)",
  "region": "Grande région viticole (ex: Bordeaux, Bourgogne, Champagne, Vallée du Rhône, Vallée de la Loire, Alsace, Sud-Ouest, Languedoc-Roussillon, Provence, etc.)",
  "appellation": "Appellation d'origine contrôlée, IGP ou mention d'origine (ex: Margaux, Chablis, Champagne AOC, Saint-Émilion Grand Cru, etc.)",
  "type": "Type de vin (choisis parmi: Rouge, Blanc sec, Blanc doux et fruité, Blanc aromatique, Rosé, Champagne / Pétillant, Spiritueux)",
  "millesime": 2020 (nombre à 4 chiffres du millésime, ou "Non millésimé" ou "Non visible" si absent),
  "cepages": "Cépages identifiés ou traditionnels de l'appellation (ex: Pinot Noir, Chardonnay, etc.)",
  "degre": "Degré d'alcool si visible (ex: 13.5% vol ou null)"
}

Si une information n'est pas certaine ou invisible, mets une estimation cohérente avec l'appellation ou laisse une chaîne vide.`;

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      
      const payload = {
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const message = errorData?.error?.message || `Erreur HTTP ${response.status}`;
        throw new Error(`Modèle ${model}: ${message}`);
      }

      const data = await response.json();
      const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        throw new Error("Aucune réponse générée par l'IA.");
      }

      // Parse JSON from text response
      const cleanJson = textResponse.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleanJson);
      return parsed;
    } catch (err) {
      lastError = err;
      console.warn(`Échec avec le modèle ${model}, tentative avec le suivant...`, err);
    }
  }

  throw lastError || new Error("Impossible d'analyser l'image avec l'IA.");
}
