const Listing = require("../models/Listing");
const User = require("../models/User");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");
const { TALENT_CATEGORIES, isTalentCategory } = require("../utils/categories");
const path = require("path");
const fs = require("fs").promises;
const gcs = require("../utils/gcs");

// --- Slug helpers (mirror model logic) ---
function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function generateUniqueSlug(base, currentId) {
  if (!base) base = "listing";
  let candidate = base;
  let i = 2;
  while (true) {
    const exists = await Listing.findOne({ slug: candidate, _id: { $ne: currentId } })
      .select("_id")
      .lean();
    if (!exists) return candidate;
    candidate = `${base}-${i++}`;
  }
}

// Get all listings (public)
const getAllListings = async (req, res, next) => {
  try {
    const { category, location, search, page = 1, limit = 20, excludeWinners } = req.query;

    // Only return admin-approved listings (status: "active") for public browse
    // Pending listings are only visible to their owners via getMyListings
    const query = { status: "active" };

    if (category && category !== "all") {
      query.category = category;
    }

    if (location) {
      query.location = { $regex: location, $options: "i" };
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Exclude talent showcase contestants ONLY when explicitly requested (for business listings page)
    // Talent directory (/discover-talent) should include all talent contestants
    if (excludeWinners === "true") {
      // Exclude ALL talent categories from business listings page
      query.category = { $nin: TALENT_CATEGORIES };

      // Also exclude listings that are associated with talent showcase contestants
      const TalentContestant = require("../models/TalentContestant");
      const contestantListingIds = await TalentContestant.find({
        listing: { $exists: true, $ne: null },
      })
        .distinct("listing")
        .lean();

      if (contestantListingIds.length > 0) {
        query._id = { $nin: contestantListingIds };
      }
    }

    const skip = (page - 1) * limit;

    let listings = await Listing.find(query)
      .populate("owner", "name email tier role settings")
      .sort({ featured: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Lazy backfill slugs
    const updates = [];
    listings = await Promise.all(
      (listings || []).map(async (l) => {
        if (!l.slug && l.title) {
          try {
            const base = slugify(l.title);
            const slug = await generateUniqueSlug(base, l._id);
            updates.push(Listing.updateOne({ _id: l._id }, { $set: { slug } }).exec());
            return { ...l, slug };
          } catch {
            return l;
          }
        }
        return l;
      })
    );
    // fire-and-forget updates; no await

    const total = await Listing.countDocuments(query);

    res.json({
      success: true,
      listings,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + listings.length < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single listing by ID (public)
const getListingById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if the user is authenticated and is an admin or listing owner
    const isAdmin = req.user && req.user.role === "admin";
    const userId = req.user?._id;

    let listing;

    if (isAdmin) {
      // Admins can view any listing regardless of status
      listing = await Listing.findOne({ _id: id })
        .populate("owner", "name email tier role settings profilePhoto")
        .lean();
    } else {
      // First try to find an active listing
      listing = await Listing.findOne({ _id: id, status: "active" })
        .populate("owner", "name email tier role settings profilePhoto")
        .lean();

      // If not found and user is authenticated, check if they own a pending listing
      if (!listing && userId) {
        listing = await Listing.findOne({ _id: id, owner: userId })
          .populate("owner", "name email tier role settings profilePhoto")
          .lean();
      }
    }

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Lazy backfill slug for this listing if missing
    if (listing && !listing.slug && listing.title) {
      try {
        const base = slugify(listing.title);
        const slug = await generateUniqueSlug(base, listing._id);
        listing.slug = slug;
        Listing.updateOne({ _id: listing._id }, { $set: { slug } }).exec();
      } catch {
        /* noop */
      }
    }

    // Increment views (don't await to avoid slowing response)
    Listing.findByIdAndUpdate(id, { $inc: { views: 1 } }).exec();

    res.json({
      success: true,
      listing,
    });
  } catch (error) {
    next(error);
  }
};

// Get user's own listings (protected)
const getMyListings = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;

    const query = { owner: req.user._id };

    // Return all user's listings (pending, active, suspended) except deleted
    // This allows business users to see their pending listings in "My Listings"
    // Always exclude deleted listings
    query.status = { $ne: "deleted" };

    if (status !== "all") {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    let listings = await Listing.find(query)
      .populate("owner", "name email tier role settings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Lazy backfill slugs for owner's listings
    const updates = [];
    listings = await Promise.all(
      (listings || []).map(async (l) => {
        if (!l.slug && l.title) {
          try {
            const base = slugify(l.title);
            const slug = await generateUniqueSlug(base, l._id);
            updates.push(Listing.updateOne({ _id: l._id }, { $set: { slug } }).exec());
            return { ...l, slug };
          } catch {
            return l;
          }
        }
        return l;
      })
    );

    const total = await Listing.countDocuments(query);

    res.json({
      success: true,
      listings,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + listings.length < total,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Create new listing (protected)
const createListing = async (req, res, next) => {
  try {
    const { title, description, category, location, website, businessHours, phoneNumber, email } =
      req.body;

    // Check user tier for listing limits
    const user = await User.findById(req.user._id);

    // Log tier for debugging
    console.log(`[Listing Creation] User: ${user.email}, Tier: ${user.tier}, Role: ${user.role}`);

    // Admin bypass: Allow admins to create listings at any tier
    const isAdmin = user.role === "admin";

    if (!isAdmin) {
      // Determine if this is a talent or business listing
      const isTalent = isTalentCategory(category);

      // Count business vs talent listings separately
      const allUserListings = await Listing.find({
        owner: req.user._id,
        status: { $ne: "deleted" },
      })
        .select("category")
        .lean();

      const businessCount = allUserListings.filter((l) => !isTalentCategory(l.category)).length;
      const talentCount = allUserListings.filter((l) => isTalentCategory(l.category)).length;

      // Enforce separate limits: Free tier = 4 business + 2 talent
      const userTier = user.tier || "Free";

      // Business listing limits
      const businessLimits = {
        Free: 4,
        Starter: 10,
        Premium: Infinity,
        Pro: Infinity,
      };

      // Talent showcase limits
      const talentLimits = {
        Free: 2,
        Starter: 5,
        Premium: Infinity,
        Pro: Infinity,
      };

      const businessLimit = businessLimits[userTier] ?? 4;
      const talentLimit = talentLimits[userTier] ?? 2;

      console.log(
        `[Listing Creation] User: ${user.email}, Category: ${category}, IsTalent: ${isTalent}, Business: ${businessCount}/${businessLimit}, Talent: ${talentCount}/${talentLimit}`
      );

      // Check appropriate limit based on listing type
      if (isTalent && talentCount >= talentLimit) {
        throw new ForbiddenError(
          `Your ${userTier} tier allows maximum ${
            Number.isFinite(talentLimit) ? talentLimit : "unlimited"
          } talent showcase(s). Upgrade to create more talent showcases.`
        );
      }

      if (!isTalent && businessCount >= businessLimit) {
        throw new ForbiddenError(
          `Your ${userTier} tier allows maximum ${
            Number.isFinite(businessLimit) ? businessLimit : "unlimited"
          } business listing(s). Upgrade to create more listings.`
        );
      }
    }

    const listingData = {
      title,
      description,
      category,
      location,
      website,
      businessHours,
      phoneNumber,
      email,
      owner: req.user._id,
      tier: user.tier || "Free",
      status: isAdmin ? "active" : "pending", // Admins' listings are auto-approved
    };

    // Enforce per-tier media limits and types
    // Business (Free): 15 images, Talent (Free): 10 videos
    // Business (Starter): 20 images, Talent (Starter): 15 videos
    // Premium/Pro: unlimited images and videos
    if (req.files && req.files.length > 0) {
      const isPremiumOrPro = ["Premium", "Pro"].includes(user.tier);
      const isStarter = user.tier === "Starter";
      const isFree = !user.tier || user.tier === "Free";

      // Determine if this is a talent or business listing
      const isTalent = isTalentCategory(category);

      // Count incoming media to enforce caps
      if (!isAdmin) {
        const incomingImages = req.files.filter(
          (f) => f.mimetype && f.mimetype.startsWith("image/")
        ).length;
        const incomingVideos = req.files.filter(
          (f) => f.mimetype && f.mimetype.startsWith("video/")
        ).length;

        // Business listings should only have images (no videos)
        if (!isTalent && incomingVideos > 0) {
          throw new BadRequestError(
            `Business listings can only have images. Videos are only allowed for talent listings.`
          );
        }

        // Business listings (Free tier): 15 images max
        if (isFree && !isTalent && incomingImages > 15) {
          throw new BadRequestError(
            `Your Free tier allows up to 15 image(s) per business listing.`
          );
        }

        // Talent listings (Free tier): 10 videos max
        if (isFree && isTalent && incomingVideos > 10) {
          throw new BadRequestError(`Your Free tier allows up to 10 video(s) per talent listing.`);
        }

        // Business listings (Starter tier): 20 images max
        if (isStarter && !isTalent && incomingImages > 20) {
          throw new BadRequestError(
            `Your Starter tier allows up to 20 image(s) per business listing.`
          );
        }

        // Talent listings (Starter tier): 15 videos max
        if (isStarter && isTalent && incomingVideos > 15) {
          throw new BadRequestError(
            `Your Starter tier allows up to 15 video(s) per talent listing.`
          );
        }
      }

      // Upload files to GCS if enabled, otherwise use local storage
      const uploadPromises = req.files.map(async (file) => {
        let fileUrl = `/uploads/listings/${file.filename}`;

        if (gcs.isGcsEnabled()) {
          const bucketName = gcs.getGcsBucketName();
          const resourceType = file.mimetype.startsWith("image/") ? "image" : "video";
          const objectName = gcs.buildObjectName({
            resourceType,
            purpose: "listing",
            filename: file.originalname,
          });

          const localPath = path.join(__dirname, "..", "uploads", "listings", file.filename);

          try {
            fileUrl = await gcs.uploadFromPath({
              bucketName,
              objectName,
              localPath,
              contentType: file.mimetype,
            });

            // Delete local file after successful GCS upload
            try {
              await fs.unlink(localPath);
            } catch (unlinkErr) {
              console.warn(`⚠️ Could not delete local file ${localPath}:`, unlinkErr.message);
            }
          } catch (gcsErr) {
            console.error(
              `⚠️ GCS upload failed for ${file.filename}, using local storage:`,
              gcsErr.message
            );
          }
        }

        return {
          filename: file.filename,
          originalname: file.originalname,
          name: file.originalname, // Will be customized later via separate upload endpoint
          mimetype: file.mimetype,
          size: file.size,
          url: fileUrl,
          type: file.mimetype.startsWith("image/")
            ? "image"
            : file.mimetype.startsWith("video/")
              ? "video"
              : file.mimetype.startsWith("audio/")
                ? "audio"
                : "document",
          description: "", // Will be added later via separate upload endpoint
        };
      });

      listingData.mediaFiles = await Promise.all(uploadPromises);
    }

    // ✅ VALIDATE MEDIA REQUIREMENTS (Backend validation to prevent API bypass)
    // Enforce media requirements for non-admin users
    if (!isAdmin) {
      const isTalent = isTalentCategory(category);
      const hasMediaFiles = listingData.mediaFiles && listingData.mediaFiles.length > 0;

      if (isTalent) {
        // Talent listings MUST have at least 1 video
        const hasVideo = listingData.mediaFiles?.some(
          (file) => file.type === "video" || file.mimetype?.startsWith("video/")
        );

        if (!hasVideo) {
          throw new BadRequestError(
            "At least one video is required for talent listings. Please upload a video showcasing your talent."
          );
        }
      } else {
        // Business listings MUST have at least 1 image
        const hasImage = listingData.mediaFiles?.some(
          (file) => file.type === "image" || file.mimetype?.startsWith("image/")
        );

        if (!hasImage) {
          throw new BadRequestError(
            "At least one image is required for business listings. Please upload at least one business photo."
          );
        }
      }
    }

    const listing = await Listing.create(listingData);
    await listing.populate("owner", "name email tier role");

    res.status(201).json({
      success: true,
      message: "Listing created successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
};

// Update listing (protected - owner only)
const updateListing = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const listing = await Listing.findById(id);

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Check ownership
    if (listing.owner.toString() !== req.user._id.toString()) {
      throw new ForbiddenError("You can only update your own listings");
    }

    // Remove fields that shouldn't be updated directly
    delete updates.owner;
    delete updates.views;
    delete updates.createdAt;

    const updatedListing = await Listing.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate("owner", "name email tier role");

    res.json({
      success: true,
      message: "Listing updated successfully",
      listing: updatedListing,
    });
  } catch (error) {
    next(error);
  }
};

// Delete listing media (protected - owner only)
const deleteListingMedia = async (req, res, next) => {
  try {
    const { id, mediaId } = req.params;

    const listing = await Listing.findById(id);

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Check ownership
    if (listing.owner.toString() !== req.user._id.toString()) {
      throw new ForbiddenError("You can only modify your own listings");
    }

    const mediaFile = listing.mediaFiles.id(mediaId);
    if (!mediaFile) {
      throw new NotFoundError("Media file not found");
    }

    // Delete physical file
    try {
      const filePath = path.join(__dirname, "..", "uploads", "listings", mediaFile.filename);
      await fs.unlink(filePath);
    } catch (err) {
      console.log("File not found on disk:", err.message);
    }

    // Remove from database
    listing.mediaFiles.pull(mediaId);
    await listing.save();

    res.json({
      success: true,
      message: "Media file deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Delete listing (protected - owner only)
const deleteListing = async (req, res, next) => {
  try {
    const { id } = req.params;

    const listing = await Listing.findById(id);

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Check ownership
    if (listing.owner.toString() !== req.user._id.toString()) {
      throw new ForbiddenError("You can only delete your own listings");
    }

    // Delete associated media files from local storage
    for (const mediaFile of listing.mediaFiles) {
      try {
        const filePath = path.join(__dirname, "..", "uploads", "listings", mediaFile.filename);
        await fs.unlink(filePath);
      } catch (err) {
        console.log("File not found on disk:", err.message);
      }
    }

    // Delete associated media files from GCS
    await gcs.deleteListingMedia(listing);

    // Soft delete - change status instead of removing
    await Listing.findByIdAndUpdate(id, { status: "deleted" });

    res.json({
      success: true,
      message: "Listing and media deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Upload media to existing listing (protected - owner only)
const uploadMedia = async (req, res, next) => {
  try {
    const { id } = req.params;

    const listing = await Listing.findById(id);

    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Check ownership
    if (listing.owner.toString() !== req.user._id.toString()) {
      throw new ForbiddenError("You can only upload media to your own listings");
    }

    // Check if file was uploaded
    if (!req.file) {
      throw new BadRequestError("No file uploaded");
    }

    // Enforce per-tier media limits for uploads
    const owner = req.user; // populated by auth middleware
    const isAdminUser = owner.role === "admin";
    const isPremiumOrPro = ["Premium", "Pro"].includes(owner.tier);
    const isStarter = owner.tier === "Starter";
    const isFree = !owner.tier || owner.tier === "Free";

    const isImageUpload = req.file.mimetype && req.file.mimetype.startsWith("image/");
    const isVideoUpload = req.file.mimetype && req.file.mimetype.startsWith("video/");

    // Determine if this is a talent or business listing
    const isTalent = isTalentCategory(listing.category);

    if (!isAdminUser) {
      // Business listings should only have images (no videos)
      if (!isTalent && isVideoUpload) {
        throw new BadRequestError(
          `Business listings can only have images. Videos are only allowed for talent listings.`
        );
      }

      // Quantity restrictions
      const existingImageCount = listing.mediaFiles.filter((m) => m.type === "image").length;
      const existingVideoCount = listing.mediaFiles.filter((m) => m.type === "video").length;

      // Business listings (Free tier): 15 images max
      if (isFree && !isTalent && isImageUpload && existingImageCount >= 15) {
        throw new BadRequestError(
          `Image limit reached for your Free tier. Max 15 image(s) per business listing.`
        );
      }

      // Talent listings (Free tier): 10 videos max
      if (isFree && isTalent && isVideoUpload && existingVideoCount >= 10) {
        throw new BadRequestError(
          `Video limit reached for your Free tier. Max 10 video(s) per talent listing.`
        );
      }

      // Business listings (Starter tier): 20 images max
      if (isStarter && !isTalent && isImageUpload && existingImageCount >= 20) {
        throw new BadRequestError(
          `Image limit reached for your Starter tier. Max 20 image(s) per business listing.`
        );
      }

      // Talent listings (Starter tier): 15 videos max
      if (isStarter && isTalent && isVideoUpload && existingVideoCount >= 15) {
        throw new BadRequestError(
          `Video limit reached for your Starter tier. Max 15 video(s) per talent listing.`
        );
      }
    }

    // Upload to GCS if enabled, otherwise use local storage
    let fileUrl = `/uploads/listings/${req.file.filename}`;

    if (gcs.isGcsEnabled()) {
      const bucketName = gcs.getGcsBucketName();
      const resourceType = req.file.mimetype.startsWith("image/") ? "image" : "video";
      const objectName = gcs.buildObjectName({
        resourceType,
        purpose: "listing",
        filename: req.file.originalname,
        customName: req.body.name, // Use user-provided title
      });

      const localPath = path.join(__dirname, "..", "uploads", "listings", req.file.filename);

      try {
        fileUrl = await gcs.uploadFromPath({
          bucketName,
          objectName,
          localPath,
          contentType: req.file.mimetype,
        });

        // Delete local file after successful GCS upload
        try {
          await fs.unlink(localPath);
        } catch (unlinkErr) {
          console.warn(`⚠️ Could not delete local file ${localPath}:`, unlinkErr.message);
        }
      } catch (gcsErr) {
        console.error(
          `⚠️ GCS upload failed for ${req.file.filename}, using local storage:`,
          gcsErr.message
        );
      }
    }

    console.log("📥 Backend received upload:", {
      originalname: req.file.originalname,
      customName: req.body.name,
      willSaveName: req.body.name || req.file.originalname,
      description: req.body.description,
    });

    const mediaFile = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      name: req.body.name || req.file.originalname, // Save custom title provided by user
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: fileUrl,
      type: req.file.mimetype.startsWith("image/")
        ? "image"
        : req.file.mimetype.startsWith("video/")
          ? "video"
          : req.file.mimetype.startsWith("audio/")
            ? "audio"
            : "document",
      description: req.body.description || "",
    };

    listing.mediaFiles.push(mediaFile);
    await listing.save();

    res.status(201).json({
      success: true,
      message: "Media uploaded successfully",
      mediaFile: listing.mediaFiles[listing.mediaFiles.length - 1],
    });
  } catch (error) {
    next(error);
  }
};

// Feature/Unfeature a listing (Premium/Pro only)
const toggleFeatureListing = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { featured } = req.body;

    // Get the listing
    const listing = await Listing.findById(id);
    if (!listing) {
      throw new NotFoundError("Listing not found");
    }

    // Check ownership
    if (listing.owner.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      throw new ForbiddenError("You can only feature your own listings");
    }

    // Update featured status
    listing.featured = featured === true;
    await listing.save();

    res.json({
      success: true,
      message: featured ? "Listing featured successfully" : "Listing unfeatured successfully",
      listing,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllListings,
  getListingById,
  getMyListings,
  createListing,
  updateListing,
  uploadMedia,
  deleteListingMedia,
  deleteListing,
  toggleFeatureListing,
};
