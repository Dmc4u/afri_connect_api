const Listing = require("../models/Listing");
const SavedSearch = require("../models/SavedSearch");
const User = require("../models/User");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");

// Advanced search listings (public)
const searchListings = async (req, res, next) => {
  try {
    const {
      query: searchQuery,
      category,
      location,
      tier,
      priceRange,
      dateRange,
      sortBy = "relevance",
      sortOrder = "desc",
      page = 1,
      limit = 20,
      featured,
      status = "active",
    } = req.query;

    // Build search query
    const searchFilter = { status };

    // Text search
    if (searchQuery) {
      searchFilter.$or = [
        { title: { $regex: searchQuery, $options: "i" } },
        { description: { $regex: searchQuery, $options: "i" } },
        { category: { $regex: searchQuery, $options: "i" } },
        { location: { $regex: searchQuery, $options: "i" } },
      ];
    }

    // Category filter
    if (category && category !== "all") {
      if (Array.isArray(category)) {
        searchFilter.category = { $in: category };
      } else {
        searchFilter.category = category;
      }
    }

    // Location filter
    if (location) {
      searchFilter.location = { $regex: location, $options: "i" };
    }

    // Tier filter
    if (tier) {
      if (Array.isArray(tier)) {
        searchFilter.tier = { $in: tier };
      } else {
        searchFilter.tier = tier;
      }
    }

    // Featured filter
    if (featured !== undefined) {
      searchFilter.featured = featured === "true";
    }

    // Date range filter
    if (dateRange) {
      const { start, end } = dateRange;
      if (start || end) {
        searchFilter.createdAt = {};
        if (start) searchFilter.createdAt.$gte = new Date(start);
        if (end) searchFilter.createdAt.$lte = new Date(end);
      }
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Sort options
    let sortOptions = {};
    switch (sortBy) {
      case "relevance":
        if (searchQuery) {
          // Use text score for relevance when there's a search query
          sortOptions = { score: { $meta: "textScore" } };
        } else {
          // Default to featured first, then newest
          sortOptions = { featured: -1, createdAt: -1 };
        }
        break;
      case "date":
        sortOptions.createdAt = sortOrder === "desc" ? -1 : 1;
        break;
      case "views":
        sortOptions.views = sortOrder === "desc" ? -1 : 1;
        break;
      case "tier":
        // Custom tier sorting: Pro > Premium > Free
        sortOptions = {
          tier: sortOrder === "desc" ? -1 : 1,
          createdAt: -1,
        };
        break;
      default:
        sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;
    }

    // Execute search
    let query = Listing.find(searchFilter);

    // Add text score projection if using text search
    if (searchQuery && sortBy === "relevance") {
      query = query.select({ score: { $meta: "textScore" } });
    }

    const listings = await query
      .populate("owner", "name email tier role")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Listing.countDocuments(searchFilter);

    // Get search suggestions based on categories and locations
    const suggestions = await Listing.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: null,
          categories: { $addToSet: "$category" },
          locations: { $addToSet: "$location" },
        },
      },
    ]);

    res.json({
      success: true,
      listings,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + listings.length < total,
        hasPrev: page > 1,
        totalItems: total,
      },
      suggestions: suggestions[0] || { categories: [], locations: [] },
      searchMeta: {
        query: searchQuery,
        filters: {
          category,
          location,
          tier,
          featured,
          dateRange,
        },
        sortBy,
        sortOrder,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Save search (protected)
const saveSearch = async (req, res, next) => {
  try {
    const { name, searchQuery, filters, sortBy, sortOrder, notificationEnabled = false } = req.body;

    if (!name) {
      throw new BadRequestError("Search name is required");
    }

    // Check if user already has a saved search with this name
    const existingSearch = await SavedSearch.findOne({
      user: req.user._id,
      name,
    });

    if (existingSearch) {
      throw new BadRequestError("You already have a saved search with this name");
    }

    // Check user tier for saved search limits
    const user = await User.findById(req.user._id);
    const userSearchCount = await SavedSearch.countDocuments({
      user: req.user._id,
    });

    const searchLimits = {
      Free: 1,
      Premium: 5,
      Pro: 20,
    };

    const limit = searchLimits[user.tier] || searchLimits["Free"];

    if (userSearchCount >= limit) {
      throw new ForbiddenError(
        `Your ${user.tier} tier allows maximum ${limit} saved search(es). Please upgrade to save more searches.`
      );
    }

    const savedSearch = await SavedSearch.create({
      user: req.user._id,
      name,
      searchQuery,
      filters: filters || {},
      sortBy: sortBy || "relevance",
      sortOrder: sortOrder || "desc",
      notificationEnabled,
    });

    res.status(201).json({
      success: true,
      message: "Search saved successfully",
      savedSearch,
    });
  } catch (error) {
    next(error);
  }
};

// Get user's saved searches (protected)
const getSavedSearches = async (req, res, next) => {
  try {
    const savedSearches = await SavedSearch.find({
      user: req.user._id,
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      savedSearches,
    });
  } catch (error) {
    next(error);
  }
};

// Execute saved search (protected)
const executeSavedSearch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const savedSearch = await SavedSearch.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!savedSearch) {
      throw new NotFoundError("Saved search not found");
    }

    // Update last used
    savedSearch.lastUsed = new Date();
    savedSearch.usageCount += 1;
    await savedSearch.save();

    // Execute the search with saved parameters
    const searchParams = {
      query: savedSearch.searchQuery,
      ...savedSearch.filters,
      sortBy: savedSearch.sortBy,
      sortOrder: savedSearch.sortOrder,
      page,
      limit,
    };

    // Use the search function with saved parameters
    req.query = searchParams;
    await searchListings(req, res, next);
  } catch (error) {
    next(error);
  }
};

