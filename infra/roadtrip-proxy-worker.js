// roadtrip-proxy — Cloudflare Worker
// Proxies /claude and /gemini requests, keeping both API keys server-side.
// Requires a valid Firebase ID token on every request — verified against
// Google's own accounts:lookup endpoint, so a random curl request without
// a real signed-in session gets rejected before it ever reaches an AI API.

const ALLOWED_ORIGINS = [
  "https://c0demode.github.io",
  "https://trippy.williamalderman.com",
];

// This is the public Firebase Web API key from firebaseConfig in index.html
// — it's meant to be public (it identifies the project, it doesn't grant
// access on its own), so it's fine as a plain constant, not a secret.
const FIREBASE_API_KEY = "AIzaSyACr4J3jK2_ecsxtUfMh9t3rCnX_zWv8Ck";

async function verifyFirebaseToken(idToken) {
  if (!idToken) return false;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data.users) && data.users.length > 0;
  } catch (e) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response("Origin not allowed", { status: 403, headers: corsHeaders });
    }

    const authHeader = request.headers.get("Authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const isValidUser = await verifyFirebaseToken(idToken);
    if (!isValidUser) {
      return new Response("Unauthorized — sign in required", { status: 401, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const body = await request.text();

    if (url.pathname === "/claude") {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body,
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    if (url.pathname === "/gemini") {
      // gemini-3.6-flash is the current stable Flash model (as of Aug 2026).
      // gemini-2.5-flash is deprecated and shuts down Oct 16, 2026 — don't
      // use it for anything new. Avoid the "gemini-flash-latest" alias too;
      // it points to an experimental build not meant for production.
      const model = "gemini-3.6-flash";
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }
      );
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};

function buildCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}
