const express = require("express");
const { celebrate, Joi } = require("celebrate");
const {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  addReply,
  deleteReply,
  toggleLike,
  getMyPosts,
  getUserPostStats,
} = require("../controllers/forum");
const auth = require("../middlewares/auth");

const router = express.Router();

// Validation schemas
const createPostValidation = celebrate({
  body: Joi.object().keys({
    title: Joi.string().trim().min(3).max(150).required(),
    content: Joi.string().trim().min(10).max(10000).required(),
    category: Joi.string()
      .valid(
        "general",
        "business",
        "technology",
        "marketing",
        "networking",
        "advice",
        "showcase",
        "feedback",
        "support",
        "announcements"
      )
      .required(),
    tags: Joi.array().items(Joi.string().trim().max(30)).max(10),
  }),
});

const updatePostValidation = celebrate({
  body: Joi.object()
    .keys({
      title: Joi.string().trim().min(3).max(150),
      content: Joi.string().trim().min(10).max(10000),
      category: Joi.string().valid(
        "general",
        "business",
        "technology",
        "marketing",
        "networking",
        "advice",
        "showcase",
        "feedback",
        "support",
        "announcements"
      ),
      tags: Joi.array().items(Joi.string().trim().max(30)).max(10),
      status: Joi.string().valid("published", "draft", "archived", "flagged"),
    })
    .min(1),
});

const addReplyValidation = celebrate({
  body: Joi.object().keys({
    content: Joi.string().trim().min(5).max(2000).required(),
  }),
});

const postIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

const deleteReplyValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
    replyId: Joi.string().hex().length(24).required(),
  }),
});

const queryValidation = celebrate({
  query: Joi.object().keys({
    category: Joi.string()
      .valid(
        "agriculture",
        "technology",
        "manufacturing",
        "healthcare",
        "education",
        "retail",
        "hospitality",
        "construction",
        "finance",
        "energy",
        "transport",
        "media",
        "realestate",
        "consulting",
        "beauty",
        "sports",
        "arts",
        "automotive",
        "legal",
        "general",
        "other",
        "all"
      )
      .allow(""),
    search: Joi.string().trim().max(100).allow(""),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(20),
    sort: Joi.string().valid("latest", "popular", "mostReplies", "oldest").default("latest"),
    status: Joi.string().valid("published", "draft", "suspended", "all").default("published"),
  }),
});

// Public routes
router.get("/posts", queryValidation, getAllPosts);
router.get("/posts/:id", postIdValidation, getPostById);
router.get("/categories", (req, res) => {
  const categories = [
    {
      id: "agriculture",
      name: "Agriculture & Farming",
      icon: "🌾",
      description: "Agriculture, farming, and related services",
    },
    {
      id: "technology",
      name: "Technology & IT",
      icon: "💻",
      description: "Software, IT services, and digital solutions",
    },
    {
      id: "manufacturing",
      name: "Manufacturing & Industry",
      icon: "🏭",
      description: "Manufacturing, production, and industrial services",
    },
    {
      id: "healthcare",
      name: "Healthcare & Medical",
      icon: "🏥",
      description: "Healthcare, medical services, and wellness",
    },
    {
      id: "education",
      name: "Education & Training",
      icon: "📚",
      description: "Education, training, and learning services",
    },
    {
      id: "retail",
      name: "Retail & Commerce",
      icon: "🛍️",
      description: "Retail, e-commerce, and commerce services",
    },
    {
      id: "hospitality",
      name: "Hospitality & Tourism",
      icon: "🏨",
      description: "Hotels, restaurants, and hospitality services",
    },
    {
      id: "construction",
      name: "Construction & Real Estate",
      icon: "🏗️",
      description: "Construction, real estate, and property services",
    },
    {
      id: "finance",
      name: "Finance & Banking",
      icon: "🏦",
      description: "Banking, finance, and financial services",
    },
    {
      id: "energy",
      name: "Energy & Utilities",
      icon: "⚡",
      description: "Energy, utilities, and power solutions",
    },
    {
      id: "transport",
      name: "Transportation & Logistics",
      icon: "🚚",
      description: "Transportation, logistics, and delivery services",
    },
    {
      id: "media",
      name: "Media & Entertainment",
      icon: "🎬",
      description: "Media, entertainment, and content creation",
    },
    {
      id: "realestate",
      name: "Real Estate & Property",
      icon: "🏘️",
      description: "Real estate, properties, and housing",
    },
    {
      id: "consulting",
      name: "Consulting & Professional Services",
      icon: "💼",
      description: "Consulting, business, and professional services",
    },
    {
      id: "beauty",
      name: "Beauty & Personal Care",
      icon: "💄",
      description: "Beauty, cosmetics, and personal care services",
    },
    {
      id: "sports",
      name: "Sports & Recreation",
      icon: "⚽",
      description: "Sports, fitness, and recreation activities",
    },
    {
      id: "arts",
      name: "Arts & Culture",
      icon: "🎨",
      description: "Arts, culture, and creative services",
    },
    {
      id: "automotive",
      name: "Automotive",
      icon: "🚗",
      description: "Automotive, vehicles, and transportation",
    },
    {
      id: "legal",
      name: "Legal & Compliance",
      icon: "⚖️",
      description: "Legal services and compliance",
    },
    {
      id: "general",
      name: "General Business",
      icon: "💼",
      description: "General business topics and discussions",
    },
    {
      id: "other",
      name: "Other",
      icon: "📌",
      description: "Other topics and miscellaneous",
    },
  ];
  res.json({ categories });
});

// Protected routes (require authentication)
router.use(auth);

router.get("/my/posts", queryValidation, getMyPosts);
router.get("/my/post-stats", getUserPostStats);
router.post("/posts", createPostValidation, createPost);
router.patch("/posts/:id", postIdValidation, updatePostValidation, updatePost);
router.delete("/posts/:id", postIdValidation, deletePost);
router.post("/posts/:id/replies", postIdValidation, addReplyValidation, addReply);
router.delete("/posts/:id/replies/:replyId", deleteReplyValidation, deleteReply);
router.post("/posts/:id/like", postIdValidation, toggleLike);

module.exports = router;
