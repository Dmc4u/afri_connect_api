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
  getForumUnreadCount,
  markForumAsSeen,
} = require("../controllers/forum");
const auth = require("../middlewares/auth");
const { FORUM_CATEGORIES, FORUM_CATEGORY_IDS } = require("../utils/forumCategories");

const router = express.Router();

// Validation schemas
const createPostValidation = celebrate({
  body: Joi.object().keys({
    title: Joi.string().trim().min(3).max(150).required(),
    content: Joi.string().trim().min(10).max(10000).required(),
    category: Joi.string()
      .valid(...FORUM_CATEGORY_IDS)
      .required(),
    tags: Joi.array().items(Joi.string().trim().max(30)).max(10),
  }),
});

const updatePostValidation = celebrate({
  body: Joi.object()
    .keys({
      title: Joi.string().trim().min(3).max(150),
      content: Joi.string().trim().min(10).max(10000),
      category: Joi.string().valid(...FORUM_CATEGORY_IDS),
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
      .valid(...FORUM_CATEGORY_IDS, "all")
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
  res.json({ categories: FORUM_CATEGORIES });
});

// Protected routes (require authentication)
router.use(auth);

router.get("/my/posts", queryValidation, getMyPosts);
router.get("/my/post-stats", getUserPostStats);
router.get("/notifications/unread-count", getForumUnreadCount);
router.post("/notifications/mark-seen", markForumAsSeen);
router.post("/posts", createPostValidation, createPost);
router.patch("/posts/:id", postIdValidation, updatePostValidation, updatePost);
router.delete("/posts/:id", postIdValidation, deletePost);
router.post("/posts/:id/replies", postIdValidation, addReplyValidation, addReply);
router.delete("/posts/:id/replies/:replyId", deleteReplyValidation, deleteReply);
router.post("/posts/:id/like", postIdValidation, toggleLike);

module.exports = router;
