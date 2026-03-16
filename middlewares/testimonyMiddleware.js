// Import Joi for validation and celebrate for Express integration
// Joi: A powerful schema description and data validation library
// celebrate: Connects Joi validation to Express middleware
const { Joi, celebrate } = require("celebrate");

// Import rate limiting to prevent abuse
const rateLimit = require("express-rate-limit");

// Import custom error classes for consistent error handling
const { ForbiddenError, NotFoundError, BadRequestError } = require("../utils/errors");

// Import the Testimony model to interact with the database
const Testimony = require("../models/Testimony");

/**
 * VALIDATION MIDDLEWARE
 * These middlewares validate incoming request data before it reaches the controller
 * Using Joi schemas ensures data is in the expected format and meets our requirements
 */

// Validate testimony creation request body
// This runs before creating a new testimony
module.exports.validateCreateTestimony = celebrate({
  body: Joi.object().keys({
    // Content: The actual testimony text
    content: Joi.string()
      .required() // Must be provided
      .min(10) // Minimum 10 characters
      .max(1000) // Maximum 1000 characters
      .trim() // Remove leading/trailing whitespace
      .messages({
        "string.empty": "Testimony content is required",
        "string.min": "Testimony must be at least 10 characters",
        "string.max": "Testimony cannot exceed 1000 characters",
      }),

    // Rating: Star rating from 1 to 5
    rating: Joi.number()
      .required()
      .integer() // Must be a whole number
      .min(1) // Minimum rating of 1
      .max(5) // Maximum rating of 5
      .messages({
        "number.base": "Rating must be a number",
        "number.min": "Rating must be at least 1",
        "number.max": "Rating cannot exceed 5",
        "number.integer": "Rating must be a whole number",
      }),

    // User's title/company (optional)
    userTitle: Joi.string()
      .max(100)
      .trim()
      .allow("") // Allow empty string
      .optional() // Not required
      .messages({
        "string.max": "User title cannot exceed 100 characters",
      }),
  }),
});

// Validate testimony update request body
// Similar to create but all fields are optional (user can update what they want)
module.exports.validateUpdateTestimony = celebrate({
  body: Joi.object().keys({
    content: Joi.string()
      .min(10)
      .max(1000)
      .trim()
      .optional() // Not required for update
      .messages({
        "string.min": "Testimony must be at least 10 characters",
        "string.max": "Testimony cannot exceed 1000 characters",
      }),

    rating: Joi.number().integer().min(1).max(5).optional().messages({
      "number.min": "Rating must be at least 1",
      "number.max": "Rating cannot exceed 5",
      "number.integer": "Rating must be a whole number",
    }),

    userTitle: Joi.string().max(100).trim().allow("").optional().messages({
      "string.max": "User title cannot exceed 100 characters",
    }),
  }),
});

// Validate testimony ID parameter in URL routes like /testimonies/:testimonyId
module.exports.validateTestimonyId = celebrate({
  params: Joi.object().keys({
    // testimonyId must be a valid MongoDB ObjectId
    testimonyId: Joi.string()
      .required()
      .pattern(/^[0-9a-fA-F]{24}$/) // MongoDB ObjectId format: 24 hex characters
      .messages({
        "string.pattern.base": "Invalid testimony ID format",
        "string.empty": "Testimony ID is required",
      }),
  }),
});

// Validate query parameters for listing testimonies (e.g., /testimonies?limit=10&page=1)
module.exports.validateTestimonyQuery = celebrate({
  query: Joi.object().keys({
    // Limit: How many testimonies to return
    limit: Joi.number()
      .integer()
      .min(1)
      .max(100) // Prevent requesting too many at once
      .optional()
      .default(10)
      .messages({
        "number.min": "Limit must be at least 1",
        "number.max": "Limit cannot exceed 100",
      }),

    // Page: For pagination (which page of results to return)
    page: Joi.number().integer().min(1).optional().default(1).messages({
      "number.min": "Page must be at least 1",
    }),

    // Filter by approval status
    isApproved: Joi.boolean().optional(),

    // Filter by featured status
    isFeatured: Joi.boolean().optional(),

    // Sort field (which field to sort by)
    sortBy: Joi.string()
      .valid("createdAt", "rating", "displayOrder") // Only allow these fields
      .optional()
      .default("createdAt"),

    // Sort direction (ascending or descending)
    sortOrder: Joi.string()
      .valid("asc", "desc") // Only 'asc' or 'desc' allowed
      .optional()
      .default("desc"),
  }),
});

