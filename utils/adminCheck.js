/**
 * Admin Role Management Utility
 * Centralized logic for determining admin status based on email configuration
 */

const { ADMIN_EMAILS } = require("./config");

// Admin role assignment must come only from the explicit admin allowlist.
// ADMIN_EMAIL is also used by email delivery config and must not imply app admin access.
const EFFECTIVE_ADMIN_EMAILS = Array.isArray(ADMIN_EMAILS)
  ? Array.from(new Set(ADMIN_EMAILS.map((email) => String(email).toLowerCase())))
  : [];

/**
 * Check if an email is configured as an admin
 * @param {string} email - User email to check
 * @returns {boolean} - True if email is in admin list
 */
const isAdminEmail = (email) => {
  if (!email || !EFFECTIVE_ADMIN_EMAILS || EFFECTIVE_ADMIN_EMAILS.length === 0) {
    return false;
  }
  return EFFECTIVE_ADMIN_EMAILS.includes(email.toLowerCase());
};

/**
 * Determine the appropriate role for a user based on their email
 * @param {string} email - User email
 * @param {string} currentRole - Current role (optional, for validation)
 * @returns {string} - Role: 'admin' or 'user'
 */
const getRoleForEmail = (email, currentRole = null) => {
  if (isAdminEmail(email)) {
    return "admin";
  }
  return currentRole === "admin" && isAdminEmail(email) ? "admin" : "user";
};

/**
 * Update user role based on email configuration
 * Used to keep roles synchronized with ADMIN_EMAILS config
 * @param {Object} user - Mongoose user object
 * @returns {Object} - Updated user object
 */
const syncUserRole = async (user) => {
  const expectedRole = isAdminEmail(user.email) ? "admin" : "user";

  if (user.role !== expectedRole) {
    user.role = expectedRole;
    await user.save();
    console.log(`[Admin Sync] Updated ${user.email} role to ${expectedRole}`);
  }

  return user;
};

/**
 * Express middleware to check if authenticated user is an admin
 * Must be used after auth middleware
 */
const adminCheckMiddleware = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
};

module.exports = {
  isAdminEmail,
  getRoleForEmail,
  syncUserRole,
  adminCheckMiddleware,
};

// Default export for backward compatibility
module.exports.default = adminCheckMiddleware;
