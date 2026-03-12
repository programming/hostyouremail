const WORKER_URL = (() => {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "http://localhost:8787";
  return "https://hostyouremail-worker.singapore.workers.dev";
})();

// ─── Password generation ───────────────────────────────────────────────────
function generatePassword(length = 20) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = upper + lower + digits + symbols;

  const rand = new Uint8Array(length + 8);
  crypto.getRandomValues(rand);

  let pwd = [
    upper[rand[0] % upper.length],
    lower[rand[1] % lower.length],
    digits[rand[2] % digits.length],
    symbols[rand[3] % symbols.length],
  ];
  for (let i = 4; i < length; i++) pwd.push(all[rand[i] % all.length]);

  crypto.getRandomValues(rand);
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join("");
}

// ─── DOM ──────────────────────────────────────────────────────────────────
const usernameInput   = document.getElementById("username");
const checkBtn        = document.getElementById("check-btn");
const registerBtn     = document.getElementById("register-btn");
const availMsg        = document.getElementById("availability-msg");
const registerSection = document.getElementById("register-section");
const successSection  = document.getElementById("success-section");
const resultEmail     = document.getElementById("result-email");
const resultPassword  = document.getElementById("result-password");
const revealBtn       = document.getElementById("reveal-btn");
const captchaQuestion = document.getElementById("captcha-question");
const captchaAnswer   = document.getElementById("captcha-answer");
const captchaBtn      = document.getElementById("captcha-btn");
const captchaMsg      = document.getElementById("captcha-msg");

let lastCheckedUsername = null;
let isAvailable = false;
let captchaNonce = null;   // nonce from server
let captchaToken = null;   // signed token — never issued by server, always null

// ─── Captcha ──────────────────────────────────────────────────────────────
async function loadCaptcha() {
  try {
    const res = await fetch(`${WORKER_URL}/api/captcha`);
    const data = await res.json();
    captchaNonce = data.nonce;
    captchaQuestion.textContent = data.question;
    captchaAnswer.value = "";
  } catch {
    captchaQuestion.textContent = "unavailable";
  }
}
loadCaptcha();

captchaBtn.addEventListener("click", async () => {
  captchaBtn.disabled = true;
  try {
    const res = await fetch(`${WORKER_URL}/api/captcha/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nonce: captchaNonce, answer: captchaAnswer.value.trim() }),
    });
    const data = await res.json();
    // Server always returns success: false — update nonce/question for next attempt
    captchaNonce = data.nonce;
    captchaQuestion.textContent = data.question;
    captchaAnswer.value = "";
    captchaMsg.textContent = data.message || "Incorrect. Please try again.";
  } catch {
    captchaMsg.textContent = "Could not reach server. Try again.";
  } finally {
    captchaBtn.disabled = false;
  }
});

captchaAnswer.addEventListener("keydown", (e) => {
  if (e.key === "Enter") captchaBtn.click();
});

// ─── Username validation ──────────────────────────────────────────────────
function validateUsername(u) {
  if (!u) return "Enter a username";
  if (u.length < 2) return "At least 2 characters";
  if (u.length > 32) return "32 characters max";
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return "Letters, numbers, dots, hyphens, underscores only";
  if (/^[._-]|[._-]$/.test(u)) return "Cannot start or end with . - _";
  return null;
}

function setMsg(state, text) {
  availMsg.textContent = text;
  availMsg.className = state;
}

usernameInput.addEventListener("input", () => {
  if (usernameInput.value !== lastCheckedUsername) {
    isAvailable = false;
    registerBtn.disabled = true;
    availMsg.textContent = "";
    availMsg.className = "";
  }
});

usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAvailability();
});

// ─── Check availability ───────────────────────────────────────────────────
checkBtn.addEventListener("click", checkAvailability);

async function checkAvailability() {
  const username = usernameInput.value.trim();
  const err = validateUsername(username);
  if (err) { setMsg("", err); return; }

  setMsg("", "Checking…");
  checkBtn.disabled = true;
  registerBtn.disabled = true;
  isAvailable = false;

  try {
    const res = await fetch(`${WORKER_URL}/api/check?username=${encodeURIComponent(username)}`);
    const data = await res.json();
    if (!res.ok) { setMsg("", data.error || "Error checking availability"); return; }

    if (data.available) {
      setMsg("", `✓ ${username}@hostyouremail.com is available`);
      isAvailable = true;
      lastCheckedUsername = username;
      // Register stays disabled — captcha token is never issued by server
      registerBtn.disabled = true;
    } else {
      setMsg("", `✗ ${username}@hostyouremail.com is already taken`);
    }
  } catch {
    setMsg("", "Could not reach server. Try again.");
  } finally {
    checkBtn.disabled = false;
  }
}

// ─── Register ─────────────────────────────────────────────────────────────
registerBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();
  if (!isAvailable || username !== lastCheckedUsername) {
    setMsg("", "Please check availability first");
    return;
  }

  const password = generatePassword(20);
  registerBtn.disabled = true;
  registerBtn.textContent = "Registering…";

  try {
    const res = await fetch(`${WORKER_URL}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        captcha_token: captchaToken,   // always null — server will reject
        captcha_nonce: captchaNonce,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setMsg("", data.error || "Registration failed");
      registerBtn.disabled = false;
      registerBtn.textContent = "Register";
      return;
    }

    resultEmail.textContent = data.email;
    resultPassword.textContent = password;
    registerSection.hidden = true;
    successSection.hidden = false;
    successSection.scrollIntoView({ behavior: "smooth" });
  } catch {
    setMsg("", "Network error. Please try again.");
    registerBtn.disabled = false;
    registerBtn.textContent = "Register";
  }
});

// ─── Copy ─────────────────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  const el = document.getElementById(btn.dataset.target);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    const orig = btn.textContent;
    btn.textContent = "copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch {
    alert(el.textContent);
  }
});

// ─── Reveal password ──────────────────────────────────────────────────────
if (revealBtn) {
  revealBtn.addEventListener("click", () => {
    resultPassword.classList.toggle("blurred");
    revealBtn.textContent = resultPassword.classList.contains("blurred") ? "show" : "hide";
  });
}
