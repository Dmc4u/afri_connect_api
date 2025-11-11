const express = require("express");
const { celebrate, Joi } = require("celebrate");
const { generateApiKey, getApiKeys, revokeApiKey, getApiUsage } = require("../controllers/api");
const { exportListings, exportListingById, exportUsers } = require("../controllers/apiExport");
const auth = require("../middlewares/auth");

const router = express.Router();

// Validation schemas
const generateApiKeyValidation = celebrate({
  body: Joi.object().keys({
    name: Joi.string().trim().min(3).max(50).required(),
    permissions: Joi.array()
      .items(Joi.string().valid("read", "write", "admin"))
      .default(["read"]),
  }),
});

const keyIdValidation = celebrate({
  params: Joi.object().keys({
    keyId: Joi.string().hex().length(24).required(),
  }),
});

const usageQueryValidation = celebrate({
  query: Joi.object().keys({
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso(),
    keyId: Joi.string().hex().length(24),
  }),
});

const listingIdValidation = celebrate({
  params: Joi.object().keys({
    id: Joi.string().hex().length(24).required(),
  }),
});

// Protected routes (require authentication)
router.use(auth);

// API Key Management Routes
router.post("/keys", generateApiKeyValidation, generateApiKey);
router.get("/keys", getApiKeys);
router.delete("/keys/:keyId", keyIdValidation, revokeApiKey);
router.get("/usage", usageQueryValidation, getApiUsage);

// Data Export Routes (require API key in headers)
router.get("/export/listings", exportListings);
router.get("/export/listings/:id", listingIdValidation, exportListingById);
router.get("/export/users", exportUsers); // Admin only

module.exports = router;
