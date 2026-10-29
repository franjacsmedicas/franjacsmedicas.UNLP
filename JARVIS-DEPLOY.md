# JARVIS — deploy y configuración

## Qué incluye
- `jarvis.html`: interfaz web, chat, voz del navegador y memoria de conversación solo durante la sesión.
- `api/chat.js`: endpoint serverless para OpenAI Responses API. La clave solo se lee del entorno del servidor.
- `vercel.json`: configuración de la función de Vercel.

## Para activar la IA real
1. Importá este repositorio en Vercel y desplegalo desde la rama `main`.
2. En Vercel → Project → Settings → Environment Variables, agregá:
   - `OPENAI_API_KEY`: una clave de API creada en la plataforma de OpenAI. No la publiques en GitHub ni la pegues en el chat.
   - Opcional `OPENAI_MODEL`: por defecto `gpt-5.5`.
   - Opcional `ALLOWED_ORIGIN`: orígenes web adicionales separados por comas. El código incluye el dominio GitHub Pages de Franja y `https://franjacsmedicas.vercel.app` como origen por defecto.
3. Hacé un nuevo deploy después de agregar las variables.
4. Configurá la URL pública de la función como base de API en la página JARVIS si la página sigue alojada en GitHub Pages. Si se sirve desde el mismo proyecto Vercel, la ruta relativa `/api/chat` funciona sin configuración adicional.

## Seguridad y límites
- Nunca uses una clave API en HTML/JavaScript del navegador.
- El endpoint limita el tamaño de mensajes, el historial y solicitudes por IP en cada instancia. Para producción con tráfico público, agregá límites de gasto y protección de abuso en el proveedor/hosting; los límites en memoria son una primera barrera, no un sistema antiabuso completo.
- `store: false` evita almacenar la respuesta como objeto de conversación en la API. El proveedor puede procesar datos conforme a sus políticas.
- El reconocimiento de voz usa la capacidad del navegador; la voz sintetizada puede variar según dispositivo.
- JARVIS no tiene acceso al sistema operativo ni ejecuta comandos arbitrarios. Las acciones externas requieren integraciones explícitas.
