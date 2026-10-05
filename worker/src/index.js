const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "access-control-allow-origin": "https://franjacsmedicas.github.io",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function normalizeDni(value) {
  return String(value || "").replace(/\D/g, "");
}

async function hmacDni(dni, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(dni)
  );
  return [...new Uint8Array(signature)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: JSON_HEADERS });
    if (request.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

    try {
      const body = await request.json();
      const dni = normalizeDni(body.dni);

      if (!/^\d{7,9}$/.test(dni)) {
        return json({ ok: false, error: "Ingresá un DNI válido." }, 400);
      }
      if (!env.DNI_HMAC_SECRET) {
        return json({ ok: false, error: "API no configurada." }, 500);
      }

      const dniHash = await hmacDni(dni, env.DNI_HMAC_SECRET);
      const row = await env.DB.prepare(
        "SELECT category, mesa, sede, instructions FROM padron WHERE dni_hash = ? LIMIT 1"
      ).bind(dniHash).first();

      if (!row) {
        return json({ ok: true, found: false, message: "No encontramos un registro con ese DNI en la base electoral cargada." });
      }

      return json({
        ok: true,
        found: true,
        result: {
          category: row.category,
          mesa: row.mesa || "Pendiente de oficialización",
          sede: row.sede || "Facultad de Ciencias Médicas UNLP",
          instructions: row.instructions || "Presentate con documentación habilitada."
        }
      });
    } catch (error) {
      return json({ ok: false, error: "No se pudo realizar la consulta." }, 500);
    }
  }
};
