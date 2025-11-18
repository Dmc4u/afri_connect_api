const express = require("express");
const { celebrate, Joi } = require("celebrate");
const {
  getAllListings,
  getListingById,
  getMyListings,
  createListing,
  updateListing,
  uploadMedia,
  deleteListingMedia,
  deleteListing,
  toggleFeatureListing,
} = require("../controllers/listing");
const auth = require("../middlewares/auth");
const upload = require("../middlewares/upload");
const { requireFeatureAccess } = require("../middlewares/tierCheck");

const router = express.Router();

// Validation schemas
const createListingValidation = celebrate({
  body: Joi.object().keys({
    title: Joi.string().trim().min(2).max(100).required(),
    description: Joi.string().trim().min(10).max(1000).required(),
    category: Joi.string()
      .valid(
        // Core
        "Technology",
        "Creative",
        "Professional Services",
        "Retail",
        "Food & Beverage",
        "Healthcare",
        "Education",
        "Finance",
        "Real Estate",
        "Transportation",
        "Entertainment",
        // Unified creative/skills bucket used in client
        "Talent",
        // Region/Culture specific
        "Nollywood",
        "Construction",
        "Agriculture",
        "Manufacturing",
        "Marketing",
        "Fashion",
        "Consulting",
        "Logistics",
        // Specialized roles
        "Web Developer",
        "Mobile Developer",
        "UI/UX Design",
        "Graphic Design",
        "Digital Marketing",
        "IT Support",
        "Cybersecurity",
        "Content Writing",
        "Photography",
        "Videography",
        // Community & media
        "Afrobeats & Music",
        "Content Creators",
        "Podcasts & Radio",
        "Sports & Fitness",
        "Non-profit & NGOs",
        // Fallback
        "Other"
      )
      .required(),
    location: Joi.string().trim().min(2).max(100).required(),
    website: Joi.string().trim().allow("").optional(),
    businessHours: Joi.string().trim().allow("").optional(),
    phoneNumber: Joi.string().trim().allow("").optional(),
    email: Joi.string().email().trim().allow("").optional(),
    tier: Joi.string().valid("Free", "Starter", "Premium", "Pro").optional(),
  }),
});

const updateListingValidation = celebrate({
  body: Joi.object()
    .keys({
      title: Joi.string().trim().min(2).max(100),
      description: Joi.string().trim().min(10).max(1000),
      category: Joi.string().valid(
        // Core
        "Technology",
        "Creative",
        "Professional Services",
        "Retail",
        "Food & Beverage",
        "Healthcare",
        "Education",
        "Finance",
        "Real Estate",
        "Transportation",
        "Entertainment",
        // Unified creative/skills bucket used in client
        "Talent",
        // Region/Culture specific
        "Nollywood",
        "Construction",
        "Agriculture",
        "Manufacturing",
        "Marketing",
        "Fashion",
        "Consulting",
        "Logistics",
        // Specialized roles
        "Web Developer",
        "Mobile Developer",
        "UI/UX Design",
        "Graphic Design",
        "Digital Marketing",
        "IT Support",
        "Cybersecurity",
        "Content Writing",
        "Photography",
        "Videography",
        // Community & media
        "Afrobeats & Music",
        "Content Creators",
        "Podcasts & Radio",
        "Sports & Fitness",
        "Non-profit & NGOs",
        // Fallback
        "Other"
      ),
      location: Joi.string().trim().min(2).max(100),
      website: Joi.string().trim().allow(""),
      businessHours: Joi.string().trim().allow(""),
      phoneNumber: Joi.string().trim().allow(""),
      email: Joi.string().email().trim().allow(""),
      tier: Joi.string().valid("Free", "Starter", "Premium", "Pro"),
      status: Joi.string().valid("active", "pending", "suspended"),
    })
    .min(1),
});

const listingIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

const mediaIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
    mediaId: Joi.string().hex().length(24).required(),
  }),
});

const queryValidation = celebrate({
  query: Joi.object().keys({
    category: Joi.string().valid(
      "technology",
      "creative",
      "marketing",
      "entertainment",
      "consulting",
      "health",
      "education",
      "finance",
      "talent",
      "other",
      "all"
    ),
    location: Joi.string().trim(),
    search: Joi.string().trim(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    status: Joi.string().valid("active", "pending", "suspended", "deleted", "all").default("all"),
  }),
});

// Public routes (no authentication required)
router.get("/", queryValidation, getAllListings);

// Protected routes with specific paths (MUST come before /:id wildcard route)
router.get("/my-listings", auth, queryValidation, getMyListings);

// Public single listing view (comes after specific routes to avoid conflict)
router.get("/:id", listingIdValidation, getListingById);

// Other protected routes
router.post("/", auth, upload.array("mediaFiles", 10), createListingValidation, createListing);
router.post("/:id/upload", auth, upload.single("file"), listingIdValidation, uploadMedia);
router.post("/:id/add-url-media", auth, listingIdValidation, celebrate({
  body: Joi.object().keys({
    url: Joi.string().uri().required(),
    type: Joi.string().valid("youtube", "image", "video").required(),
    name: Joi.string().trim().max(200).default("Media"),
    description: Joi.string().trim().max(500).allow("").optional(),
  }),
}), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { url, type, name, description } = req.body;

    const Listing = require("../models/Listing");
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({ success: false, message: "Listing not found" });
    }

    // Check ownership
    if (listing.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "You can only add media to your own listings" });
    }

    // Add the URL-based media
    listing.mediaFiles.push({
      filename: name,
      originalname: name,
      mimetype: type === "youtube" ? "video/youtube" : type === "image" ? "image/url" : "video/url",
      url,
      type,
      description: description || "",
      uploadedAt: new Date(),
    });

    await listing.save();

    res.json({
      success: true,
      message: "URL media added successfully",
      mediaFiles: listing.mediaFiles,
    });
  } catch (error) {
    next(error);
  }
});
router.patch("/:id", auth, listingIdValidation, updateListingValidation, updateListing);
router.delete("/:id/media/:mediaId", auth, mediaIdValidation, deleteListingMedia);
router.delete("/:id", auth, listingIdValidation, deleteListing);

// Track contact for a listing (public, no auth required)
router.post("/:id/contact", listingIdValidation, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Increment contacts count
    const listing = await require("../models/Listing").findByIdAndUpdate(
      id,
      { $inc: { contacts: 1 } },
      { new: true }
    );

    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    res.json({
      success: true,
      message: "Contact recorded",
      contacts: listing.contacts,
    });
  } catch (error) {
    next(error);
  }
});

// Feature/Unfeature listing (Premium/Pro tier required)
router.post(
  "/:id/feature",
  auth,
  requireFeatureAccess,
  listingIdValidation,
  celebrate({
    body: Joi.object().keys({
      featured: Joi.boolean().required(),
    }),
  }),
  toggleFeatureListing
);

module.exports = router;
