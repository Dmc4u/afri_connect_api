require("dotenv").config();

// Prevent @distube/ytdl-core from dumping huge debug files like `*-player-script.js`
// into the project root when YouTube signature parsing fails.
//
// If you ever need those debug artifacts, explicitly set `YTDL_NO_DEBUG_FILE=` (empty)
// in your environment to re-enable saving.
if (process.env.YTDL_NO_DEBUG_FILE === undefined) {
  process.env.YTDL_NO_DEBUG_FILE = "1";
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const { createServer } = require("http");
const { Server: IOServer } = require("socket.io");
const { errors } = require("celebrate");
// Fixed: Added _id to sender populate in messaging controller
const { limiter: rateLimiter, strictLimiter } = require("./middlewares/rateLimiter");
const pkg = require("./package.json");
const mainRouter = require("./routes/index");
const auth = require("./middlewares/auth");
const errorHandler = require("./middlewares/error-handler");
const { requestLogger, errorLogger } = require("./middlewares/logger");
const {
  logValidationErrors,
  validateSignup,
  validateSignin,
  validateVerifyOtp,
} = require("./middlewares/validation");
const {
  PORT,
  MONGO_URL,
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE,
} = require("./utils/config");
const { createUser, login, verifyLoginOtp } = require("./controllers/user");
const { initializeSocket } = require("./utils/socket");
const PricingSettings = require("./models/PricingSettings");
// Event scheduler - automatically starts events at scheduled time
const { startScheduler } = require("./utils/eventScheduler");
const { startAdMediaCleanupJob } = require("./utils/adMediaCleanup");

const app = express();
const httpServer = createServer(app);

// CORS
// - In production we often host the frontend on different domains/subdomains.
// - Use a safe default that allows requests from any origin, while still
//   protecting privileged actions via auth + adminAuth.
// - If you want to lock it down, set CORS_ORIGINS to a comma-separated allowlist.
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3001",
  "http://127.0.0.1:3001",
  "https://afrionet.com",
  "https://www.afrionet.com",
];

const corsAllowList = String(process.env.CORS_ORIGINS || process.env.ALLOWED_APP_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

const allowedOrigins = corsAllowList.length > 0 ? corsAllowList : DEFAULT_CORS_ORIGINS;

const corsOriginFn = (origin, callback) => {
  // Allow non-browser tools (no Origin header)
  if (!origin) return callback(null, true);

  // If user provided an allowlist, enforce it strictly.
  if (corsAllowList.length > 0) {
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  }

  // Otherwise, allow all origins (reflect origin).
  return callback(null, true);
};

const io = new IOServer(httpServer, {
  cors: {
    origin: corsOriginFn,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  },
  transports: ["websocket", "polling"],
});

// MongoDB connection
mongoose
  .connect(MONGO_URL)
  .then(async () => {
    console.log("✅ Connected to MongoDB");
    // Initialize default pricing settings
    await initializeDefaultPricing();
  })
  .catch((err) => console.error("❌ MongoDB connection error:", err));

mongoose.connection.on("error", (err) => console.error("MongoDB connection lost:", err));

// Initialize default pricing
async function initializeDefaultPricing() {
  try {
    const defaultPrices = [
      { tier: "Free", basePrice: 0, billingPeriod: "forever", currency: "$" },
      { tier: "Starter", basePrice: 3, billingPeriod: "month", currency: "$" },
      { tier: "Premium", basePrice: 7, billingPeriod: "month", currency: "$" },
      { tier: "Pro", basePrice: 20, billingPeriod: "month", currency: "$" },
    ];

    for (const price of defaultPrices) {
      await PricingSettings.findOneAndUpdate({ tier: price.tier }, price, {
        upsert: true,
        new: true,
      });
    }
    console.log("✅ Pricing settings initialized");
  } catch (error) {
    console.error("⚠️  Error initializing pricing settings:", error.message);
  }
}

// Capture raw body for webhook verification
function rawBodySaver(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || "utf8");
  }
}

