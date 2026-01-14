const { RECAPTCHA_SECRET, RECAPTCHA_MIN_SCORE = 0.5, NODE_ENV } = require("../utils/config");

const isEnforced = () => {
  const raw = process.env.RECAPTCHA_ENFORCE;
  return String(raw || "").toLowerCase() === "true";
};

// Use global fetch if available (Node >=18); fallback to node-fetch dynamically
async function doFetch(url, options) {
  if (typeof fetch === "function") return fetch(url, options);
  const mod = await import("node-fetch");
  return mod.default(url, options);
}

/**
 * Middleware to verify Google reCAPTCHA token (v2 or v3)
 * - Expects token in req.body.recaptchaToken or header 'x-recaptcha-token'
 * - On success, sets req.recaptcha = { success, score, action, challenge_ts, hostname }
 */
module.exports = async function verifyRecaptcha(req, res, next) {
  try {
    // In local/dev environments, do not block requests by default.
    // Set RECAPTCHA_ENFORCE=true to turn verification on.
    if (NODE_ENV !== "production" && !isEnforced()) {
      return next();
    }

    const token = req.body?.recaptchaToken || req.headers["x-recaptcha-token"];

    if (!RECAPTCHA_SECRET) {
      // If secret not configured, block in production; warn in dev
      const msg = "reCAPTCHA secret not configured on server";
      if (NODE_ENV === "production") {
        return res.status(500).json({ success: false, message: msg });
      }
      console.warn("[reCAPTCHA] " + msg + ". Skipping verification in non-production.");
      return next();
    }

    if (!token) {
      return res.status(400).json({ success: false, message: "Missing reCAPTCHA token" });
    }

    const params = new URLSearchParams();
    params.append("secret", RECAPTCHA_SECRET);
    params.append("response", token);
    if (req.ip) params.append("remoteip", req.ip);

    const resp = await doFetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const data = await resp.json();

    if (!data.success) {
      return res.status(403).json({
        success: false,
        message: "reCAPTCHA verification failed",
        errors: data["error-codes"] || [],
      });
    }

    // For v3, enforce minimum score if present
    if (typeof data.score === "number" && data.score < Number(RECAPTCHA_MIN_SCORE)) {
      return res.status(403).json({
        success: false,
        message: "reCAPTCHA score too low",
        score: data.score,
      });
    }

    req.recaptcha = {
      success: true,
      score: data.score,
      action: data.action,
      challenge_ts: data.challenge_ts,
      hostname: data.hostname,
    };

    return next();
  } catch (err) {
    console.error("[reCAPTCHA] Verification error:", err);
    return res.status(500).json({ success: false, message: "reCAPTCHA verification error" });
  }
};
