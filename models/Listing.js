const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
      minlength: [2, "Title must be at least 2 characters"],
      maxlength: [100, "Title cannot exceed 100 characters"],
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
      minlength: [10, "Description must be at least 10 characters"],
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      enum: [
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
        // Unified creative/skills bucket used in client UI
        "Talent",
        // Region- and culture-specific
        "Nollywood",
        "Construction",
        "Agriculture",
        "Manufacturing",
        "Marketing",
        "Fashion",
        "Consulting",
        "Logistics",
        // New specialized categories
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
        // Additional community & media
        "Afrobeats & Music",
        "Content Creators",
        "Podcasts & Radio",
        "Sports & Fitness",
        "Non-profit & NGOs",
        "Other",
      ],
    },
    location: {
      type: String,
      required: [true, "Location is required"],
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    businessHours: {
      type: String,
      trim: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
    },
    tier: {
      type: String,
      enum: ["Free", "Starter", "Premium", "Pro"],
      default: "Free",
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    mediaFiles: [
      {
        filename: String,
        originalname: String,
        mimetype: String,
        size: Number,
        url: String,
        description: String, // Description for each media file
        type: {
          type: String,
          enum: ["image", "video", "audio", "document", "youtube"],
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    status: {
      type: String,
      enum: ["active", "pending", "suspended", "deleted"],
      default: "pending",
    },
    views: {
      type: Number,
      default: 0,
    },
    contacts: {
      type: Number,
      default: 0,
    },
    featured: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    // SEO-friendly slug derived from title
    slug: {
      type: String,
      trim: true,
      index: { unique: true, sparse: true },
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save middleware to update the updatedAt field
listingSchema.pre("save", async function (next) {
  try {
    this.updatedAt = Date.now();

    // Generate slug if needed
    if ((this.isModified("title") || !this.slug) && this.title) {
      const base = slugify(this.title);
      this.slug = await generateUniqueSlug(this.constructor, base, this._id);
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Pre-findOneAndUpdate middleware to update the updatedAt field
listingSchema.pre("findOneAndUpdate", async function (next) {
  try {
    this.set({ updatedAt: Date.now() });
    const update = this.getUpdate() || {};
    const $set = update.$set || update;
    if ($set && $set.title) {
      const base = slugify($set.title);
      const Model = this.model;
      const doc = await Model.findOne(this.getQuery()).select('_id');
      const id = doc?._id;
      const slug = await generateUniqueSlug(Model, base, id);
      this.set({ slug });
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Index for better query performance
listingSchema.index({ owner: 1, status: 1 });
listingSchema.index({ category: 1, status: 1 });
listingSchema.index({ location: 1, status: 1 });
listingSchema.index({ tier: 1, status: 1 });
listingSchema.index({ createdAt: -1 });

// Helper: slugify text
function slugify(text = "") {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Helper: ensure uniqueness by appending -2, -3, ... as needed
async function generateUniqueSlug(Model, base, currentId) {
  if (!base) base = 'listing';
  let candidate = base;
  let i = 2;
  // Try up to a reasonable number of attempts
  while (true) {
    const exists = await Model.findOne({ slug: candidate, _id: { $ne: currentId } }).select('_id');
    if (!exists) return candidate;
    candidate = `${base}-${i++}`;
  }
}

module.exports = mongoose.model("Listing", listingSchema);
