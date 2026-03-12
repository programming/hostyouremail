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
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

// ─── Captcha image generator ───────────────────────────────────────────────

function r(rand, i) { return rand[i % rand.length]; }

function generateCaptchaSvg() {
  // Unambiguous chars only
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = 6;
  const rand = new Uint8Array(256);
  crypto.getRandomValues(rand);

  let text = "";
  for (let i = 0; i < len; i++) text += charset[r(rand, i) % charset.length];

  const W = 200, H = 70;
  let ri = len; // rand index offset

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;

  // Background
  svg += `<rect width="${W}" height="${H}" fill="#f4f4f0" rx="2"/>`;

  // Speckle noise
  for (let i = 0; i < 120; i++) {
    const x = r(rand, ri++) % W;
    const y = r(rand, ri++) % H;
    const gray = 140 + r(rand, ri++) % 80;
    svg += `<circle cx="${x}" cy="${y}" r="0.8" fill="rgb(${gray},${gray},${gray})"/>`;
  }

  // Wavy interference lines (bezier curves)
  for (let i = 0; i < 5; i++) {
    const x1 = r(rand, ri++) % 30;
    const y1 = 10 + r(rand, ri++) % (H - 20);
    const cx1 = 40 + r(rand, ri++) % 40;
    const cy1 = r(rand, ri++) % H;
    const cx2 = 110 + r(rand, ri++) % 40;
    const cy2 = r(rand, ri++) % H;
    const x2 = W - r(rand, ri++) % 30;
    const y2 = 10 + r(rand, ri++) % (H - 20);
    const cr = 60 + r(rand, ri++) % 120;
    const cg = 60 + r(rand, ri++) % 120;
    const cb = 60 + r(rand, ri++) % 120;
    const sw = 1 + (r(rand, ri++) % 10) / 10;
    svg += `<path d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}" stroke="rgb(${cr},${cg},${cb})" stroke-width="${sw}" fill="none" opacity="0.6"/>`;
  }

  // Characters — each with random transform, size, color, slight skew
  const fonts = ["serif", "sans-serif", "monospace"];
  const slotW = W / (len + 1);

  for (let i = 0; i < len; i++) {
    const baseX = slotW * (i + 0.75) + (r(rand, ri++) % 12) - 6;
    const baseY = 38 + (r(rand, ri++) % 16) - 8;
    const rotate = (r(rand, ri++) % 50) - 25;
    const size = 24 + r(rand, ri++) % 10;
    const cr = r(rand, ri++) % 90;
    const cg = r(rand, ri++) % 90;
    const cb = r(rand, ri++) % 90;
    const font = fonts[r(rand, ri++) % fonts.length];
    const bold = r(rand, ri++) % 2 === 0 ? "bold" : "normal";
    const skewX = (r(rand, ri++) % 20) - 10;
    svg += `<text `
      + `x="${baseX}" y="${baseY}" `
      + `font-family="${font}" font-size="${size}" font-weight="${bold}" `
      + `fill="rgb(${cr},${cg},${cb})" `
      + `transform="rotate(${rotate},${baseX},${baseY}) skewX(${skewX})">`
      + `${text[i]}</text>`;
  }

  // Overlay a few short random line segments on top of text
  for (let i = 0; i < 6; i++) {
    const x1 = r(rand, ri++) % W;
    const y1 = r(rand, ri++) % H;
    const x2 = x1 + (r(rand, ri++) % 40) - 20;
    const y2 = y1 + (r(rand, ri++) % 20) - 10;
    const gray = 80 + r(rand, ri++) % 80;
    svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgb(${gray},${gray},${gray})" stroke-width="1" opacity="0.5"/>`;
  }

  svg += "</svg>";
  return { text, svg };
}

// ─── Main handler ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // GET /api/captcha — generate image, return SVG + nonce
    if (path === "/api/captcha" && request.method === "GET") {
      const nonce = crypto.randomUUID();
      const { svg } = generateCaptchaSvg();
      // Answer is discarded — we never accept any answer
      return json({ nonce, image: svg });
    }

    // POST /api/captcha/verify — always fails, returns fresh image
    if (path === "/api/captcha/verify" && request.method === "POST") {
      const nonce = crypto.randomUUID();
      const { svg } = generateCaptchaSvg();
      return json({
        success: false,
        message: "The characters you entered didn't match. Please try again.",
        nonce,
        image: svg,
      });
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

      if (!captcha_token || !captcha_nonce) {
        return json({ error: "Please complete the captcha" }, 403);
      }
      const valid = await hmacVerify(env.CAPTCHA_SECRET, "captcha-passed:" + captcha_nonce, captcha_token);
      if (!valid) {
        return json({ error: "Please complete the captcha" }, 403);
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
