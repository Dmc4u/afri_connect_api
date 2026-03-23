/**
 * Middleware to check user tier and enforce feature access
 * Ensures users only access features they paid for
 *
 * IMPORTANT: Tier Benefits Policy
 * ================================
 * Users retain their tier benefits (stored in user.tier) until explicitly downgraded.
 * The tierExpiresAt field is used only for billing/renewal tracking, NOT for access control.
 * This means:
 * - If a user's subscription expires, they keep their tier benefits until they choose to downgrade
 * - Automatic downgrades should be handled by a background job if needed
 * - All tier checks use user.tier directly without checking tierExpiresAt
 * - This provides a better user experience (no sudden loss of access)
 */

const { ForbiddenError } = require("../utils/errors");

/**
 * Get effective tier for a user
 * @param {Object} user - User object with tier field
 * @returns {string} - User's tier (defaults to "Free" if not set)
 */
const getEffectiveTier = (user) => {
  if (!user) return "Free";
  return user.tier || "Free";
};

/**
 * Check if user has required tier
 * @param {string|string[]} requiredTier - Single tier or array of tiers
 */
const checkTier = (requiredTier) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError("Authentication required"));
    }

    const tiers = Array.isArray(requiredTier) ? requiredTier : [requiredTier];
    const userTier = getEffectiveTier(req.user);

    // Admin bypass
    if (req.user.role === "admin") {
      return next();
    }

    if (!tiers.includes(userTier)) {
      const tierString = tiers.join(" or ");
      return next(
        new ForbiddenError(
          `This feature requires ${tierString} membership. Your current tier: ${userTier}`
        )
      );
    }

    next();
  };
};

/**
 * Tier feature matrix - defines what each tier can do
 */
const TIER_FEATURES = {
  Free: {
    maxListings: 1, // 1 business + 1 talent listing
    maxBusinessListings: 1,
    maxTalentListings: 1,
    maxImagesPerBusinessListing: 15,
    maxVideosPerTalentListing: 10,
    canCreateListings: true,
    canFeatureListing: false,
    canAccessAnalytics: false,
    canSetLogo: true,
    canCustomizeProfile: true, // Basic customization
    canInquiryTracking: false,
    canExportLeads: false,
    supportResponseTime: "48hr",
    canAccessAPI: false,
    canRemoveBranding: false,
    canUseAdvancedSearch: false,
    adCreditsPerMonth: 0,
  },
  Starter: {
    maxListings: 5, // 5 business + 5 talent listings
    maxBusinessListings: 5,
    maxTalentListings: 5,
    maxImagesPerBusinessListing: 20,
    maxVideosPerTalentListing: 15,
    canCreateListings: true,
    canFeatureListing: false,
    canAccessAnalytics: true, // Basic analytics
    canSetLogo: true,
    canCustomizeProfile: true,
    canCustomBranding: true, // Custom colors, fonts
    canInquiryTracking: true,
    canExportLeads: true,
    canPriorityPlacement: true,
    supportResponseTime: "24hr",
    canAccessAPI: false,
    canRemoveBranding: false,
    canUseAdvancedSearch: true,
    adCreditsPerMonth: 0,
  },
  Premium: {
    maxListings: Infinity,
    maxBusinessListings: Infinity,
    maxTalentListings: Infinity,
    maxImagesPerBusinessListing: Infinity,
    maxVideosPerTalentListing: Infinity,
    canCreateListings: true,
    canFeatureListing: true, // Featured badge
    canAccessAnalytics: true, // Advanced analytics
    canSetLogo: true,
    canCustomizeProfile: true,
    canCustomBranding: true,
    canInquiryTracking: true,
    canExportLeads: true,
    canPriorityPlacement: true,
    canLeadGeneration: true, // CRM integration, contact forms
    canPortfolioTemplates: true,
    supportResponseTime: "12hr",
    canAccessAPI: true,
    canRemoveBranding: true,
    canUseAdvancedSearch: true,
    adCreditsPerMonth: 20,
  },
  Pro: {
    maxListings: Infinity,
    maxBusinessListings: Infinity,
    maxTalentListings: Infinity,
    maxImagesPerBusinessListing: Infinity,
    maxVideosPerTalentListing: Infinity,
    canCreateListings: true,
    canFeatureListing: true,
    canAccessAnalytics: true, // Advanced analytics + custom reports
    canSetLogo: true,
    canCustomizeProfile: true,
    canCustomBranding: true,
    canInquiryTracking: true,
    canExportLeads: true,
    canPriorityPlacement: true,
    canLeadGeneration: true,
    canPortfolioTemplates: true,
    canCustomPageDesign: true, // Pro only: custom page design
    canGetVerifiedBadge: true, // Pro only: verified badge
    canAccessTopTierPlacement: true, // Pro only: homepage featured rotation
    canAccessDedicatedManager: true, // Pro only: account manager
    canAccessQuarterlyStrategy: true, // Pro only: strategy calls
    canGetFeaturedInNewsletters: true, // Pro only: newsletter feature
    canAccessCrossPlatformPromo: true, // Pro only: cross-platform
    canWhiteLabel: true, // Pro only: white-label options
    canAdvancedFraudProtection: true, // Pro only: verified contact methods
    canEarlyAccess: true, // Pro only: early access to new features
    supportResponseTime: "24/7",
    canAccessAPI: true,
    canRemoveBranding: true,
    canUseAdvancedSearch: true,
    adCreditsPerMonth: 50,
  },
};

