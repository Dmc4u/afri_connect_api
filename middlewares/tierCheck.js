/**
 * Middleware to check user tier and enforce feature access
 * Ensures users only access features they paid for
 */

const { ForbiddenError } = require("../utils/errors");

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
    const userTier = req.user.tier || "Free";

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
    maxListings: 0,
    canCreateListings: false,
    canFeatureListing: false,
    canAccessAnalytics: false,
    maxPhotoGallery: 0,
    canSetLogo: false,
    canCustomizeProfile: false,
    supportResponseTime: "48hr",
    canAccessAPI: false,
    canRemoveBranding: false,
    canUseAdvancedSearch: false,
  },
  Starter: {
    maxListings: 5,
    canCreateListings: true,
    canFeatureListing: false,
    canAccessAnalytics: true, // Basic analytics
    maxPhotoGallery: 5,
    canSetLogo: true,
    canCustomizeProfile: true,
    supportResponseTime: "24hr",
    canAccessAPI: false,
    canRemoveBranding: false,
    canUseAdvancedSearch: true,
  },
  Premium: {
    maxListings: Infinity,
    canCreateListings: true,
    canFeatureListing: true, // Can mark listings as featured
    canAccessAnalytics: true, // Advanced analytics
    maxPhotoGallery: Infinity,
    canSetLogo: true,
    canCustomizeProfile: true,
    supportResponseTime: "12hr",
    canAccessAPI: true,
    canRemoveBranding: false, // Cannot remove branding
    canUseAdvancedSearch: true,
  },
  Pro: {
    maxListings: Infinity,
    canCreateListings: true,
    canFeatureListing: true,
    canAccessAnalytics: true, // Advanced analytics + custom reports
    maxPhotoGallery: Infinity,
    canSetLogo: true,
    canCustomizeProfile: true,
    canCustomizePageDesign: true, // Pro only: custom page design
    canAccessLeadGeneration: true, // Pro only: lead gen tools
    canAccessAdvancedAds: true, // Pro only: advanced advertising
    canGetVerifiedBadge: true, // Pro only: verified badge
    canAccessTopTierPlacement: true, // Pro only: top-tier featured
    canAccessDedicatedManager: true, // Pro only: account manager
    canAccessQuarterlyStrategy: true, // Pro only: strategy calls
    canGetFeaturedInNewsletters: true, // Pro only: newsletter feature
    canAccessCrossPlatformPromo: true, // Pro only: cross-platform
    supportResponseTime: "24/7",
    canAccessAPI: true,
    canRemoveBranding: true, // Can remove AfriOnet branding
    canUseAdvancedSearch: true,
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
