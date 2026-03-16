// Import Express to create router
const express = require("express");
const router = express.Router();

// Import authentication middlewares
// auth: Checks if user is logged in (required for protected routes)
// optionalAuth: Checks if user is logged in but doesn't fail if not (for public routes with optional user-specific features)
// adminAuth: Checks if user is an admin
const auth = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const adminAuth = require("../middlewares/adminAuth");

// Import testimony-specific middlewares
// These handle validation, authorization, and rate limiting for testimony routes
const {
  validateCreateTestimony,
  validateUpdateTestimony,
  validateTestimonyId,
  validateTestimonyQuery,
  requireOwnershipOrAdmin,
  checkExistingTestimony,
  testimonyCreationLimiter,
  testimonyGeneralLimiter,
  logTestimonyAction,
} = require("../middlewares/testimonyMiddleware");

// Import testimony controller functions
// These handle the business logic for each route
const {
  createTestimony,
  getTestimonies,
  getFeaturedTestimonies,
  getTestimonyById,
  getMyTestimony,
  updateTestimony,
  deleteTestimony,
  getPendingTestimonies,
  getPendingCount,
  approveTestimony,
  rejectTestimony,
  toggleFeatured,
  updateDisplayOrder,
  getAllTestimonies,
} = require("../controllers/testimony");

/**
 * PUBLIC ROUTES
 * These routes are accessible to everyone (no authentication required)
 * However, some may return different data based on whether user is logged in
 */

// GET /testimonies - Get all approved testimonies (public view)
// Query params: page, limit, isFeatured, sortBy, sortOrder
// Example: GET /testimonies?page=1&limit=10&isFeatured=true&sortBy=rating&sortOrder=desc
router.get(
  "/",
  testimonyGeneralLimiter, // Rate limiting to prevent abuse
  validateTestimonyQuery, // Validate query parameters (page, limit, etc.)
  logTestimonyAction("GET_TESTIMONIES"), // Log the action for debugging
  getTestimonies // Controller function
);

// GET /testimonies/featured - Get only featured testimonies
// Used on homepage to display highlighted testimonies
// Query params: limit (default: 6)
// Example: GET /testimonies/featured?limit=3
router.get(
  "/featured",
  testimonyGeneralLimiter,
  logTestimonyAction("GET_FEATURED"),
  getFeaturedTestimonies
);

// GET /testimonies/:testimonyId - Get a single testimony by ID
// optionalAuth: Allows both authenticated and non-authenticated access
// Non-admins can only see approved testimonies
// Example: GET /testimonies/507f1f77bcf86cd799439011
router.get(
  "/:testimonyId",
  optionalAuth, // User can be logged in or not
  testimonyGeneralLimiter,
  validateTestimonyId, // Validate MongoDB ObjectId format
  logTestimonyAction("GET_TESTIMONY_BY_ID"),
  getTestimonyById
);

/**
 * AUTHENTICATED USER ROUTES
 * These routes require the user to be logged in
 */

// GET /testimonies/my/own - Get the authenticated user's testimony
// Returns the user's own testimony regardless of approval status
// This allows users to see their pending testimony
// Note: This route MUST come before /:testimonyId to avoid route conflict
router.get(
  "/my/own",
  auth, // User must be logged in
  testimonyGeneralLimiter,
  logTestimonyAction("GET_MY_TESTIMONY"),
  getMyTestimony
);

// POST /testimonies - Create a new testimony
// User must be logged in and not have an existing testimony
// Testimony will be pending approval by admin after creation
router.post(
  "/",
  auth, // User must be logged in
  testimonyCreationLimiter, // Strict rate limiting (3 per hour)
  validateCreateTestimony, // Validate request body (content, rating, userTitle)
  checkExistingTestimony, // Ensure user doesn't already have a testimony
  logTestimonyAction("CREATE_TESTIMONY"),
  createTestimony
);

/**
 * ADMIN ROUTES
 * These routes are only accessible to users with admin role
 * Used for testimony management and moderation
 */

// PATCH /testimonies/:testimonyId - Update a testimony (ADMIN ONLY)
// Only admins can edit testimonies after submission
// Users can only create testimonies, not edit them
router.patch(
  "/:testimonyId",
  auth, // User must be logged in
  adminAuth, // User must be admin
  testimonyGeneralLimiter,
  validateTestimonyId, // Validate testimony ID
  validateUpdateTestimony, // Validate update fields (content, rating, userTitle)
  logTestimonyAction("ADMIN_UPDATE_TESTIMONY"),
  updateTestimony
);

// DELETE /testimonies/:testimonyId - Delete a testimony (ADMIN ONLY)
// Only admins can delete testimonies
// This is a soft delete (marks as deleted, doesn't remove from database)
router.delete(
  "/:testimonyId",
  auth, // User must be logged in
  adminAuth, // User must be admin
  testimonyGeneralLimiter,
  validateTestimonyId, // Validate testimony ID
  logTestimonyAction("ADMIN_DELETE_TESTIMONY"),
  deleteTestimony
);

