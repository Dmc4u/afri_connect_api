const express = require("express");
const { celebrate, Joi } = require("celebrate");
const auth = require("../middlewares/auth");
const { ForbiddenError } = require("../utils/errors");
const { validateNewsArticle } = require("../middlewares/validation");
const {
	createNews,
	getAllNews,
	getNewsById,
	updateNews,
	deleteNews,
} = require("../controllers/news");

const router = express.Router();

// Params validation
const newsIdValidation = celebrate({
	params: Joi.object().keys({
		id: Joi.string().hex().length(24).required(),
	}),
});

// Query validation for list endpoint
const listQueryValidation = celebrate({
	query: Joi.object().keys({
		category: Joi.string().trim().allow(""),
	}),
});

// Update body validation (partial)
const updateNewsValidation = celebrate({
	body: Joi.object()
		.keys({
			title: Joi.string().trim().min(5).max(200),
			content: Joi.string().trim().min(20),
			image: Joi.string().uri(),
			category: Joi.string().trim(),
			tags: Joi.array().items(Joi.string()),
		})
		.min(1),
});

// Admin guard
const requireAdmin = (req, res, next) => {
	if (!req.user || req.user.role !== "admin") {
		return next(new ForbiddenError("Admin access required"));
	}
	return next();
};

// Routes
// Public: list news (optional category filter)
router.get("/", listQueryValidation, getAllNews);

// Public: get single news by id
router.get("/:id", newsIdValidation, getNewsById);

// Protected: create news article (admin only)
router.post("/", auth, requireAdmin, validateNewsArticle, createNews);

// Protected: update news article (admin only)
router.patch("/:id", auth, requireAdmin, newsIdValidation, updateNewsValidation, updateNews);

// Protected: delete news article (admin only)
router.delete("/:id", auth, requireAdmin, newsIdValidation, deleteNews);

module.exports = router;