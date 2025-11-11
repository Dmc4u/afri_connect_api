const rateLimit = require("express-rate-limit");

// Only apply rate limiting in production
const limiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // Limit each IP to 100 requests per windowMs
        message: "Too many requests from this IP, please try again after 15 minutes",
        standardHeaders: true, // Return rate limit info in headers
        legacyHeaders: false, // Disable old headers
      })
    : (req, res, next) => next(); // No rate limiting in development

module.exports = limiter;
