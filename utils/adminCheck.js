/**
 * Admin Role Management Utility
 * Centralized logic for determining admin status based on email configuration
 */

const { ADMIN_EMAIL, ADMIN_EMAILS } = require("./config");

// Build an effective admin email list with a sensible fallback
// Prefer the explicit ADMIN_EMAILS list; if empty, include ADMIN_EMAIL
const EFFECTIVE_ADMIN_EMAILS = (() => {
  const list = Array.isArray(ADMIN_EMAILS) ? ADMIN_EMAILS : [];
  const fallback = ADMIN_EMAIL ? [String(ADMIN_EMAIL).toLowerCase()] : [];
  // Use a Set to avoid duplicates if ADMIN_EMAIL is also in ADMIN_EMAILS
  return Array.from(new Set([...list, ...fallback]));
})();

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

module.exports = {
  isAdminEmail,
  getRoleForEmail,
  syncUserRole,
};