// Update saved search (protected)
const updateSavedSearch = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const savedSearch = await SavedSearch.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!savedSearch) {
      throw new NotFoundError("Saved search not found");
    }

    // Remove fields that shouldn't be updated
    delete updates.user;
    delete updates.createdAt;
    delete updates.usageCount;

    const updatedSearch = await SavedSearch.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Saved search updated successfully",
      savedSearch: updatedSearch,
    });
  } catch (error) {
    next(error);
  }
};

// Delete saved search (protected)
const deleteSavedSearch = async (req, res, next) => {
  try {
    const { id } = req.params;

    const savedSearch = await SavedSearch.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!savedSearch) {
      throw new NotFoundError("Saved search not found");
    }

    await SavedSearch.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Saved search deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// Get search suggestions (public)
const getSearchSuggestions = async (req, res, next) => {
  try {
    const { q, type = "all" } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        suggestions: [],
      });
    }

    const suggestions = {};

    if (type === "all" || type === "categories") {
      // Get category suggestions
      const categories = await Listing.distinct("category", {
        category: { $regex: q, $options: "i" },
        status: "active",
      });
      suggestions.categories = categories.slice(0, 5);
    }

    if (type === "all" || type === "locations") {
      // Get location suggestions
      const locations = await Listing.distinct("location", {
        location: { $regex: q, $options: "i" },
        status: "active",
      });
      suggestions.locations = locations.slice(0, 5);
    }

    if (type === "all" || type === "titles") {
      // Get title suggestions
      const titles = await Listing.find({
        title: { $regex: q, $options: "i" },
        status: "active",
      })
        .select("title")
        .limit(5)
        .lean();
      suggestions.titles = titles.map((l) => l.title);
    }

    res.json({
      success: true,
      suggestions,
    });
  } catch (error) {
    next(error);
  }
};

// Get search analytics (protected - premium users only)
const getSearchAnalytics = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    if (!["Premium", "Pro"].includes(user.tier) && user.role !== "admin") {
      throw new ForbiddenError("Search analytics requires Premium or Pro membership");
    }

    // Get popular search terms
    const popularSearches = await SavedSearch.aggregate([
      {
        $group: {
          _id: "$searchQuery",
          count: { $sum: "$usageCount" },
          users: { $addToSet: "$user" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // Get popular categories
    const popularCategories = await Listing.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: "$category",
          count: { $sum: 1 },
          avgViews: { $avg: "$views" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Get trending locations
    const trendingLocations = await Listing.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: "$location",
          count: { $sum: 1 },
          recentListings: {
            $sum: {
              $cond: [
                { $gte: ["$createdAt", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { recentListings: -1, count: -1 } },
      { $limit: 10 },
    ]);

    res.json({
      success: true,
      analytics: {
        popularSearches,
        popularCategories,
        trendingLocations,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  searchListings,
  saveSearch,
  getSavedSearches,
  executeSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  getSearchSuggestions,
  getSearchAnalytics,
};
