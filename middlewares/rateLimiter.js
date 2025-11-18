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
