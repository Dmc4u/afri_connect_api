const PricingSettings = require("../models/PricingSettings");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");

/**
 * Get all pricing settings
 */
const getAllPricing = (req, res, next) => {
  PricingSettings.find({})
    .then((prices) => {
      res.send({
        prices: prices,
        total: prices.length,
      });
    })
    .catch((err) => next(err));
};

/**
 * Get pricing for a specific tier
 */
const getPricingByTier = (req, res, next) => {
  const { tier } = req.params;

  PricingSettings.findOne({ tier })
    .then((pricing) => {
      if (!pricing) {
        // Return default pricing if not found
        const defaults = {
          Free: { tier: "Free", basePrice: 0, billingPeriod: "forever", currency: "$" },
          Starter: { tier: "Starter", basePrice: 3, billingPeriod: "month", currency: "$" },
          Premium: { tier: "Premium", basePrice: 7, billingPeriod: "month", currency: "$" },
          Pro: { tier: "Pro", basePrice: 20, billingPeriod: "month", currency: "$" },
        };
        return res.send(defaults[tier] || { tier, basePrice: 0, currency: "$" });
      }
      res.send(pricing);
    })
    .catch((err) => next(err));
};

/**
 * Update pricing for a tier (Admin only)
 */
const updatePricing = (req, res, next) => {
  const { tier } = req.params;
  const { basePrice, billingPeriod, currency, description, features, discountPercentage } =
    req.body;

  // Validate input
  if (basePrice !== undefined && (typeof basePrice !== "number" || basePrice < 0)) {
    return next(new BadRequestError("basePrice must be a non-negative number"));
  }

  if (
    discountPercentage !== undefined &&
    (typeof discountPercentage !== "number" || discountPercentage < 0 || discountPercentage > 100)
  ) {
    return next(new BadRequestError("discountPercentage must be between 0 and 100"));
  }

  const updateData = {};
  if (basePrice !== undefined) updateData.basePrice = basePrice;
  if (billingPeriod !== undefined) updateData.billingPeriod = billingPeriod;
  if (currency !== undefined) updateData.currency = currency;
  if (description !== undefined) updateData.description = description;
  if (features !== undefined) updateData.features = features;
  if (discountPercentage !== undefined) updateData.discountPercentage = discountPercentage;

  PricingSettings.findOneAndUpdate({ tier }, updateData, { new: true, runValidators: true })
    .orFail(() => new NotFoundError(`Pricing for tier ${tier} not found`))
    .then((pricing) => {
      res.send({
        message: `Pricing for ${tier} tier updated successfully`,
        pricing: pricing,
      });
    })
    .catch((err) => {
      if (err.name === "DocumentNotFoundError") {
        return next(new NotFoundError(`Pricing for tier ${tier} not found`));
      }
      if (err.name === "ValidationError") {
        return next(
          new BadRequestError(
            "Validation failed: " +
              Object.values(err.errors)
                .map((e) => e.message)
                .join(", ")
          )
        );
      }
      return next(err);
    });
};

/**
 * Reset pricing to defaults
 */
const resetPricingDefaults = (req, res, next) => {
  const defaultPrices = [
    { tier: "Free", basePrice: 0, billingPeriod: "forever", currency: "$" },
    { tier: "Starter", basePrice: 3, billingPeriod: "month", currency: "$" },
    { tier: "Premium", basePrice: 7, billingPeriod: "month", currency: "$" },
    { tier: "Pro", basePrice: 20, billingPeriod: "month", currency: "$" },
  ];

  Promise.all(
    defaultPrices.map((price) =>
      PricingSettings.findOneAndUpdate({ tier: price.tier }, price, {
        upsert: true,
        new: true,
        runValidators: true,
      })
    )
  )
    .then((prices) => {
      res.send({
        message: "Pricing reset to defaults successfully",
        prices: prices,
      });
    })
    .catch((err) => next(err));
};

/**
 * Bulk update pricing
 */
const bulkUpdatePricing = (req, res, next) => {
  const { prices } = req.body;

  if (!Array.isArray(prices) || prices.length === 0) {
    return next(new BadRequestError("prices must be a non-empty array"));
  }

  Promise.all(
    prices.map((priceData) =>
      PricingSettings.findOneAndUpdate({ tier: priceData.tier }, priceData, {
        upsert: true,
        new: true,
        runValidators: true,
      })
    )
  )
    .then((updatedPrices) => {
      res.send({
        message: "Pricing updated successfully",
        prices: updatedPrices,
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(
          new BadRequestError(
            "Validation failed: " +
              Object.values(err.errors)
                .map((e) => e.message)
                .join(", ")
          )
        );
      }
      return next(err);
    });
};

module.exports = {
  getAllPricing,
  getPricingByTier,
  updatePricing,
  resetPricingDefaults,
  bulkUpdatePricing,
};
