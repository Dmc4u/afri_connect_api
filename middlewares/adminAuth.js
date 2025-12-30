/**
 * Admin Authorization Middleware
 * Verifies that the authenticated user has admin role
 */

const { ForbiddenError } = require("../utils/errors");

module.exports = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  if (req.user.role !== "admin") {
    return next(new ForbiddenError("Admin access required"));
  }

  console.log('[AdminAuth] ✅ Admin access granted:', req.user.email);
  next();
};
