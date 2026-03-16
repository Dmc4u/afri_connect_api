// Import the Testimony model to interact with the testimonies collection
const Testimony = require("../models/Testimony");

// Import the User model to get user details
const User = require("../models/User");

// Import custom error classes for consistent error handling
// These classes set the appropriate HTTP status codes and messages
const BadRequestError = require("../utils/errors/BadRequestError");
const NotFoundError = require("../utils/errors/NotFoundError");
const ForbiddenError = require("../utils/errors/ForbiddenError");

// Import notification system to notify admins of new testimonies
const { sendEmail } = require("../utils/notifications");

/**
 * CREATE A NEW TESTIMONY
 * POST /testimonies
 * Authenticated users can submit a testimony with content, rating, and optional title
 */
exports.createTestimony = async (req, res, next) => {
  try {
    // Extract data from request body
    // The validation middleware has already checked these are valid
    const { content, rating, userTitle } = req.body;

    // Get the authenticated user's information from req.user (set by auth middleware)
    const userId = req.user._id;
    const userName = req.user.name || "Anonymous User";
    const userImage = req.user.profileImage || null;

    console.log("[CreateTestimony] User submitting testimony:", {
      userId,
      userName,
      rating,
    });

    // Check if user already has a testimony (prevent duplicates)
    // This is an extra layer of protection in case checkExistingTestimony middleware is not used
    const existingTestimony = await Testimony.findOne({
      user: userId,
      isDeleted: false, // Only count non-deleted testimonies
    });

    if (existingTestimony) {
      console.log("[CreateTestimony] ❌ User already has testimony");
      throw new BadRequestError(
        "You have already submitted a testimony. You can edit your existing testimony instead."
      );
    }

    // Create the new testimony document
    const testimony = await Testimony.create({
      user: userId, // Reference to User who created it
      content, // The testimony text
      rating, // Star rating (1-5)
      userName, // Store user's name for quick display
      userImage, // Store profile image URL
      userTitle: userTitle || "", // User's company/title (optional)
      isApproved: false, // Starts as unapproved - admin needs to review
      isFeatured: false, // Not featured by default
      displayOrder: 0, // Default display order
    });

    console.log("[CreateTestimony] ✅ Testimony created:", testimony._id);

    // Send email notification to admins about new testimony (non-blocking)
    // We wrap this in try-catch so if email fails, the testimony is still created
    try {
      // Find all admin users to notify them
      const admins = await User.find({ role: "admin" }).select("email name");

      // Send email to each admin
      for (const admin of admins) {
        await sendEmail({
          to: admin.email,
          subject: "New Testimony Submitted - Pending Approval",
          text: `A new testimony has been submitted by ${userName} and is pending approval.\n\nRating: ${rating}/5\n\nContent: ${content.substring(0, 200)}${content.length > 200 ? "..." : ""}\n\nPlease review and approve in the admin panel.`,
          html: `
            <h2>New Testimony Pending Approval</h2>
            <p>A new testimony has been submitted and is awaiting review.</p>
            <h3>Details:</h3>
            <ul>
              <li><strong>User:</strong> ${userName}</li>
              <li><strong>Rating:</strong> ${rating}/5 ⭐</li>
              <li><strong>Title:</strong> ${userTitle || "N/A"}</li>
            </ul>
            <h3>Content:</h3>
            <p>${content}</p>
            <p><a href="${process.env.FRONTEND_URL}/admin/testimonies">Review in Admin Panel</a></p>
          `,
        });
      }

      console.log("[CreateTestimony] ✅ Admin notifications sent");
    } catch (emailError) {
      // Log the error but don't fail the request
      // The testimony was created successfully even if email failed
      console.warn("[CreateTestimony] ⚠️ Failed to send admin notification:", emailError.message);
    }

    // Return success response with the created testimony
    // We populate the user field to include user details in the response
    const populatedTestimony = await Testimony.findById(testimony._id).populate(
      "user",
      "name email profileImage tier"
    );

    res.status(201).json({
      success: true,
      message: "Testimony submitted successfully. It will be visible after admin approval.",
      data: populatedTestimony,
    });
  } catch (error) {
    // Pass any errors to the error handling middleware
    console.error("[CreateTestimony] Error:", error.message);
    next(error);
  }
};

/**
 * GET ALL TESTIMONIES (PUBLIC)
 * GET /testimonies
 * Returns approved testimonies with pagination and filtering
 * No authentication required for public viewing
 */
