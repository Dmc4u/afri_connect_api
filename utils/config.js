require("dotenv").config();

const {
  PORT = 4000,
  MONGO_URL = "mongodb://127.0.0.1:27017/afri-connect_db",
  JWT_SECRET = "dev-secret-key-not-for-production",
  NODE_ENV = "development",
  BCRYPT_ROUNDS = 10,
  TOKEN_EXPIRY = "7d",

  // ✅ App
  APP_NAME = "AfriOnet",
  FRONTEND_URL = "http://localhost:3000",
  BRAND_LOGO_URL,

  // ✅ Email/SMTP (support both SMTP_* and legacy EMAIL_* names)
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  FROM_EMAIL,
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,

  // ✅ reCAPTCHA (v2/v3)
  RECAPTCHA_SECRET,
  RECAPTCHA_SECRET_KEY,
  RECAPTCHA_MIN_SCORE = 0.5,

  // ✅ Admin Configuration
  ADMIN_EMAIL,
  ADMIN_EMAILS = "", // Comma-separated list of admin emails

  // ✅ PayPal
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE, // Will be overridden based on NODE_ENV

  // ✅ Recent Views Settings
  RECENT_VIEWS_MAX = 10,
  RECENT_VIEWS_TTL_DAYS = 30,
} = process.env;

const SMTP_HOST_RESOLVED = SMTP_HOST || EMAIL_HOST;
const SMTP_PORT_RESOLVED = SMTP_PORT || EMAIL_PORT;
const SMTP_USER_RESOLVED = SMTP_USER || EMAIL_USER;
const SMTP_PASS_RESOLVED = SMTP_PASS || EMAIL_PASS;
const FROM_EMAIL_RESOLVED = FROM_EMAIL || EMAIL_FROM || SMTP_USER_RESOLVED;

// ✅ Enforce PayPal mode based on environment
// In development, ALWAYS use sandbox regardless of .env setting
// In production, use the .env setting (should be 'live')
const PAYPAL_MODE_ENFORCED = NODE_ENV === "production" ? PAYPAL_MODE || "live" : "sandbox";

// ✅ Validate PayPal configuration
if (NODE_ENV === "production" && PAYPAL_MODE_ENFORCED === "sandbox") {
  console.warn("⚠️  WARNING: Running production with PayPal sandbox mode!");
}

if (NODE_ENV === "development" && PAYPAL_MODE !== "sandbox") {
  console.warn(
    "⚠️  WARNING: Development detected - forcing PayPal sandbox mode to prevent real charges"
  );
}

console.log(`💳 PayPal Mode: ${PAYPAL_MODE_ENFORCED} (Environment: ${NODE_ENV})`);

// ✅ Production safety checks
if (NODE_ENV === "production" && !(RECAPTCHA_SECRET || RECAPTCHA_SECRET_KEY)) {
  throw new Error(
    "❌ Missing reCAPTCHA secret in production. Set RECAPTCHA_SECRET (or RECAPTCHA_SECRET_KEY)."
  );
}

// JWT_SECRET validation removed - make sure to set a strong secret in production .env
// if (NODE_ENV === "production" && JWT_SECRET === "dev-secret-key-not-for-production") {
//   throw new Error("❌ JWT_SECRET must be changed in production");
// }

module.exports = {
  PORT: Number(PORT),
  MONGO_URL,
  JWT_SECRET,
  NODE_ENV,
  BCRYPT_ROUNDS: Number(BCRYPT_ROUNDS),
  TOKEN_EXPIRY,

  // ✅ App
  APP_NAME,
  FRONTEND_URL,
  BRAND_LOGO_URL: BRAND_LOGO_URL || `${FRONTEND_URL}/afri-c.svg`,

  // ✅ Email/SMTP
  SMTP_HOST: SMTP_HOST_RESOLVED,
  SMTP_PORT: SMTP_PORT_RESOLVED,
  SMTP_USER: SMTP_USER_RESOLVED,
  SMTP_PASS: SMTP_PASS_RESOLVED,
  FROM_EMAIL: FROM_EMAIL_RESOLVED,

  // ✅ reCAPTCHA (support both env var names)
  RECAPTCHA_SECRET: RECAPTCHA_SECRET || RECAPTCHA_SECRET_KEY,
  RECAPTCHA_MIN_SCORE: Number(RECAPTCHA_MIN_SCORE),

  // ✅ Admin Configuration
  ADMIN_EMAIL,
  ADMIN_EMAILS: ADMIN_EMAILS
    ? ADMIN_EMAILS.split(",").map((email) => email.trim().toLowerCase())
    : [],

  // ✅ PayPal Config (enforced based on environment)
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE: PAYPAL_MODE_ENFORCED,

  // ✅ Recent Views
  RECENT_VIEWS_MAX: Number(RECENT_VIEWS_MAX) || 10,
  RECENT_VIEWS_TTL_DAYS: Number(RECENT_VIEWS_TTL_DAYS) || 30,
};
