// Vercel Serverless Function: JARVIS chat endpoint
// Required: GEMINI_API_KEY
// Optional: GEMINI_MODEL, ALLOWED_ORIGIN
const MAX_BODY_BYTES = 16000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const requestBuckets = new Map();

function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function allowedOrigin(origin) {
  if (!origin) return true;
  const configured = (process.env.ALLOWED_ORIGIN || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return ["https://franjacsmedicas.github.io", ...configured].includes(origin);
}

function rateLimit(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const bucket = requestBuckets.get(ip);
  if (!bucket || now - bucket.start >= WINDOW_MS) {
    requestBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= MAX_REQUESTS_PER_WINDOW;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin || "";
    if (!allowedOrigin(origin)) return send(res, 403, { error: "Origen no autorizado." });
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }
  if (req.method !== "POST") return send(res, 405, { error: "Método no permitido." });
  const origin = req.headers.origin || "";
  if (!allowedOrigin(origin)) return send(res, 403, { error: "Origen no autorizado." });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (!rateLimit(req)) return send(res, 429, { error: "Límite temporal alcanzado. Esperá un minuto y probá de nuevo." });
  if (!process.env.GEMINI_API_KEY) {
    return send(res, 503, { error: "Falta configurar GEMINI_API_KEY en las variables de entorno del servidor." });
  }

  let body = req.body;
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return send(res, 413, { error: "El mensaje es demasiado grande." });
    try { body = JSON.parse(body); } catch { return send(res, 400, { error: "Solicitud JSON inválida." }); }
  }
  if (!body || typeof body !== "object") return send(res, 400, { error: "Solicitud inválida." });
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) {
    return send(res, 400, { error: "Enviá entre 1 y 12 mensajes por consulta." });
  }
  const safeMessages = [];
  let totalChars = 0;
  for (const item of messages) {
    if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string" || !item.content.trim() || item.content.length > 3000) {
      return send(res, 400, { error: "Formato de conversación inválido." });
    }
    totalChars += item.content.length;
    if (totalChars > 12000) return send(res, 413, { error: "El historial de conversación es demasiado largo. Iniciá una conversación nueva." });
    safeMessages.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content.trim() }]
    });
  }

  const instructions = [
    "Sos JARVIS, un asistente personal de IA útil, honesto y cuidadoso, integrado en el sitio de Franja Morada Ciencias Médicas UNLP.",
    "Hablá en español rioplatense natural, cercano y claro. Adaptá el tono a la consulta sin exagerar modismos.",
    "Podés ayudar con estudio, organización, investigación y uso del sitio. No afirmes que realizaste acciones externas si no las ejecutaste realmente.",
    "No tenés acceso automático al dispositivo, archivos privados, cuentas ni datos del usuario. No prometas control de hardware o automatizaciones que no estén conectadas.",
    "No inventes fuentes ni resultados. Protegé datos personales. Para acciones importantes, pedí confirmación.",
    "Respondé en forma práctica y ordenada, con el detalle que requiera la consulta."
  ].join("\n");

  try {
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: instructions }] },
          contents: safeMessages,
          generationConfig: { maxOutputTokens: 1200, temperature: 0.7 }
        }),
        signal: AbortSignal.timeout(45000)
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = data?.error?.message || "";
      if (response.status === 401 || response.status === 403) {
        return send(res, 502, { error: "Google rechazó la clave de Gemini o no tiene acceso al modelo. Revisá la clave y el proyecto en AI Studio." });
      }
      if (response.status === 429) {
        return send(res, 429, { error: "Gemini alcanzó el límite de uso gratuito. Esperá a que se restablezca la cuota o revisá los límites del proyecto." });
      }
      console.error("Gemini API error", response.status, providerMessage.slice(0, 300));
      return send(res, 502, { error: "Gemini no pudo completar la consulta. Probá nuevamente en unos segundos." });
    }
    const answer = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (!answer) return send(res, 502, { error: "Gemini no devolvió texto. Probá de nuevo." });
    return send(res, 200, { answer, model });
  } catch (error) {
    console.error("JARVIS Gemini request failed", error?.name || "Error");
    return send(res, 504, { error: "La consulta tardó demasiado o no se pudo conectar. Probá de nuevo." });
  }
};