exports.getTestimonies = async (req, res, next) => {
  try {
    // Extract query parameters with defaults
    const {
      page = 1, // Which page to return
      limit = 10, // How many per page
      isFeatured, // Filter by featured status (optional)
      sortBy = "createdAt", // Field to sort by
      sortOrder = "desc", // Sort direction (asc/desc)
    } = req.query;

    // Calculate how many documents to skip for pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build the query filter
    const filter = {
      isApproved: true, // Only show approved testimonies
      isDeleted: false, // Don't show deleted testimonies
    };

    // If isFeatured parameter is provided, add it to filter
    if (isFeatured !== undefined) {
      filter.isFeatured = isFeatured === "true";
    }

    console.log("[GetTestimonies] Fetching with filter:", filter);

    // Build sort object
    // If sorting by displayOrder, secondary sort by createdAt
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    if (sortBy === "displayOrder") {
      sort.createdAt = -1; // Secondary sort by newest first
    }

    // Execute the database query
    const testimonies = await Testimony.find(filter)
      .populate("user", "name email profileImage tier") // Include user details
      .sort(sort) // Apply sorting
      .skip(skip) // Skip for pagination
      .limit(parseInt(limit)) // Limit results
      .lean(); // Convert to plain JavaScript objects (faster)

    // Get total count for pagination metadata
    const total = await Testimony.countDocuments(filter);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / parseInt(limit));
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    console.log("[GetTestimonies] ✅ Found", testimonies.length, "testimonies");

    // Return paginated response
    res.status(200).json({
      success: true,
      data: testimonies,
      pagination: {
        total, // Total number of testimonies matching filter
        page: parseInt(page), // Current page
        limit: parseInt(limit), // Items per page
        totalPages, // Total number of pages
        hasNextPage, // Whether there's a next page
        hasPrevPage, // Whether there's a previous page
      },
    });
  } catch (error) {
    console.error("[GetTestimonies] Error:", error.message);
    next(error);
  }
};

/**
 * GET FEATURED TESTIMONIES
 * GET /testimonies/featured
 * Returns only featured and approved testimonies
 * Useful for homepage display
 */
exports.getFeaturedTestimonies = async (req, res, next) => {
  try {
    const { limit = 6 } = req.query; // Default to 6 featured testimonies

    console.log("[GetFeatured] Fetching featured testimonies");

    // Use the static method from the model
    const testimonies = await Testimony.getFeatured();

    // Apply limit if more results than requested
    const limitedTestimonies = testimonies.slice(0, parseInt(limit));

    console.log("[GetFeatured] ✅ Found", limitedTestimonies.length, "featured testimonies");

    res.status(200).json({
      success: true,
      data: limitedTestimonies,
      count: limitedTestimonies.length,
    });
  } catch (error) {
    console.error("[GetFeatured] Error:", error.message);
    next(error);
  }
};

/**
 * GET SINGLE TESTIMONY BY ID
 * GET /testimonies/:testimonyId
 * Returns a specific testimony by its ID
 * Only approved testimonies are accessible to non-admins
 */
exports.getTestimonyById = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;

    console.log("[GetTestimonyById] Fetching testimony:", testimonyId);

    // Find the testimony and populate user details
    const testimony = await Testimony.findById(testimonyId).populate(
      "user",
      "name email profileImage tier"
    );

    // Check if testimony exists
    if (!testimony || testimony.isDeleted) {
      console.log("[GetTestimonyById] ❌ Testimony not found");
      throw new NotFoundError("Testimony not found");
    }

    // If user is not admin and testimony is not approved, deny access
    const isAdmin = req.user && req.user.role === "admin";
    const isOwner = req.user && testimony.user._id.toString() === req.user._id.toString();

    if (!testimony.isApproved && !isAdmin && !isOwner) {
      console.log("[GetTestimonyById] ❌ Testimony not approved");
      throw new NotFoundError("Testimony not found");
    }

    console.log("[GetTestimonyById] ✅ Testimony found");

    res.status(200).json({
      success: true,
      data: testimony,
    });
  } catch (error) {
    console.error("[GetTestimonyById] Error:", error.message);
    next(error);
  }
};

/**
 * GET MY TESTIMONY
 * GET /testimonies/my
 * Returns the authenticated user's testimony (if they have one)
 */