/**
 * Get feature permissions for user tier
 */
const getUserTierFeatures = (tier) => {
  return TIER_FEATURES[tier] || TIER_FEATURES["Free"];
};

/**
 * Check if user can perform a specific feature action
 */
const canUserPerformAction = (userTier, action) => {
  const features = getUserTierFeatures(userTier);
  return features[action] === true;
};

/**
 * Check if user has reached listing limit
 */
const checkListingLimit = (requiredTier) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ForbiddenError("Authentication required"));
    }

    const userTier = req.user.tier || "Free";
    const features = getUserTierFeatures(userTier);

    req.tierInfo = {
      tier: userTier,
      maxListings: features.maxListings,
      features: features,
    };

    next();
  };
};

/**
 * Check if user can access analytics
 */
const requireAnalyticsAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  const features = getUserTierFeatures(userTier);

  if (!features.canAccessAnalytics) {
    return next(
      new ForbiddenError(`Analytics access requires Starter tier or higher. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can feature a listing
 */
const requireFeatureAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  const features = getUserTierFeatures(userTier);

  if (!features.canFeatureListing) {
    return next(
      new ForbiddenError(`Featured listings require Premium tier or higher. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can remove branding
 */
const requireBrandingRemoval = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  const features = getUserTierFeatures(userTier);

  if (!features.canRemoveBranding) {
    return next(
      new ForbiddenError(`Remove branding feature requires Pro tier. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can access API
 */
const requireAPIAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  const features = getUserTierFeatures(userTier);

  if (!features.canAccessAPI) {
    return next(
      new ForbiddenError(`API access requires Premium tier or higher. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can customize page design (Pro only)
 */
const requirePageDesignAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  if (userTier === "admin") return next(); // Admin bypass

  const features = getUserTierFeatures(userTier);

  if (!features.canCustomizePageDesign) {
    return next(new ForbiddenError(`Custom page design requires Pro tier. Your tier: ${userTier}`));
  }

  next();
};

/**
 * Check if user can access lead generation tools (Pro only)
 */
const requireLeadGenerationAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  if (userTier === "admin") return next();

  const features = getUserTierFeatures(userTier);

  if (!features.canAccessLeadGeneration) {
    return next(
      new ForbiddenError(`Lead generation tools require Pro tier. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can access advanced ads (Pro only)
 */
const requireAdvancedAdsAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  if (userTier === "admin") return next();

  const features = getUserTierFeatures(userTier);

  if (!features.canAccessAdvancedAds) {
    return next(
      new ForbiddenError(`Advanced advertising tools require Pro tier. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can customize profile (Starter+)
 */
const requireProfileCustomization = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  if (userTier === "admin") return next();

  const features = getUserTierFeatures(userTier);

  if (!features.canCustomizeProfile) {
    return next(
      new ForbiddenError(
        `Profile customization requires Starter tier or higher. Your tier: ${userTier}`
      )
    );
  }

  next();
};

/**
 * Check if user has verified badge (Pro only)
 */
const requireVerifiedBadgeAccess = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  if (userTier === "admin") return next();

  const features = getUserTierFeatures(userTier);

  if (!features.canGetVerifiedBadge) {
    return next(
      new ForbiddenError(`Verified business badge requires Pro tier. Your tier: ${userTier}`)
    );
  }

  next();
};

/**
 * Check if user can access top-tier placement (Pro only)
 */
const requireTopTierPlacement = (req, res, next) => {
  if (!req.user) {
    return next(new ForbiddenError("Authentication required"));
  }

  const userTier = req.user.tier || "Free";
  if (userTier === "admin") return next();

  const features = getUserTierFeatures(userTier);

  if (!features.canAccessTopTierPlacement) {
    return next(
      new ForbiddenError(`Top-tier featured placement requires Pro tier. Your tier: ${userTier}`)
    );
  }

  next();
};

module.exports = {
  checkTier,
  getEffectiveTier,
  TIER_FEATURES,
  getUserTierFeatures,
  canUserPerformAction,
  checkListingLimit,
  requireAnalyticsAccess,
  requireFeatureAccess,
  requireBrandingRemoval,
  requireAPIAccess,
  requirePageDesignAccess,
  requireLeadGenerationAccess,
  requireAdvancedAdsAccess,
  requireVerifiedBadgeAccess,
  requireTopTierPlacement,
  requireProfileCustomization,
};
