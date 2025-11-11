const mongoose = require("mongoose");

const savedSearchSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, "Search name is required"],
      trim: true,
      minlength: [1, "Search name must be at least 1 character"],
      maxlength: [100, "Search name cannot exceed 100 characters"],
    },
    searchCriteria: {
      query: {
        type: String,
        trim: true,
        maxlength: 500,
      },
      category: {
        type: String,
        enum: [
          "technology",
          "creative",
          "marketing",
          "entertainment",
          "consulting",
          "health",
          "education",
          "finance",
          "other",
          "all",
        ],
        default: "all",
      },
      location: {
        type: String,
        trim: true,
        maxlength: 100,
      },
      priceRange: {
        min: {
          type: Number,
          min: 0,
          default: 0,
        },
        max: {
          type: Number,
          min: 0,
          default: null,
        },
      },
      dateRange: {
        from: {
          type: Date,
          default: null,
        },
        to: {
          type: Date,
          default: null,
        },
      },
      tier: {
        type: [String],
        enum: ["Free", "Premium", "Pro"],
        default: [],
      },
      sortBy: {
        type: String,
        enum: ["relevance", "date", "price", "location", "tier"],
        default: "relevance",
      },
      sortOrder: {
        type: String,
        enum: ["asc", "desc"],
        default: "desc",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    alertsEnabled: {
      type: Boolean,
      default: true,
    },
    alertFrequency: {
      type: String,
      enum: ["immediate", "daily", "weekly", "never"],
      default: "daily",
    },
    lastAlertSent: {
      type: Date,
      default: null,
    },
    lastRun: {
      type: Date,
      default: null,
    },
    resultCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    newResultsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRuns: {
      type: Number,
      default: 0,
      min: 0,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
        maxlength: 30,
      },
    ],
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    privacy: {
      type: String,
      enum: ["private", "shared", "public"],
      default: "private",
    },
    sharedWith: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        permission: {
          type: String,
          enum: ["view", "edit"],
          default: "view",
        },
        sharedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    performance: {
      avgResponseTime: {
        type: Number,
        default: 0,
        min: 0,
      },
      lastResponseTime: {
        type: Number,
        default: 0,
        min: 0,
      },
      errorCount: {
        type: Number,
        default: 0,
        min: 0,
      },
      lastError: {
        message: String,
        timestamp: Date,
      },
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for efficient queries
savedSearchSchema.index({ user: 1, isActive: 1, createdAt: -1 });
savedSearchSchema.index({ user: 1, name: 1 });
savedSearchSchema.index({ alertsEnabled: 1, alertFrequency: 1, lastAlertSent: 1 });
savedSearchSchema.index({ privacy: 1, createdAt: -1 });
savedSearchSchema.index({ tags: 1 });
savedSearchSchema.index({ "searchCriteria.category": 1 });

// Compound index for search optimization
savedSearchSchema.index({
  user: 1,
  "searchCriteria.category": 1,
  "searchCriteria.location": 1,
  isActive: 1,
});

// Virtual for checking if search needs to run alerts
savedSearchSchema.virtual("needsAlert").get(function () {
  if (!this.alertsEnabled || this.alertFrequency === "never") return false;
  if (!this.lastAlertSent) return true;

  const now = new Date();
  const lastAlert = new Date(this.lastAlertSent);

  switch (this.alertFrequency) {
    case "immediate":
      return this.newResultsCount > 0;
    case "daily":
      return now.getTime() - lastAlert.getTime() >= 24 * 60 * 60 * 1000;
    case "weekly":
      return now.getTime() - lastAlert.getTime() >= 7 * 24 * 60 * 60 * 1000;
    default:
      return false;
  }
});

// Virtual for generating search URL/query string
savedSearchSchema.virtual("searchUrl").get(function () {
  const criteria = this.searchCriteria;
  const params = new URLSearchParams();

  if (criteria.query) params.append("q", criteria.query);
  if (criteria.category && criteria.category !== "all")
    params.append("category", criteria.category);
  if (criteria.location) params.append("location", criteria.location);
  if (criteria.priceRange.min > 0) params.append("minPrice", criteria.priceRange.min);
  if (criteria.priceRange.max) params.append("maxPrice", criteria.priceRange.max);
  if (criteria.tier.length > 0) params.append("tiers", criteria.tier.join(","));
  if (criteria.sortBy) params.append("sort", criteria.sortBy);
  if (criteria.sortOrder) params.append("order", criteria.sortOrder);

  return `/listings?${params.toString()}`;
});

// Pre-save middleware
savedSearchSchema.pre("save", function (next) {
  this.updatedAt = Date.now();

  // Validate date range
  if (this.searchCriteria.dateRange.from && this.searchCriteria.dateRange.to) {
    if (this.searchCriteria.dateRange.from >= this.searchCriteria.dateRange.to) {
      return next(new Error("Start date must be before end date"));
    }
  }

  // Validate price range
  if (this.searchCriteria.priceRange.min && this.searchCriteria.priceRange.max) {
    if (this.searchCriteria.priceRange.min >= this.searchCriteria.priceRange.max) {
      return next(new Error("Minimum price must be less than maximum price"));
    }
  }

  next();
});

// Instance method to execute the search
savedSearchSchema.methods.executeSearch = async function () {
  try {
    this.lastRun = new Date();
    this.totalRuns += 1;

    const startTime = Date.now();

    // Here you would implement the actual search logic
    // This is a placeholder for the search execution
    const Listing = mongoose.model("Listing");
    const searchQuery = this.buildSearchQuery();

    const results = await Listing.find(searchQuery)
      .populate("owner", "name tier")
      .sort(this.buildSortCriteria())
      .lean();

    const responseTime = Date.now() - startTime;

    // Update performance metrics
    this.performance.lastResponseTime = responseTime;
    this.performance.avgResponseTime =
      this.performance.avgResponseTime === 0
        ? responseTime
        : (this.performance.avgResponseTime + responseTime) / 2;

    // Check for new results (simplified logic)
    const newCount = results.length - this.resultCount;
    this.newResultsCount = newCount > 0 ? newCount : 0;
    this.resultCount = results.length;

    await this.save();

    return {
      success: true,
      results,
      count: results.length,
      newCount: this.newResultsCount,
      responseTime,
    };
  } catch (error) {
    this.performance.errorCount += 1;
    this.performance.lastError = {
      message: error.message,
      timestamp: new Date(),
    };

    await this.save();

    return {
      success: false,
      error: error.message,
      results: [],
      count: 0,
    };
  }
};

// Instance method to build MongoDB search query
savedSearchSchema.methods.buildSearchQuery = function () {
  const criteria = this.searchCriteria;
  const query = { status: "active" };

  if (criteria.query) {
    query.$or = [
      { title: { $regex: criteria.query, $options: "i" } },
      { description: { $regex: criteria.query, $options: "i" } },
    ];
  }

  if (criteria.category && criteria.category !== "all") {
    query.category = criteria.category;
  }

  if (criteria.location) {
    query.location = { $regex: criteria.location, $options: "i" };
  }

  if (criteria.tier.length > 0) {
    query.tier = { $in: criteria.tier };
  }

  if (criteria.dateRange.from || criteria.dateRange.to) {
    query.createdAt = {};
    if (criteria.dateRange.from) {
      query.createdAt.$gte = criteria.dateRange.from;
    }
    if (criteria.dateRange.to) {
      query.createdAt.$lte = criteria.dateRange.to;
    }
  }

  return query;
};

// Instance method to build sort criteria
savedSearchSchema.methods.buildSortCriteria = function () {
  const criteria = this.searchCriteria;
  const sortOrder = criteria.sortOrder === "asc" ? 1 : -1;

  switch (criteria.sortBy) {
    case "date":
      return { createdAt: sortOrder };
    case "location":
      return { location: sortOrder };
    case "tier":
      return { tier: sortOrder, createdAt: -1 };
    case "relevance":
    default:
      return { featured: -1, createdAt: -1 };
  }
};

// Instance method to mark alert as sent
savedSearchSchema.methods.markAlertSent = function () {
  this.lastAlertSent = new Date();
  this.newResultsCount = 0;
  return this.save();
};

// Static method to find searches needing alerts
savedSearchSchema.statics.findSearchesNeedingAlerts = function () {
  return this.find({
    isActive: true,
    alertsEnabled: true,
    alertFrequency: { $ne: "never" },
  }).populate("user", "name email tier");
};

// Static method to get user's saved searches
savedSearchSchema.statics.getUserSearches = function (userId, includeInactive = false) {
  const query = { user: userId };
  if (!includeInactive) {
    query.isActive = true;
  }
  return this.find(query).sort({ updatedAt: -1 });
};

module.exports = mongoose.model("SavedSearch", savedSearchSchema);
