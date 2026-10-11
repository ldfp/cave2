/**
 * Analyzes a wine bottle label image using Nous Portal (portal.nousresearch.com)
 * or Google Gemini Vision, extracting wine characteristics in structured JSON format.
 */

export const DEFAULT_NOUS_MODELS = [
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (Recommandé - Très rapide & précis)' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (OpenAI - Rapide & économique)' },
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (Mix MoE & Vision)' },
  { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5 (Anthropic - Haute précision)' }
];

const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
];

const WINE_PROMPT = `Tu es un sommelier expert et un spécialiste de l'oenologie.
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

function extractJsonFromText(text) {
  if (!text) throw new Error("Réponse vide de l'IA.");
  
  // Try finding markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const targetStr = codeBlockMatch ? codeBlockMatch[1] : text;

  // Find outermost { ... }
  const firstBrace = targetStr.indexOf('{');
  const lastBrace = targetStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = targetStr.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonStr);
  }

  return JSON.parse(targetStr.trim());
}

/**
 * Analyze label using Nous Portal OpenAI-compatible Vision API
 * Endpoint: https://inference-api.nousresearch.com/v1/chat/completions
 */
async function analyzeWithNousPortal(base64DataUrl, apiKey, requestedModel = 'google/gemini-2.5-flash') {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Clé API Nous Portal manquante. Récupérez votre clé sur https://portal.nousresearch.com/ et renseignez-la dans les réglages.");
  }

  const candidateModels = [
    requestedModel,
    'google/gemini-2.5-flash',
    'openai/gpt-4o-mini',
    'deepseek/deepseek-v4.1-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let lastError = null;

  for (const model of candidateModels) {
    try {
      const payload = {
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: WINE_PROMPT },
              {
                type: "image_url",
                image_url: {
                  url: base64DataUrl
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      };

      const res = await fetch('https://inference-api.nousresearch.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const message = errorData?.message || errorData?.error?.message || `Erreur HTTP ${res.status}`;
        throw new Error(`[${model}]: ${message}`);
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Aucun contenu retourné par le modèle.");
      }

      return extractJsonFromText(content);
    } catch (err) {
      console.warn(`Tentative Nous Portal (${model}) échouée:`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Impossible d'analyser l'étiquette via Nous Portal.");
}

/**
 * Analyze label using Google Gemini Direct API
 */
async function analyzeWithGeminiDirect(base64DataUrl, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Clé API Gemini manquante. Veuillez renseigner votre clé API dans les réglages.");
  }

  const matches = base64DataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Format d'image non valide.");
  }

  const mimeType = matches[1];
  const base64Data = matches[2];

  let lastError = null;

  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
      
      const payload = {
        contents: [
          {
            parts: [
              { text: WINE_PROMPT },
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
        throw new Error("Aucune réponse générée par Gemini.");
      }

      return extractJsonFromText(textResponse);
    } catch (err) {
      console.warn(`Échec Gemini (${model}):`, err);
      lastError = err;
    }
  }

  throw lastError || new Error("Impossible d'analyser l'image avec Google Gemini.");
}

/**
 * Main analysis function supporting Nous Portal and Gemini Direct
 * @param {string} base64DataUrl - Compressed image data URL
 * @param {object|string} config - Configuration object or direct apiKey string
 */
export async function analyzeWineLabel(base64DataUrl, config) {
  if (!base64DataUrl) {
    throw new Error("Aucune image fournie.");
  }

  // Handle legacy call where config is directly an apiKey string
  if (typeof config === 'string') {
    // Check if it looks like a Gemini key (starts with AIzaSy)
    if (config.startsWith('AIzaSy')) {
      return analyzeWithGeminiDirect(base64DataUrl, config);
    } else {
      return analyzeWithNousPortal(base64DataUrl, config);
    }
  }

  const {
    provider = 'nous',
    nousApiKey = '',
    nousModel = 'google/gemini-2.5-flash',
    geminiApiKey = ''
  } = config || {};

  if (provider === 'nous') {
    return analyzeWithNousPortal(base64DataUrl, nousApiKey, nousModel);
  } else {
    return analyzeWithGeminiDirect(base64DataUrl, geminiApiKey);
  }
}
