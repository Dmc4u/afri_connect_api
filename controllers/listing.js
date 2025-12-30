const Listing = require("../models/Listing");
const User = require("../models/User");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");
const path = require("path");
const fs = require("fs").promises;

// --- Slug helpers (mirror model logic) ---
function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function generateUniqueSlug(base, currentId) {
  if (!base) base = 'listing';
  let candidate = base;
  let i = 2;
  while (true) {
    const exists = await Listing.findOne({ slug: candidate, _id: { $ne: currentId } }).select('_id').lean();
    if (!exists) return candidate;
    candidate = `${base}-${i++}`;
  }
}

// Get all listings (public)
const getAllListings = async (req, res, next) => {
  try {
    const { category, location, search, page = 1, limit = 20, excludeWinners } = req.query;

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
    if (excludeWinners === 'true') {
      const TalentContestant = require("../models/TalentContestant");
      // Exclude ALL listings that are associated with talent showcase contestants
      // This ensures showcase contestants don't appear on business listings page
      const contestantListingIds = await TalentContestant.find({
        listing: { $exists: true, $ne: null }
      })
        .distinct('listing')
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

    let listing = await Listing.findOne({ _id: id, status: "active" })
      .populate("owner", "name email tier role settings profilePhoto")
      .lean();

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
      } catch { /* noop */ }
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

    // Admin bypass: Allow admins to create listings at any tier
    const isAdmin = user.role === "admin";

    if (!isAdmin) {
      const userListingsCount = await Listing.countDocuments({
        owner: req.user._id,
        status: { $ne: "deleted" },
      });

      // Enforce listing limits based on tier (Free = 1, Starter = 5, Premium/Pro = unlimited)
      const tierLimits = {
        Free: 1,
        Starter: 5,
        Premium: Infinity,
        Pro: Infinity,
      };

      const limit = tierLimits[user.tier] ?? 1;

      if (userListingsCount >= limit) {
        throw new ForbiddenError(
          `Your ${user.tier || "Free"} tier allows maximum ${
            Number.isFinite(limit) ? limit : "unlimited"
          } listing(s).`
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
    // Free: images only, max 1
    // Starter: images only, up to 5
    // Premium/Pro: images and videos, unlimited
    if (req.files && req.files.length > 0) {
      const isPremiumOrPro = ["Premium", "Pro"].includes(user.tier);
      const isStarter = user.tier === "Starter";
      const isFree = !user.tier || user.tier === "Free";

      // Validate types per tier
      for (const f of req.files) {
        const isImage = f.mimetype && f.mimetype.startsWith("image/");
        const isVideo = f.mimetype && f.mimetype.startsWith("video/");

        if (!isAdmin) {
          if ((isFree || isStarter) && !isImage) {
            throw new BadRequestError(`Your ${user.tier || "Free"} tier allows images only.`);
          }
          if (!isPremiumOrPro && isVideo) {
            throw new BadRequestError("Video uploads are available on Premium and Pro tiers.");
          }
        }
      }

      // Count incoming images to enforce caps for Free/Starter
      if (!isAdmin) {
        const incomingImages = req.files.filter(
          (f) => f.mimetype && f.mimetype.startsWith("image/")
        ).length;
        const imageCap = isFree ? 1 : isStarter ? 5 : Infinity;
        if (incomingImages > imageCap) {
          throw new BadRequestError(
            `Your ${user.tier || "Free"} tier allows up to ${
              Number.isFinite(imageCap) ? imageCap : "unlimited"
            } image(s) per listing.`
          );
        }
      }

      listingData.mediaFiles = req.files.map((file) => ({
        filename: file.filename,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        url: `/uploads/listings/${file.filename}`,
        type: file.mimetype.startsWith("image/")
          ? "image"
          : file.mimetype.startsWith("video/")
            ? "video"
            : file.mimetype.startsWith("audio/")
              ? "audio"
              : "document",
      }));
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

    // Delete associated media files
    for (const mediaFile of listing.mediaFiles) {
      try {
        const filePath = path.join(__dirname, "..", "uploads", "listings", mediaFile.filename);
        await fs.unlink(filePath);
      } catch (err) {
        console.log("File not found on disk:", err.message);
      }
    }

    // Soft delete - change status instead of removing
    await Listing.findByIdAndUpdate(id, { status: "deleted" });

    res.json({
      success: true,
      message: "Listing deleted successfully",
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

    if (!isAdminUser) {
      // Type restrictions
      if ((isFree || isStarter) && !isImageUpload) {
        throw new BadRequestError(`Your ${owner.tier || "Free"} tier allows images only.`);
      }
      if (!isPremiumOrPro && isVideoUpload) {
        throw new BadRequestError("Video uploads are available on Premium and Pro tiers.");
      }

      // Quantity restrictions for images
      const existingImageCount = listing.mediaFiles.filter((m) => m.type === "image").length;
      const imageCap = isFree ? 1 : isStarter ? 5 : Infinity;
      if (isImageUpload && existingImageCount >= imageCap) {
        throw new BadRequestError(
          `Image limit reached for your ${owner.tier || "Free"} tier. Max ${
            Number.isFinite(imageCap) ? imageCap : "unlimited"
          } image(s) per listing.`
        );
      }
    }

    // Add media file to listing (using local storage)
    const mediaFile = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/listings/${req.file.filename}`,
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
