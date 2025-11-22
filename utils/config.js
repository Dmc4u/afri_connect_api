require("dotenv").config();

const {
  PORT = 4000,
  MONGO_URL = "mongodb://127.0.0.1:27017/afri-onet_db",
  JWT_SECRET = "dev-secret-key-not-for-production",
  NODE_ENV = "development",
  BCRYPT_ROUNDS = 10,
  TOKEN_EXPIRY = "7d",

  // ✅ Admin Configuration
  ADMIN_EMAIL,
  ADMIN_EMAILS = "", // Comma-separated list of admin emails

  // ✅ PayPal
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE = "sandbox", // default sandbox

  // ✅ Recent Views Settings
  RECENT_VIEWS_MAX = 10,
  RECENT_VIEWS_TTL_DAYS = 30,
} = process.env;

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

  // reCAPTCHA removed

  // ✅ Admin Configuration
  ADMIN_EMAIL,
  ADMIN_EMAILS: ADMIN_EMAILS
    ? ADMIN_EMAILS.split(",").map((email) => email.trim().toLowerCase())
    : [],

  // ✅ PayPal Config
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_MODE,

  // ✅ Recent Views
  RECENT_VIEWS_MAX: Number(RECENT_VIEWS_MAX) || 10,
  RECENT_VIEWS_TTL_DAYS: Number(RECENT_VIEWS_TTL_DAYS) || 30,
};
