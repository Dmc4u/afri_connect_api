const Advertisement = require('../models/Advertisement');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

/**
 * Get active advertisements for a specific placement
 * Public route - used to display ads on frontend
 */
exports.getActiveAds = async (req, res, next) => {
  try {
    const { placement, category, limit = 5 } = req.query;

    const now = new Date();
    const query = {
      status: 'active',
      startDate: { $lte: now },
      endDate: { $gte: now }
    };

    if (placement) {
      query.placement = placement;
    }

    if (category) {
      query.$or = [
        { category: category },
        { category: { $exists: false } }
      ];
    }

    const ads = await Advertisement.find(query)
      .sort({ 'settings.priority': -1, createdAt: -1 })
      .limit(parseInt(limit));

    // Simple filter for impression/click caps
    const activeAds = ads.filter(ad => {
      const maxImpressions = ad.settings?.maxImpressions;
      const maxClicks = ad.settings?.maxClicks;
      const impressions = ad.analytics?.impressions || 0;
      const clicks = ad.analytics?.clicks || 0;

      return (!maxImpressions || impressions < maxImpressions) &&
             (!maxClicks || clicks < maxClicks);
    });

    res.json({
      success: true,
      ads: activeAds,
      count: activeAds.length
    });
  } catch (error) {
    console.error('Ad fetch error:', error);
    next(error);
  }
};

module.exports = exports;
