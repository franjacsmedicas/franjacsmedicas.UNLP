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

  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  // Fallbacks estables y habilitados para proyectos nuevos; evitar Gemini 2.5 restringido.
  const models = [...new Set([primaryModel, "gemini-3.5-flash-lite", "gemini-3.8-flash"])];
  const payload = {
    systemInstruction: { parts: [{ text: instructions }] },
    contents: safeMessages,
    generationConfig: { maxOutputTokens: 1200, temperature: 0.7 }
  };

  let lastStatus = 0;
  let lastMessage = "";
  for (const model of models) {
    // Dos intentos breves para absorber errores transitorios del proveedor.
    for (let attempt = 0; attempt < 1; attempt++) {
      try {
        const response = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
          {
            method: "POST",
            headers: {
              "x-goog-api-key": process.env.GEMINI_API_KEY,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(18000)
          }
        );
        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          const answer = (data?.candidates?.[0]?.content?.parts || [])
            .map((part) => typeof part.text === "string" ? part.text : "")
            .join("")
            .trim();
          if (answer) return send(res, 200, { answer, model });
          lastStatus = 502;
          lastMessage = "Gemini no devolvió texto.";
          break;
        }

        lastStatus = response.status;
        lastMessage = data?.error?.message || "";
        if (response.status === 401 || response.status === 403) {
          console.error("Gemini authentication error", response.status, lastMessage.slice(0, 200));
          return send(res, 502, { error: "Google rechazó la clave de Gemini o no tiene acceso al modelo. Revisá la clave y el proyecto en AI Studio." });
        }
        if (response.status === 429) {
          console.error("Gemini quota/rate limit", response.status, lastMessage.slice(0, 200));
          return send(res, 429, { error: "Gemini alcanzó el límite de uso o cuota. Esperá a que se restablezca o revisá los límites del proyecto." });
        }

        console.error("Gemini API error", model, response.status, lastMessage.slice(0, 200));
        // Reintentar sólo errores temporales; ante 5xx se prueba luego el modelo alternativo.
        if (response.status < 500) break;
      } catch (error) {
        lastMessage = error?.name || "Error de conexión";
        console.error("JARVIS Gemini attempt failed", model, attempt + 1, lastMessage);
      }
    }
  }

  if (lastStatus === 502 && lastMessage === "Gemini no devolvió texto.") {
    return send(res, 502, { error: "Gemini no devolvió una respuesta. Probá de nuevo." });
  }
  return send(res, 503, {
    error: "Los modelos de Gemini están temporalmente ocupados o no responden. JARVIS ya intentó una alternativa; esperá unos segundos y volvé a intentar."
  });
};