/**
 * AUTHORIZATION MIDDLEWARE
 * These middlewares check if the user has permission to perform certain actions
 */

// Check if user is authenticated (logged in)
// This should be used with the auth middleware from auth.js
// Just adds an extra layer of clarity for testimony routes
module.exports.requireAuth = (req, res, next) => {
  // The auth middleware should have already set req.user
  if (!req.user) {
    console.log("[TestimonyAuth] ❌ No user found in request");
    return next(new ForbiddenError("Authentication required"));
  }

  console.log("[TestimonyAuth] ✅ User authenticated:", req.user.email);
  next();
};

// Check if user is an admin
// Admins can approve, feature, and delete testimonies
module.exports.requireAdmin = (req, res, next) => {
  // First check if user exists
  if (!req.user) {
    console.log("[TestimonyAdmin] ❌ No user found");
    return next(new ForbiddenError("Authentication required"));
  }

  // Check if user has admin role
  if (req.user.role !== "admin") {
    console.log("[TestimonyAdmin] ❌ User is not admin:", req.user.email);
    return next(new ForbiddenError("Admin access required"));
  }

  console.log("[TestimonyAdmin] ✅ Admin access granted:", req.user.email);
  next();
};

// Check if user owns the testimony or is an admin
// This allows users to edit/delete their own testimonies
module.exports.requireOwnershipOrAdmin = async (req, res, next) => {
  try {
    // Get testimony ID from URL parameters
    const { testimonyId } = req.params;

    // Find the testimony in the database
    const testimony = await Testimony.findById(testimonyId);

    // If testimony doesn't exist, return 404 error
    if (!testimony) {
      console.log("[TestimonyOwnership] ❌ Testimony not found:", testimonyId);
      return next(new NotFoundError("Testimony not found"));
    }

    // If testimony is soft-deleted, treat it as not found
    if (testimony.isDeleted) {
      console.log("[TestimonyOwnership] ❌ Testimony is deleted:", testimonyId);
      return next(new NotFoundError("Testimony not found"));
    }

    // Check if user is the testimony owner OR an admin
    const isOwner = testimony.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      console.log("[TestimonyOwnership] ❌ Access denied for user:", req.user.email);
      return next(new ForbiddenError("You can only modify your own testimonies"));
    }

    console.log("[TestimonyOwnership] ✅ Access granted:", {
      user: req.user.email,
      isOwner,
      isAdmin,
    });

    // Attach testimony to request object so controller doesn't need to fetch it again
    req.testimony = testimony;
    next();
  } catch (error) {
    console.error("[TestimonyOwnership] Error:", error.message);
    return next(error);
  }
};

// Check if user already has a testimony
// Prevents users from submitting multiple testimonies (if that's desired behavior)
module.exports.checkExistingTestimony = async (req, res, next) => {
  try {
    // Look for an existing testimony by this user that's not deleted
    const existingTestimony = await Testimony.findOne({
      user: req.user._id,
      isDeleted: false,
    });

    // If user already has a testimony, don't allow creating another one
    if (existingTestimony) {
      console.log("[TestimonyCheck] ❌ User already has testimony:", req.user.email);
      return next(
        new BadRequestError("You have already submitted a testimony. Thank you for your feedback!")
      );
    }

    console.log("[TestimonyCheck] ✅ No existing testimony for user:", req.user.email);
    next();
  } catch (error) {
    console.error("[TestimonyCheck] Error:", error.message);
    return next(error);
  }
};

