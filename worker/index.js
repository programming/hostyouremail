const MXROUTE_BASE = "https://api.mxroute.com";
const DOMAIN = "hostyouremail.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function mxFetch(env, path, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      "X-API-Key": env.MXROUTE_API_KEY,
      "X-Server": env.MXROUTE_SERVER,
      "X-Username": env.MXROUTE_USERNAME,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${MXROUTE_BASE}${path}`, opts);
}

// ─── HMAC helpers ─────────────────────────────────────────────────────────

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(secret, message, token) {
  const expected = await hmacSign(secret, message);
  // constant-time comparison
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

// ─── Captcha helpers ──────────────────────────────────────────────────────

function newQuestion() {
  const a = Math.floor(Math.random() * 20) + 1;
  const b = Math.floor(Math.random() * 20) + 1;
  return { a, b, question: `${a} + ${b}` };
}

// Token = HMAC(CAPTCHA_SECRET, "captcha-passed:" + nonce)
// The nonce is issued by /api/captcha. The token is ONLY valid if we sign it,
// which we never do (captcha always fails). So registration always rejects.

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /api/captcha — issue a nonce + question
    if (path === "/api/captcha" && request.method === "GET") {
      const nonce = crypto.randomUUID();
      const { question } = newQuestion();
      return json({ nonce, question });
    }

    // POST /api/captcha/verify — always fails, never issues a token
    if (path === "/api/captcha/verify" && request.method === "POST") {
      // Regenerate a fresh nonce+question for the next attempt
      const nonce = crypto.randomUUID();
      const { question } = newQuestion();
      return json({ success: false, message: "Incorrect. Please try again.", nonce, question });
    }

    // GET /api/check?username=john
    if (path === "/api/check" && request.method === "GET") {
      const username = url.searchParams.get("username");
      if (!username) return json({ error: "username required" }, 400);

      const validation = validateUsername(username);
      if (!validation.ok) return json({ available: false, reason: validation.reason });

      try {
        const res = await mxFetch(env, `/domains/${DOMAIN}/email-accounts`);
        if (!res.ok) {
          const text = await res.text();
          return json({ error: "upstream error", detail: text }, 502);
        }
        const data = await res.json();
        const accounts = Array.isArray(data) ? data : (data.data || data.accounts || []);
        const taken = accounts.some(
          (a) => (a.username || a.email || "").toLowerCase().split("@")[0] === username.toLowerCase()
        );
        return json({ available: !taken });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // POST /api/register { username, password, captcha_token, captcha_nonce }
    if (path === "/api/register" && request.method === "POST") {
      let body;
      try { body = await request.json(); }
      catch { return json({ error: "invalid JSON" }, 400); }

      const { username, password, captcha_token, captcha_nonce } = body;

      // Enforce captcha server-side — token must be HMAC(CAPTCHA_SECRET, "captcha-passed:" + nonce)
      // Since we never issue this token, registration always fails here.
      if (!captcha_token || !captcha_nonce) {
        return json({ error: "Captcha required" }, 403);
      }
      const valid = await hmacVerify(env.CAPTCHA_SECRET, "captcha-passed:" + captcha_nonce, captcha_token);
      if (!valid) {
        return json({ error: "Captcha required" }, 403);
      }

      if (!username || !password) return json({ error: "username and password required" }, 400);

      const validation = validateUsername(username);
      if (!validation.ok) return json({ error: validation.reason }, 400);

      if (password.length < 16) return json({ error: "password too short" }, 400);

      try {
        const res = await mxFetch(
          env,
          `/domains/${DOMAIN}/email-accounts`,
          "POST",
          { username: username.toLowerCase(), password, quota: 250 }
        );

        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }

        if (!res.ok) {
          const msg = (data.message || data.error || text).toLowerCase();
          if (msg.includes("exist") || msg.includes("taken") || msg.includes("duplicate")) {
            return json({ error: "Username already taken" }, 409);
          }
          return json({ error: data.message || data.error || "Registration failed", detail: data }, 502);
        }

        return json({ success: true, email: `${username.toLowerCase()}@${DOMAIN}` });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};

function validateUsername(username) {
  if (!username) return { ok: false, reason: "Username is required" };
  if (username.length < 2) return { ok: false, reason: "Username must be at least 2 characters" };
  if (username.length > 32) return { ok: false, reason: "Username must be 32 characters or fewer" };
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    return { ok: false, reason: "Username may only contain letters, numbers, dots, hyphens, and underscores" };
  }
  if (/^[._-]|[._-]$/.test(username)) {
    return { ok: false, reason: "Username cannot start or end with a dot, hyphen, or underscore" };
  }
  return { ok: true };
}
