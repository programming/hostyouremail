// Detect worker URL — same origin in prod, localhost:8787 in dev
const WORKER_URL = (() => {
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:8787";
  }
  return "https://hostyouremail-worker.singapore.workers.dev";
})();

// ─── Password generation ───────────────────────────────────────────────────
function generatePassword(length = 20) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*-_=+";
  const all = upper + lower + digits + symbols;

  const array = new Uint8Array(length + 8);
  crypto.getRandomValues(array);

  // Guarantee at least one of each category
  let pwd = [
    upper[array[0] % upper.length],
    lower[array[1] % lower.length],
    digits[array[2] % digits.length],
    symbols[array[3] % symbols.length],
  ];

  for (let i = 4; i < length; i++) {
    pwd.push(all[array[i] % all.length]);
  }

  // Shuffle using Fisher-Yates with remaining random bytes
  crypto.getRandomValues(array);
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = array[i] % (i + 1);
    [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }

  return pwd.join("");
}

// ─── DOM refs ─────────────────────────────────────────────────────────────
const usernameInput = document.getElementById("username");
const checkBtn = document.getElementById("check-btn");
const registerBtn = document.getElementById("register-btn");
const availMsg = document.getElementById("availability-msg");
const registerCard = document.getElementById("register-card");
const successCard = document.getElementById("success-card");
const resultEmail = document.getElementById("result-email");
const resultPassword = document.getElementById("result-password");
const revealBtn = document.getElementById("reveal-btn");

let lastCheckedUsername = null;
let isAvailable = false;

// ─── Username validation (client side) ────────────────────────────────────
function validateUsername(u) {
  if (!u) return "Enter a username";
  if (u.length < 2) return "At least 2 characters";
  if (u.length > 32) return "32 characters max";
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return "Letters, numbers, dots, hyphens, underscores only";
  if (/^[._-]|[._-]$/.test(u)) return "Cannot start or end with . - _";
  return null;
}

function setAvailability(state, msg) {
  availMsg.textContent = msg;
  availMsg.className = `availability-msg ${state}`;
}

// ─── Check availability ───────────────────────────────────────────────────
checkBtn.addEventListener("click", checkAvailability);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkAvailability();
});
usernameInput.addEventListener("input", () => {
  // Reset state if user edits the field after a check
  if (usernameInput.value !== lastCheckedUsername) {
    isAvailable = false;
    registerBtn.disabled = true;
    availMsg.textContent = "";
    availMsg.className = "availability-msg";
  }
});

async function checkAvailability() {
  const username = usernameInput.value.trim();
  const err = validateUsername(username);
  if (err) {
    setAvailability("taken", err);
    return;
  }

  setAvailability("checking", "Checking…");
  checkBtn.disabled = true;
  registerBtn.disabled = true;
  isAvailable = false;

  try {
    const res = await fetch(`${WORKER_URL}/api/check?username=${encodeURIComponent(username)}`);
    const data = await res.json();

    if (!res.ok) {
      setAvailability("error", `Error: ${data.error || "could not check"}`);
      return;
    }

    if (data.available) {
      setAvailability("available", `✓ ${username}@hostyouremail.com is available!`);
      isAvailable = true;
      lastCheckedUsername = username;
      registerBtn.disabled = false;
    } else {
      setAvailability("taken", `✗ ${username}@hostyouremail.com is already taken`);
    }
  } catch (e) {
    setAvailability("error", "Could not reach server. Try again.");
  } finally {
    checkBtn.disabled = false;
  }
}

// ─── Register ─────────────────────────────────────────────────────────────
registerBtn.addEventListener("click", async () => {
  const username = usernameInput.value.trim();

  if (!isAvailable || username !== lastCheckedUsername) {
    setAvailability("taken", "Please check availability first");
    return;
  }

  const password = generatePassword(20);

  registerBtn.disabled = true;
  registerBtn.textContent = "Registering…";

  try {
    const res = await fetch(`${WORKER_URL}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data.error || "Registration failed";
      setAvailability("taken", `Error: ${msg}`);
      registerBtn.disabled = false;
      registerBtn.textContent = "Register this address";
      return;
    }

    // Success!
    resultEmail.textContent = data.email;
    resultPassword.textContent = password;

    registerCard.hidden = true;
    successCard.hidden = false;
    successCard.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    setAvailability("error", "Network error. Please try again.");
    registerBtn.disabled = false;
    registerBtn.textContent = "Register this address";
  }
});

// ─── Copy buttons ─────────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btn-copy");
  if (!btn) return;
  const targetId = btn.dataset.target;
  const el = document.getElementById(targetId);
  if (!el) return;

  try {
    await navigator.clipboard.writeText(el.textContent);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch {
    alert(`Copy this manually:\n${el.textContent}`);
  }
});

// ─── Reveal password ──────────────────────────────────────────────────────
if (revealBtn) {
  revealBtn.addEventListener("click", () => {
    const isBlurred = resultPassword.classList.contains("password-blur");
    if (isBlurred) {
      resultPassword.classList.remove("password-blur");
      resultPassword.classList.add("revealed");
      revealBtn.textContent = "Hide";
    } else {
      resultPassword.classList.add("password-blur");
      resultPassword.classList.remove("revealed");
      revealBtn.textContent = "Show";
    }
  });
}