/**
 * ADMIN ROUTES
 * These routes are only accessible to users with admin role
 * Used for testimony management and moderation
 */

// GET /testimonies/admin/all - Get all testimonies (including pending and deleted)
// Query params: page, limit, isApproved, isFeatured, isDeleted, sortBy, sortOrder
// Example: GET /testimonies/admin/all?isApproved=false&page=1
router.get(
  "/admin/all",
  auth, // User must be logged in
  adminAuth, // User must be admin
  validateTestimonyQuery, // Validate query parameters
  logTestimonyAction("ADMIN_GET_ALL"),
  getAllTestimonies
);

// GET /testimonies/admin/pending/count - Get count of pending testimonies
// Returns just the count of pending testimonies for badge notifications
// Used by frontend to show badge on Admin menu and Testimony menu
// MUST come before /admin/pending to avoid being caught by that route
router.get(
  "/admin/pending/count",
  auth,
  adminAuth,
  logTestimonyAction("ADMIN_GET_PENDING_COUNT"),
  getPendingCount
);

// GET /testimonies/admin/pending - Get testimonies awaiting approval
// Returns only testimonies with isApproved=false and isDeleted=false
// Query params: page, limit
router.get(
  "/admin/pending",
  auth,
  adminAuth,
  logTestimonyAction("ADMIN_GET_PENDING"),
  getPendingTestimonies
);

// PATCH /testimonies/admin/:testimonyId/approve - Approve a testimony
// Makes the testimony visible to the public
// Sends email notification to the user
router.patch(
  "/admin/:testimonyId/approve",
  auth,
  adminAuth,
  validateTestimonyId, // Validate testimony ID
  logTestimonyAction("ADMIN_APPROVE"),
  approveTestimony
);

// PATCH /testimonies/admin/:testimonyId/reject - Reject a testimony
// Soft deletes the testimony
// Optionally sends email to user with rejection reason
// Body: { reason: "optional reason for rejection" }
router.patch(
  "/admin/:testimonyId/reject",
  auth,
  adminAuth,
  validateTestimonyId, // Validate testimony ID
  logTestimonyAction("ADMIN_REJECT"),
  rejectTestimony
);

// PATCH /testimonies/admin/:testimonyId/feature - Toggle featured status
// Featured testimonies are highlighted on the homepage
// Testimony must be approved to be featured
router.patch(
  "/admin/:testimonyId/feature",
  auth,
  adminAuth,
  validateTestimonyId, // Validate testimony ID
  logTestimonyAction("ADMIN_TOGGLE_FEATURED"),
  toggleFeatured
);

// PATCH /testimonies/admin/:testimonyId/order - Update display order
// Controls the order testimonies appear when sorted by displayOrder
// Lower numbers appear first
// Body: { displayOrder: number }
router.patch(
  "/admin/:testimonyId/order",
  auth,
  adminAuth,
  validateTestimonyId, // Validate testimony ID
  logTestimonyAction("ADMIN_UPDATE_ORDER"),
  updateDisplayOrder
);

/**
 * ROUTE ORDER EXPLANATION:
 *
 * Routes are matched in the order they're defined. More specific routes must come first.
 *
 * Order matters:
 * 1. /featured - Specific literal path, must come before /:testimonyId
 * 2. /my/own - Specific literal path, must come before /:testimonyId
 * 3. /admin/* - All admin routes with specific paths
 * 4. /:testimonyId - Catches any other ID (must be last)
 *
 * If /:testimonyId came first, requests to /featured would match the :testimonyId parameter
 * and try to find a testimony with ID "featured", which would fail.
 */

/**
 * MIDDLEWARE CHAINING EXPLANATION:
 *
 * Middlewares are executed left-to-right. Each middleware can:
 * 1. Pass control to next middleware: next()
 * 2. End the request: res.json() / res.send()
 * 3. Pass an error: next(error)
 *
 * Example chain for POST /testimonies:
 * 1. auth: Verify JWT token, attach user to req.user
 * 2. testimonyCreationLimiter: Check rate limit (3 per hour)
 * 3. validateCreateTestimony: Validate request body with Joi
 * 4. checkExistingTestimony: Ensure user doesn't have testimony
 * 5. logTestimonyAction: Log the action
 * 6. createTestimony: Controller handles business logic
 *
 * If any middleware calls next(error), the error handler catches it
 * and no subsequent middlewares execute.
 */

/**
 * ERROR HANDLING:
 *
 * When a middleware throws an error or calls next(error):
 * - Express skips remaining middlewares in the chain
 * - Error is passed to error handling middleware (in app.js)
 * - Error handler sends appropriate HTTP response
 *
 * Custom errors (BadRequestError, NotFoundError, etc.) set status codes:
 * - BadRequestError: 400
 * - UnauthorizedError: 401
 * - ForbiddenError: 403
 * - NotFoundError: 404
 *
 * Example:
 * If validateCreateTestimony finds invalid data, it throws BadRequestError,
 * Express sends 400 response, and createTestimony never executes.
 */

// Export the router to be used in routes/index.js
module.exports = router;
