const rateLimit = require("express-rate-limit");

// General rate limiter for all endpoints
const generalLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 500, // Increased to 500 requests per 15 minutes
        message: "Too many requests from this IP, please try again after 15 minutes",
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => {
          // Skip rate limiting for authenticated polling endpoints
          const pollingEndpoints = [
            '/contact-threads/unread-count',
            '/messaging/unread-count',
            '/admin/stats',
            '/admin/health'
          ];
          return pollingEndpoints.some(endpoint => req.path.includes(endpoint));
        }
      })
    : (req, res, next) => next();

// Separate strict limiter for public/auth endpoints (login, signup, etc.)
const strictLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 20, // Only 20 attempts for sensitive endpoints
        message: "Too many attempts, please try again after 15 minutes",
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (req, res, next) => next();

module.exports = { limiter: generalLimiter, strictLimiter };

// Live event & voting rate limiting
// Goal: prevent simple spam/manipulation (votes/viewers) without affecting normal usage.
const liveEventLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 120,
        message: "Too many live event requests, please slow down",
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (req, res, next) => next();

const voteLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 20,
        message: "Too many voting requests, please slow down",
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (req, res, next) => next();

// Payment rate limiting (separate from general and auth)
// Goal: prevent abuse on payment endpoints without affecting normal app usage.
const paymentCreateLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 30, // 30 order creations per 5 minutes per IP
        message: "Too many payment attempts, please try again shortly",
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (req, res, next) => next();

const paymentCaptureLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 5 * 60 * 1000, // 5 minutes
        max: 60, // captures can be retried on flaky networks
        message: "Too many payment capture attempts, please try again shortly",
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (req, res, next) => next();

// Export as named properties while preserving existing exports
module.exports.paymentCreateLimiter = paymentCreateLimiter;
module.exports.paymentCaptureLimiter = paymentCaptureLimiter;

module.exports.liveEventLimiter = liveEventLimiter;
module.exports.voteLimiter = voteLimiter;