exports.getMyTestimony = async (req, res, next) => {
  try {
    const userId = req.user._id;

    console.log("[GetMyTestimony] Fetching testimony for user:", userId);

    // Find the user's testimony (including non-approved ones)
    const testimony = await Testimony.findOne({
      user: userId,
      isDeleted: false,
    }).populate("user", "name email profileImage tier");

    if (!testimony) {
      console.log("[GetMyTestimony] ❌ No testimony found for user");
      return res.status(200).json({
        success: true,
        data: null,
        message: "You haven't submitted a testimony yet",
      });
    }

    console.log("[GetMyTestimony] ✅ Testimony found");

    res.status(200).json({
      success: true,
      data: testimony,
    });
  } catch (error) {
    console.error("[GetMyTestimony] Error:", error.message);
    next(error);
  }
};

/**
 * UPDATE TESTIMONY
 * PATCH /testimonies/:testimonyId
 * Allows user to update their own testimony (or admin to update any)
 * Only content, rating, and userTitle can be updated
 */
exports.updateTestimony = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;
    const { content, rating, userTitle } = req.body;

    console.log("[UpdateTestimony] Updating testimony:", testimonyId);

    // Find the testimony
    // The requireOwnershipOrAdmin middleware should have already attached it to req.testimony
    let testimony = req.testimony;

    // If not attached, fetch it
    if (!testimony) {
      testimony = await Testimony.findById(testimonyId);
      if (!testimony || testimony.isDeleted) {
        throw new NotFoundError("Testimony not found");
      }
    }

    // Check ownership (extra safety check)
    const isOwner = testimony.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      throw new ForbiddenError("You can only update your own testimony");
    }

    // Update fields if provided
    if (content !== undefined) {
      testimony.content = content;
      console.log("[UpdateTestimony] Updated content");
    }
    if (rating !== undefined) {
      testimony.rating = rating;
      console.log("[UpdateTestimony] Updated rating to", rating);
    }
    if (userTitle !== undefined) {
      testimony.userTitle = userTitle;
      console.log("[UpdateTestimony] Updated userTitle");
    }

    // If user edits their testimony after it was approved, reset approval status
    // This ensures admin reviews the updated content
    if (testimony.isApproved && !isAdmin) {
      testimony.isApproved = false;
      testimony.approvedAt = null;
      testimony.approvedBy = null;
      console.log("[UpdateTestimony] Reset approval status - requires re-review");
    }

    // Save the updated testimony
    await testimony.save();

    // Populate user details for response
    const updatedTestimony = await Testimony.findById(testimonyId).populate(
      "user",
      "name email profileImage tier"
    );

    console.log("[UpdateTestimony] ✅ Testimony updated successfully");

    res.status(200).json({
      success: true,
      message: isAdmin
        ? "Testimony updated successfully"
        : "Testimony updated successfully. It will need admin approval again.",
      data: updatedTestimony,
    });
  } catch (error) {
    console.error("[UpdateTestimony] Error:", error.message);
    next(error);
  }
};

/**
 * DELETE TESTIMONY (SOFT DELETE)
 * DELETE /testimonies/:testimonyId
 * Soft deletes a testimony (marks as deleted without removing from database)
 * User can delete their own testimony, admin can delete any
 */
