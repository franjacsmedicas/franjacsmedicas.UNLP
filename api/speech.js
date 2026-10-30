// JARVIS text-to-speech endpoint powered by ElevenLabs.
// Required environment variables: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
const MAX_TEXT_LENGTH = 2400;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 25;
const requestBuckets = new Map();

function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
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
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return send(res, 405, { error: "Método no permitido." });
  }
  const origin = req.headers.origin || "";
  if (!allowedOrigin(origin)) return send(res, 403, { error: "Origen no autorizado." });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (!rateLimit(req)) return send(res, 429, { error: "Límite de voz alcanzado. Esperá un minuto." });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return send(res, 503, { error: "La voz de JARVIS todavía no está configurada en el servidor." });
  }

  let body = req.body;
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > 10000) return send(res, 413, { error: "Solicitud demasiado grande." });
    try { body = JSON.parse(body); } catch { return send(res, 400, { error: "Solicitud JSON inválida." }); }
  }
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return send(res, 400, { error: "Falta el texto que se debe convertir en voz." });
  if (text.length > MAX_TEXT_LENGTH) return send(res, 413, { error: "La respuesta es demasiado larga para sintetizarla de una vez." });

  try {
    const model = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
    const upstream = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId) + "/stream?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        body: JSON.stringify({
          text,
          model_id: model,
          language_code: "es",
          voice_settings: {
            stability: 0.52,
            similarity_boost: 0.82,
            style: 0.28,
            use_speaker_boost: true,
            speed: 1.02
          }
        }),
        signal: AbortSignal.timeout(45000)
      }
    );

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      console.error("ElevenLabs API error", upstream.status, detail.slice(0, 300));
      if (upstream.status === 401 || upstream.status === 403) {
        return send(res, 502, { error: "ElevenLabs rechazó la clave API. Revisá ELEVENLABS_API_KEY en Vercel." });
      }
      if (upstream.status === 404) {
        return send(res, 502, { error: "No se encontró la voz configurada. Revisá ELEVENLABS_VOICE_ID en Vercel." });
      }
      if (upstream.status === 429) {
        return send(res, 429, { error: "Se agotó temporalmente la cuota de ElevenLabs." });
      }
      return send(res, 502, { error: "ElevenLabs no pudo generar el audio. Probá nuevamente." });
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    if (!audio.length) return send(res, 502, { error: "ElevenLabs devolvió un audio vacío." });
    res.status(200);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.end(audio);
  } catch (error) {
    console.error("JARVIS speech request failed", error?.name || "Error");
    return send(res, 504, { error: "La generación de voz tardó demasiado. Probá de nuevo." });
  }
};