app.use(express.json({ verify: rawBodySaver, limit: "50mb" }));
app.use(express.urlencoded({ extended: true, verify: rawBodySaver, limit: "50mb" }));

// Enable trust proxy for Cloudflare/Nginx
app.set("trust proxy", 1);

// DON'T use helmet - it overrides CORS headers
// app.use(helmet({
//   crossOriginResourcePolicy: false,
//   crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
// }));

app.use(
  cors({
    origin: corsOriginFn,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    exposedHeaders: ["Cross-Origin-Resource-Policy"],
  })
);

// Basic health endpoint (unauthenticated, not rate-limited)
const paypalHealthCache = {
  checkedAt: 0,
  status: "warning",
  message: "Not checked yet",
};

function normalizeHealthStatus(input) {
  const v = String(input || "").toLowerCase();
  if (v === "healthy" || v === "warning" || v === "error") return v;
  return "warning";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkPayPalHealth({ force = false } = {}) {
  const now = Date.now();
  const cacheTtlMs = 2 * 60 * 1000; // 2 minutes
  if (!force && now - paypalHealthCache.checkedAt < cacheTtlMs) {
    return { status: paypalHealthCache.status, message: paypalHealthCache.message };
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    paypalHealthCache.checkedAt = now;
    paypalHealthCache.status = "warning";
    paypalHealthCache.message = "Missing PayPal credentials";
    return { status: paypalHealthCache.status, message: paypalHealthCache.message };
  }

  const baseUrl =
    PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization:
            "Basic " +
            Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
        },
        body: "grant_type=client_credentials",
      },
      4500
    );

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (response.ok && data?.access_token) {
      paypalHealthCache.checkedAt = now;
      paypalHealthCache.status = "healthy";
      paypalHealthCache.message = `PayPal reachable (${PAYPAL_MODE})`;
      return { status: paypalHealthCache.status, message: paypalHealthCache.message };
    }

    const message =
      data?.error_description ||
      data?.error ||
      data?.message ||
      `PayPal token failed (HTTP ${response.status})`;

    paypalHealthCache.checkedAt = now;
    paypalHealthCache.status =
      response.status === 401 || response.status === 400 ? "error" : "warning";
    paypalHealthCache.message = message;
    return { status: paypalHealthCache.status, message: paypalHealthCache.message };
  } catch (e) {
    paypalHealthCache.checkedAt = now;
    paypalHealthCache.status = "warning";
    paypalHealthCache.message =
      e?.name === "AbortError" ? "PayPal check timed out" : "PayPal check failed";
    return { status: paypalHealthCache.status, message: paypalHealthCache.message };
  }
}

async function checkUploadsStorageHealth() {
  const uploadsDir = path.join(__dirname, "uploads");
  const testFile = path.join(uploadsDir, `.__healthcheck__${Date.now()}.tmp`);
  try {
    await fsp.access(uploadsDir, fs.constants.W_OK);
    await fsp.writeFile(testFile, `ok:${new Date().toISOString()}`);
    await fsp.unlink(testFile);
    return { status: "healthy", message: "Uploads writable" };
  } catch (e) {
    try {
      await fsp.unlink(testFile);
    } catch {
      // ignore
    }
    return { status: "error", message: e?.message || "Uploads not writable" };
  }
}

app.get("/health", async (req, res) => {
  const mongoState = mongoose.connection?.readyState;
  const mongoStateLabel =
    {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    }[mongoState] || "unknown";

  const force = String(req.query?.force || "").trim() === "1";

  const [payments, storage] = await Promise.all([
    checkPayPalHealth({ force }),
    checkUploadsStorageHealth(),
  ]);

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ok: true,
    status: "up",
    name: pkg.name,
    version: pkg.version,
    env: process.env.NODE_ENV || "development",
    uptimeSeconds: Math.round(process.uptime()),
    mongo: {
      readyState: mongoState,
      status: mongoStateLabel,
    },
    payments: {
      status: normalizeHealthStatus(payments.status),
      provider: "paypal",
      mode: PAYPAL_MODE || "sandbox",
      message: payments.message,
    },
    storage: {
      status: normalizeHealthStatus(storage.status),
      type: "uploads",
      message: storage.message,
    },
    timestamp: new Date().toISOString(),
  });
});

