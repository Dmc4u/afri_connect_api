const express = require("express");
const { celebrate, Joi } = require("celebrate");
const {
  searchListings,
  saveSearch,
  getSavedSearches,
  executeSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  getSearchSuggestions,
  getSearchAnalytics,
} = require("../controllers/search");
const auth = require("../middlewares/auth");

const router = express.Router();

// Validation schemas
const searchValidation = celebrate({
  query: Joi.object().keys({
    query: Joi.string().trim().max(200),
    category: Joi.alternatives().try(
      Joi.string().valid(
        "technology",
        "creative",
        "marketing",
        "entertainment",
        "consulting",
        "health",
        "education",
        "finance",
        "other",
        "all"
      ),
      Joi.array().items(
        Joi.string().valid(
          "technology",
          "creative",
          "marketing",
          "entertainment",
          "consulting",
          "health",
          "education",
          "finance",
          "other"
        )
      )
    ),
    location: Joi.string().trim().max(100),
    tier: Joi.alternatives().try(
      Joi.string().valid("Free", "Premium", "Pro"),
      Joi.array().items(Joi.string().valid("Free", "Premium", "Pro"))
    ),
    priceRange: Joi.object().keys({
      min: Joi.number().min(0),
      max: Joi.number().min(0),
    }),
    dateRange: Joi.object().keys({
      start: Joi.date().iso(),
      end: Joi.date().iso(),
    }),
    sortBy: Joi.string().valid("relevance", "date", "views", "tier").default("relevance"),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    featured: Joi.boolean(),
    status: Joi.string().valid("active", "pending", "suspended").default("active"),
  }),
});

const saveSearchValidation = celebrate({
  body: Joi.object().keys({
    name: Joi.string().trim().min(3).max(50).required(),
    searchQuery: Joi.string().trim().max(200),
    filters: Joi.object().keys({
      category: Joi.alternatives().try(
        Joi.string().valid(
          "technology",
          "creative",
          "marketing",
          "entertainment",
          "consulting",
          "health",
          "education",
          "finance",
          "other"
        ),
        Joi.array().items(
          Joi.string().valid(
            "technology",
            "creative",
            "marketing",
            "entertainment",
            "consulting",
            "health",
            "education",
            "finance",
            "other"
          )
        )
      ),
      location: Joi.string().trim().max(100),
      tier: Joi.alternatives().try(
        Joi.string().valid("Free", "Premium", "Pro"),
        Joi.array().items(Joi.string().valid("Free", "Premium", "Pro"))
      ),
      featured: Joi.boolean(),
    }),
    sortBy: Joi.string().valid("relevance", "date", "views", "tier").default("relevance"),
    sortOrder: Joi.string().valid("asc", "desc").default("desc"),
    notificationEnabled: Joi.boolean().default(false),
  }),
});

const updateSavedSearchValidation = celebrate({
  body: Joi.object()
    .keys({
      name: Joi.string().trim().min(3).max(50),
      searchQuery: Joi.string().trim().max(200),
      filters: Joi.object(),
      sortBy: Joi.string().valid("relevance", "date", "views", "tier"),
      sortOrder: Joi.string().valid("asc", "desc"),
      notificationEnabled: Joi.boolean(),
    })
    .min(1),
});

const searchIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

const suggestionsValidation = celebrate({
  query: Joi.object().keys({
    q: Joi.string().trim().min(2).max(100).required(),
    type: Joi.string().valid("all", "categories", "locations", "titles").default("all"),
  }),
});

const executeSavedSearchValidation = celebrate({
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
  }),
});

// Public routes
router.get("/", searchValidation, searchListings);
router.get("/suggestions", suggestionsValidation, getSearchSuggestions);

// Protected routes (require authentication)
router.use(auth);

router.post("/save", saveSearchValidation, saveSearch);
router.get("/saved", getSavedSearches);
router.get(
  "/saved/:id/execute",
  searchIdValidation,
  executeSavedSearchValidation,
  executeSavedSearch
);
router.patch("/saved/:id", searchIdValidation, updateSavedSearchValidation, updateSavedSearch);
router.delete("/saved/:id", searchIdValidation, deleteSavedSearch);
router.get("/analytics", getSearchAnalytics);

module.exports = router;