/**
 * RATE LIMITING MIDDLEWARE
 * Prevents abuse by limiting how often users can perform certain actions
 */

// Rate limiter for creating testimonies
// Limits to 3 testimony submissions per hour per IP address
// This prevents spam even if checkExistingTestimony is removed
module.exports.testimonyCreationLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour time window
        max: 3, // Maximum 3 requests per window
        message: "Too many testimony submissions. Please try again later.",
        standardHeaders: true, // Return rate limit info in headers
        legacyHeaders: false, // Disable legacy X-RateLimit-* headers
        // Log when rate limit is hit
        handler: (req, res) => {
          console.log("[TestimonyRateLimit] ⚠️ Rate limit exceeded for IP:", req.ip);
          res.status(429).json({
            success: false,
            message: "Too many testimony submissions. Please try again later.",
          });
        },
      })
    : // In development, skip rate limiting for easier testing
      (req, res, next) => {
        console.log("[TestimonyRateLimit] 🔧 Development mode - rate limiting disabled");
        next();
      };

// Rate limiter for general testimony operations (viewing, listing)
// More lenient than creation limiter
module.exports.testimonyGeneralLimiter =
  process.env.NODE_ENV === "production"
    ? rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 200, // Maximum 200 requests per 15 minutes
        message: "Too many requests. Please try again later.",
        standardHeaders: true,
        legacyHeaders: false,
      })
    : (req, res, next) => next(); // Skip in development

/**
 * UTILITY MIDDLEWARE
 * Helper middlewares for common tasks
 */

// Fetch testimony by ID and attach to request
// This is useful for routes that need the testimony object
module.exports.fetchTestimony = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;

    // Find testimony and populate user details
    const testimony = await Testimony.findById(testimonyId).populate(
      "user",
      "name email profileImage"
    );

    // If not found or deleted, return 404
    if (!testimony || testimony.isDeleted) {
      console.log("[FetchTestimony] ❌ Testimony not found:", testimonyId);
      return next(new NotFoundError("Testimony not found"));
    }

    console.log("[FetchTestimony] ✅ Testimony found:", testimonyId);

    // Attach to request for use in controller
    req.testimony = testimony;
    next();
  } catch (error) {
    console.error("[FetchTestimony] Error:", error.message);
    return next(error);
  }
};

// Verify testimony is approved (for public viewing)
// Only approved testimonies should be visible to non-admin users
module.exports.requireApproved = (req, res, next) => {
  // req.testimony should be set by fetchTestimony middleware
  if (!req.testimony) {
    return next(new NotFoundError("Testimony not found"));
  }

  // If user is admin, skip approval check
  if (req.user && req.user.role === "admin") {
    console.log("[RequireApproved] ✅ Admin bypass");
    return next();
  }

  // Check if testimony is approved
  if (!req.testimony.isApproved) {
    console.log("[RequireApproved] ❌ Testimony not approved:", req.testimony._id);
    return next(new NotFoundError("Testimony not found"));
  }

  console.log("[RequireApproved] ✅ Testimony is approved:", req.testimony._id);
  next();
};

// Log testimony actions for debugging and audit trail
module.exports.logTestimonyAction = (action) => {
  return (req, res, next) => {
    console.log(`[TestimonyAction] ${action}:`, {
      user: req.user?.email || "anonymous",
      testimonyId: req.params?.testimonyId || "N/A",
      timestamp: new Date().toISOString(),
    });
    next();
  };
};

/**
 * SUMMARY:
 * This middleware file provides:
 * 1. Validation - Ensures data is in correct format using Joi
 * 2. Authorization - Checks if user has permission for actions
 * 3. Rate Limiting - Prevents abuse and spam
 * 4. Utilities - Helper functions to fetch and verify testimonies
 *
 * Usage in routes:
 * - Chain middlewares in order: validation → auth → rate limit → controller
 * - Example: router.post('/', validateCreateTestimony, requireAuth, testimonyCreationLimiter, controller.create)
 */