app.use(rateLimiter);

// Serve static files from uploads directory with explicit CORS headers
app.use(
  "/uploads",
  (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "uploads"))
);

// Set security headers manually (instead of helmet)
app.use((req, res, next) => {
  if (!req.path.startsWith("/uploads")) {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Additional hardening headers (kept conservative to avoid breaking existing frontend flows)
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  );
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  // Allow PayPal popups/redirect flows
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");

  // HSTS only when actually on HTTPS (production behind proxy/CDN)
  if (
    process.env.NODE_ENV === "production" &&
    (req.secure || req.headers["x-forwarded-proto"] === "https")
  ) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

// Request logging
app.use(requestLogger);

// Authentication routes (no auth middleware needed) - with strict rate limiting
app.post("/signup", strictLimiter, validateSignup, createUser);
// Signin without reCAPTCHA
app.post("/signin", strictLimiter, validateSignin, login);

// Email OTP 2FA verification
app.post("/auth/verify-otp", strictLimiter, validateVerifyOtp, verifyLoginOtp);

// Public PayPal client-id endpoint (no auth required)
app.get("/paypal/client-id", (req, res) => {
  res.json({
    clientId: PAYPAL_CLIENT_ID,
    mode: PAYPAL_MODE || "sandbox",
    currency: "USD",
  });
});

// Public exchange rates endpoint
const exchangeRatesRouter = require("./routes/exchangeRates");
app.use("/exchange-rates", exchangeRatesRouter);

// Universal Payment routes
const paymentsRouter = require("./routes/payments");
app.use("/payments", paymentsRouter);

// Talent Showcase routes
const talentShowcaseRouter = require("./routes/talentShowcase");
app.use("/talent-showcase", talentShowcaseRouter);

// Live Showcase Event routes
const liveShowcaseRouter = require("./routes/liveShowcase");
app.use("/api/live-showcase", liveShowcaseRouter);

// Admin Event Configuration routes
const adminEventConfigRouter = require("./routes/adminEventConfig");
app.use("/api/admin/event-config", adminEventConfigRouter);

// Admin utility routes
const adminUtilsRouter = require("./routes/adminUtils");
app.use("/api/admin", adminUtilsRouter);

// Upload routes (video, images, etc.)
const uploadRouter = require("./routes/upload");
app.use("/api/upload", uploadRouter);

// Resolve/expand external media URLs (e.g., OneDrive short links)
const mediaRouter = require("./routes/media");
app.use("/api/media", mediaRouter);

// Public endpoint to get unique user countries (for exchange rate display)
app.get("/users/countries", async (req, res) => {
  try {
    const User = require("./models/User");
    // Get distinct countries from users, excluding null/undefined
    const countries = await User.distinct("country", { country: { $exists: true, $ne: null } });
    res.json({ success: true, countries });
  } catch (error) {
    console.error("Error fetching user countries:", error);
    res.status(500).json({ success: false, message: "Failed to fetch countries" });
  }
});

// Routes (auth middleware applied per route as needed in individual route files)
app.use("/", mainRouter);

// Initialize Socket.io
initializeSocket(io);

// Error handling
app.use(errors());
app.use(logValidationErrors);
app.use(errorLogger);
app.use(errorHandler);

// Make io accessible to routes
app.locals.io = io;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`💬 WebSocket server initialized`);

  // Event auto-start scheduler - automatically starts events and executes raffles at scheduled times
  startScheduler();
  console.log(
    `⏰ Event scheduler started - will auto-start events and auto-execute raffles at scheduled times`
  );

  // Auto-delete ended ad media from GCS to reduce storage costs.
  startAdMediaCleanupJob();
});
