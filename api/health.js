module.exports = function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).end(JSON.stringify({ status: "error", error: "Método no permitido." }));
  }
  return res.status(200).end(JSON.stringify({
    service: "JARVIS API",
    status: "online",
    aiConfigured: Boolean(process.env.GEMINI_API_KEY)
  }));
};