exports.deleteTestimony = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;

    console.log("[DeleteTestimony] Deleting testimony:", testimonyId);

    // Get testimony (should be attached by middleware)
    let testimony = req.testimony;
    if (!testimony) {
      testimony = await Testimony.findById(testimonyId);
      if (!testimony || testimony.isDeleted) {
        throw new NotFoundError("Testimony not found");
      }
    }

    // Check ownership
    const isOwner = testimony.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";

    if (!isOwner && !isAdmin) {
      throw new ForbiddenError("You can only delete your own testimony");
    }

    // Soft delete using the model method
    await testimony.softDelete();

    console.log("[DeleteTestimony] ✅ Testimony soft deleted");

    res.status(200).json({
      success: true,
      message: "Testimony deleted successfully",
    });
  } catch (error) {
    console.error("[DeleteTestimony] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: GET PENDING TESTIMONIES
 * GET /admin/testimonies/pending
 * Returns all testimonies awaiting admin approval
 * Admin only
 */
exports.getPendingTestimonies = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log("[GetPending] Admin fetching pending testimonies");

    // Use the static method from the model
    const testimonies = await Testimony.getPending();

    // Apply pagination manually since static method doesn't have pagination
    const paginatedTestimonies = testimonies.slice(skip, skip + parseInt(limit));
    const total = testimonies.length;

    console.log("[GetPending] ✅ Found", total, "pending testimonies");

    res.status(200).json({
      success: true,
      data: paginatedTestimonies,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[GetPending] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: APPROVE TESTIMONY
 * PATCH /admin/testimonies/:testimonyId/approve
 * Approves a testimony, making it visible to the public
 * Admin only
 */
exports.approveTestimony = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;
    const adminId = req.user._id;

    console.log("[ApproveTestimony] Admin approving testimony:", testimonyId);

    // Find the testimony
    const testimony = await Testimony.findById(testimonyId);

    if (!testimony || testimony.isDeleted) {
      throw new NotFoundError("Testimony not found");
    }

    // Use the model's approve method
    await testimony.approve(adminId);

    console.log("[ApproveTestimony] ✅ Testimony approved");

    // Notify the user that their testimony was approved (non-blocking)
    try {
      const user = await User.findById(testimony.user).select("email name");
      if (user) {
        await sendEmail({
          to: user.email,
          subject: "Your Testimony Has Been Approved! 🎉",
          text: `Good news! Your testimony has been approved and is now visible on AfriOnet.\n\nThank you for sharing your experience with us!`,
          html: `
            <h2>Your Testimony Has Been Approved! 🎉</h2>
            <p>Good news, ${user.name}!</p>
            <p>Your testimony has been reviewed and approved. It is now visible to all visitors on AfriOnet.</p>
            <p>Thank you for sharing your experience with us!</p>
            <p><a href="${process.env.FRONTEND_URL}/testimonies">View All Testimonies</a></p>
          `,
        });
        console.log("[ApproveTestimony] ✅ User notification sent");
      }
    } catch (emailError) {
      console.warn("[ApproveTestimony] ⚠️ Failed to send user notification:", emailError.message);
    }

    // Return updated testimony
    const updatedTestimony = await Testimony.findById(testimonyId).populate(
      "user",
      "name email profileImage tier"
    );

    res.status(200).json({
      success: true,
      message: "Testimony approved successfully",
      data: updatedTestimony,
    });
  } catch (error) {
    console.error("[ApproveTestimony] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: REJECT TESTIMONY
 * PATCH /admin/testimonies/:testimonyId/reject
 * Rejects a testimony by soft deleting it
 * Admin only
 */
exports.rejectTestimony = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;
    const { reason } = req.body; // Optional reason for rejection

    console.log("[RejectTestimony] Admin rejecting testimony:", testimonyId);

    // Find the testimony
    const testimony = await Testimony.findById(testimonyId);

    if (!testimony || testimony.isDeleted) {
      throw new NotFoundError("Testimony not found");
    }

    // Soft delete the testimony
    await testimony.softDelete();

    console.log("[RejectTestimony] ✅ Testimony rejected");

    // Notify the user (optional, with reason)
    try {
      const user = await User.findById(testimony.user).select("email name");
      if (user) {
        await sendEmail({
          to: user.email,
          subject: "Testimony Not Approved",
          text: `We're sorry, but your testimony could not be approved at this time.${reason ? `\n\nReason: ${reason}` : ""}\n\nIf you have questions, please contact our support team.`,
          html: `
            <h2>Testimony Status Update</h2>
            <p>Dear ${user.name},</p>
            <p>We're sorry, but your testimony could not be approved at this time.</p>
            ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
            <p>If you have questions or would like to discuss this decision, please contact our support team.</p>
          `,
        });
        console.log("[RejectTestimony] ✅ User notification sent");
      }
    } catch (emailError) {
      console.warn("[RejectTestimony] ⚠️ Failed to send user notification:", emailError.message);
    }

    res.status(200).json({
      success: true,
      message: "Testimony rejected successfully",
    });
  } catch (error) {
    console.error("[RejectTestimony] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: TOGGLE FEATURED STATUS
 * PATCH /admin/testimonies/:testimonyId/feature
 * Toggles whether a testimony is featured (highlighted on homepage)
 * Admin only
 */
exports.toggleFeatured = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;

    console.log("[ToggleFeatured] Toggling featured status for:", testimonyId);

    // Find the testimony
    const testimony = await Testimony.findById(testimonyId);

    if (!testimony || testimony.isDeleted) {
      throw new NotFoundError("Testimony not found");
    }

    // Testimony must be approved to be featured
    if (!testimony.isApproved) {
      throw new BadRequestError("Only approved testimonies can be featured");
    }

    // Toggle featured status
    testimony.isFeatured = !testimony.isFeatured;
    await testimony.save();

    console.log("[ToggleFeatured] ✅ Featured status:", testimony.isFeatured);

    // Return updated testimony
    const updatedTestimony = await Testimony.findById(testimonyId).populate(
      "user",
      "name email profileImage tier"
    );

    res.status(200).json({
      success: true,
      message: testimony.isFeatured
        ? "Testimony featured successfully"
        : "Testimony unfeatured successfully",
      data: updatedTestimony,
    });
  } catch (error) {
    console.error("[ToggleFeatured] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: UPDATE DISPLAY ORDER
 * PATCH /admin/testimonies/:testimonyId/order
 * Updates the display order for manual sorting
 * Lower numbers appear first
 * Admin only
 */
exports.updateDisplayOrder = async (req, res, next) => {
  try {
    const { testimonyId } = req.params;
    const { displayOrder } = req.body;

    console.log("[UpdateDisplayOrder] Updating order for:", testimonyId, "to", displayOrder);

    // Validate displayOrder
    if (displayOrder === undefined || typeof displayOrder !== "number") {
      throw new BadRequestError("Display order must be a number");
    }

    // Find and update testimony
    const testimony = await Testimony.findById(testimonyId);

    if (!testimony || testimony.isDeleted) {
      throw new NotFoundError("Testimony not found");
    }

    testimony.displayOrder = displayOrder;
    await testimony.save();

    console.log("[UpdateDisplayOrder] ✅ Display order updated");

    // Return updated testimony
    const updatedTestimony = await Testimony.findById(testimonyId).populate(
      "user",
      "name email profileImage tier"
    );

    res.status(200).json({
      success: true,
      message: "Display order updated successfully",
      data: updatedTestimony,
    });
  } catch (error) {
    console.error("[UpdateDisplayOrder] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: GET ALL TESTIMONIES (INCLUDING NON-APPROVED)
 * GET /admin/testimonies
 * Returns all testimonies with filtering and pagination
 * Admin only - includes pending, rejected, and deleted testimonies
 */
exports.getAllTestimonies = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      isApproved,
      isFeatured,
      isDeleted,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    console.log("[GetAllTestimonies] Admin fetching all testimonies");

    // Build filter
    const filter = {};
    if (isApproved !== undefined) filter.isApproved = isApproved === "true";
    if (isFeatured !== undefined) filter.isFeatured = isFeatured === "true";
    if (isDeleted !== undefined) filter.isDeleted = isDeleted === "true";

    // Build sort
    const sort = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;

    // Fetch testimonies
    const testimonies = await Testimony.find(filter)
      .populate("user", "name email profileImage tier")
      .populate("approvedBy", "name email") // Include admin who approved
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Testimony.countDocuments(filter);

    console.log("[GetAllTestimonies] ✅ Found", testimonies.length, "testimonies");

    res.status(200).json({
      success: true,
      data: testimonies,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("[GetAllTestimonies] Error:", error.message);
    next(error);
  }
};

/**
 * ADMIN: GET PENDING COUNT
 * GET /admin/testimonies/pending/count
 * Returns the count of testimonies awaiting approval
 * Used for badge notifications in the admin interface
 * Admin only
 */
exports.getPendingCount = async (req, res, next) => {
  try {
    console.log("[GetPendingCount] Admin fetching pending testimonies count");

    // Count testimonies that are not approved and not deleted
    const count = await Testimony.countDocuments({
      isApproved: false,
      isDeleted: false,
    });

    console.log("[GetPendingCount] ✅ Found", count, "pending testimonies");

    // Return simple count response
    res.status(200).json({
      success: true,
      count,
    });
  } catch (error) {
    console.error("[GetPendingCount] Error:", error.message);
    next(error);
  }
};

/**
 * SUMMARY:
 * This controller handles all testimony-related operations:
 *
 * PUBLIC ENDPOINTS:
 * - createTestimony: Users submit testimonies (pending approval)
 * - getTestimonies: Get approved testimonies with pagination
 * - getFeaturedTestimonies: Get featured testimonies for homepage
 * - getTestimonyById: Get single testimony
 * - getMyTestimony: Get authenticated user's testimony
 * - updateTestimony: Users update their own testimony
 * - deleteTestimony: Users delete their own testimony
 *
 * ADMIN ENDPOINTS:
 * - getPendingTestimonies: View testimonies awaiting approval
 * - getPendingCount: Get count of pending testimonies (for badges)
 * - approveTestimony: Approve a testimony
 * - rejectTestimony: Reject a testimony
 * - toggleFeatured: Feature/unfeature a testimony
 * - updateDisplayOrder: Manually order testimonies
 * - getAllTestimonies: View all testimonies (including deleted/pending)
 *
 * FEATURES:
 * - Soft delete (data preserved)
 * - Approval workflow (admin review before public display)
 * - Email notifications (to admins and users)
 * - Featured testimonies (for homepage highlighting)
 * - Manual ordering (displayOrder field)
 * - Badge notifications (count display in admin interface)
 * - Comprehensive logging
 */
