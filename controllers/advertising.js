const Advertisement = require('../models/Advertisement');
const Payment = require('../models/Payment');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');
const { sendAdRequestReceived, sendAdApproved, sendAdRejected, sendAdActivated } = require('../utils/notifications');

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

    console.log('📢 [Ads] Fetching ads with query:', JSON.stringify(query));
    console.log('📢 [Ads] Current time:', now);

    // Fetch ads sorted by priority (highest first), then by pricing tier
    const ads = await Advertisement.find(query)
      .sort({
        'settings.priority': -1,  // Priority first (10, 9, 8, 7...)
        'pricing.amount': -1,      // Then by price (higher paying first)
        createdAt: -1              // Finally by recency
      })
      .limit(parseInt(limit));

    console.log(`📢 [Ads] Found ${ads.length} ads before filtering`);

    // Manual filter for impression/click caps (don't use isActive method)
    const activeAds = ads.filter(ad => {
      const maxImpressions = ad.settings?.maxImpressions;
      const maxClicks = ad.settings?.maxClicks;
      const impressions = ad.analytics?.impressions || 0;
      const clicks = ad.analytics?.clicks || 0;

      return (!maxImpressions || impressions < maxImpressions) &&
             (!maxClicks || clicks < maxClicks);
    });

    console.log(`📢 [Ads] ${activeAds.length} ads after filtering caps`);
    if (activeAds.length > 0) {
      console.log('📢 [Ads] Returning ads:', activeAds.map(ad => ({
        id: ad._id,
        title: ad.title,
        placement: ad.placement,
        hasMedia: ad.mediaFiles?.length > 0
      })));
    }

    // Implement weighted rotation for premium ads
    // Give premium ads (enterprise/professional) more weight
    const weightedAds = [];
    activeAds.forEach(ad => {
      const plan = ad.pricing?.plan || 'starter';
      let weight = 1;

      // Weight based on pricing tier
      if (plan === 'enterprise' || plan === 'custom') {
        weight = 3; // Appear 3x more often
      } else if (plan === 'professional') {
        weight = 2; // Appear 2x more often
      }

      // Add ad multiple times based on weight
      for (let i = 0; i < weight; i++) {
        weightedAds.push(ad);
      }
    });

    res.json({
      success: true,
      ads: activeAds,           // Return unique ads for display
      weightedAds: weightedAds, // Return weighted array for rotation
      count: activeAds.length
    });
  } catch (error) {
    console.error('❌ Ad fetch error:', error);
    next(error);
  }
};

/**
 * Create advertisement request (from Advertise form)
 * Public route - allows non-logged-in users to submit
 */
exports.createAdRequest = async (req, res, next) => {
  try {
    const {
      name,
      email,
      company,
      phone,
      title,
      description,
      targetUrl,
      placement,
      category,
      startDate,
      endDate,
      plan,
      amount,
      basePlanAmount,
      videoAddonAmount,
      mediaFiles,
      videoDuration,
      videoTier,
      message,
      paymentOrderId
    } = req.body;

    // Validation
    if (!name || !email || !title || !targetUrl || !placement || !startDate || !endDate || !plan || !amount) {
      throw new BadRequestError('Missing required fields');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new BadRequestError('End date must be after start date');
    }

    // Determine status based on server-verified payment (never trust client-sent paymentStatus)
    let isPaid = false;
    let verifiedPayment = null;
    if (paymentOrderId) {
      verifiedPayment = await Payment.findOne({
        orderId: paymentOrderId,
        status: 'completed',
        paymentType: 'advertising'
      }).select('user amount status paymentType');

      // Paid ads must be tied to an authenticated user to prevent spoofing
      if (verifiedPayment && req.user && (String(verifiedPayment.user) === String(req.user._id) || req.user?.role === 'admin')) {
        isPaid = true;
      }
    }

    const adStatus = isPaid ? 'active' : 'pending';
    const adPaymentStatus = isPaid ? 'paid' : 'unpaid';

    const advertisement = new Advertisement({
      advertiser: {
        userId: req.user?._id, // Optional - if logged in
        name,
        email,
        company,
        phone
      },
      title,
      description,
      targetUrl,
      placement,
      category,
      startDate: start,
      endDate: end,
      pricing: {
        plan,
        amount,
        basePlanAmount: basePlanAmount || amount,
        videoAddonAmount: videoAddonAmount || 0,
        billingCycle: 'monthly'
      },
      mediaFiles: mediaFiles || [],
      imageUrl: mediaFiles && mediaFiles.length > 0 ? mediaFiles[0] : null,
      videoDuration: videoDuration || 0,
      videoTier: videoTier || null,
      status: adStatus,
      paymentStatus: adPaymentStatus,
      paymentDetails: isPaid ? {
        method: 'paypal',
        transactionId: paymentOrderId,
        paidAt: new Date(),
      } : undefined,
      adminNotes: message || '',
      createdBy: req.user?._id
    });

    await advertisement.save();

    // Send appropriate email based on payment status
    try {
      if (isPaid) {
        // Send activation email for paid ads
        await sendAdActivated(advertisement.advertiser, advertisement);
        console.log(`✅ Advertisement auto-activated: ${advertisement._id} (Paid: ${paymentOrderId})`);
      } else {
        // Send request received email for unpaid ads
        await sendAdRequestReceived(advertisement.advertiser, advertisement);
      }
    } catch (emailError) {
      console.error('❌ Failed to send ad email:', emailError);
      // Don't fail the request if email fails
    }

    const responseMessage = isPaid
      ? 'Advertisement is now live! Your ad is being displayed to users.'
      : 'Advertisement request submitted successfully. Our team will review and contact you within 24 hours.';

    res.status(201).json({
      success: true,
      message: responseMessage,
      advertisement: {
        _id: advertisement._id,
        status: advertisement.status,
        paymentStatus: advertisement.paymentStatus,
        isPaid: isPaid
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get my advertisements (for logged-in advertisers)
 */
exports.getMyAds = async (req, res, next) => {
  try {
    const ads = await Advertisement.find({
      $or: [
        { 'advertiser.userId': req.user._id },
        { 'advertiser.email': req.user.email }
      ]
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      ads,
      count: ads.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single advertisement by ID
 */
exports.getAdById = async (req, res, next) => {
  try {
    const ad = await Advertisement.findById(req.params.id);

    if (!ad) {
      throw new NotFoundError('Advertisement not found');
    }

    // Check ownership or admin
    const isOwner = req.user && (
      String(ad.advertiser.userId) === String(req.user._id) ||
      ad.advertiser.email === req.user.email
    );

    if (!isOwner && req.user?.role !== 'admin') {
      throw new ForbiddenError('Access denied');
    }

    res.json({
      success: true,
      ad
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Track ad impression
 * Public route - called when ad is displayed
 */
exports.trackImpression = async (req, res, next) => {
  try {
    const ad = await Advertisement.findById(req.params.id);

    if (!ad) {
      return res.json({ success: false });
    }

    await ad.recordImpression();

    res.json({ success: true });
  } catch (error) {
    // Silent fail for analytics
    res.json({ success: false });
  }
};

/**
 * Track ad click
 * Public route - called when ad is clicked
 */
exports.trackClick = async (req, res, next) => {
  try {
    const ad = await Advertisement.findById(req.params.id);

    if (!ad) {
      return res.json({ success: false });
    }

    await ad.recordClick();

    res.json({ success: true });
  } catch (error) {
    // Silent fail for analytics
    res.json({ success: false });
  }
};

/**
 * ADMIN: Get all advertisements
 */
exports.adminGetAllAds = async (req, res, next) => {
  try {
    const { status, placement, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (placement) query.placement = placement;

    const skip = (page - 1) * limit;

    const [ads, total] = await Promise.all([
      Advertisement.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('createdBy', 'firstName lastName email')
        .populate('approvedBy', 'firstName lastName email'),
      Advertisement.countDocuments(query)
    ]);

    res.json({
      success: true,
      ads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ADMIN: Update advertisement status
 */
exports.adminUpdateAdStatus = async (req, res, next) => {
  try {
    const { status, adminNotes, rejectionReason } = req.body;

    const ad = await Advertisement.findById(req.params.id);

    if (!ad) {
      throw new NotFoundError('Advertisement not found');
    }

    const previousStatus = ad.status;
    ad.status = status;

    if (adminNotes) {
      ad.adminNotes = adminNotes;
    }

    if (status === 'rejected' && rejectionReason) {
      ad.rejectionReason = rejectionReason;
    }

    if (status === 'approved') {
      ad.approvedBy = req.user._id;
      ad.approvedAt = new Date();
    }

    await ad.save();

    // Send email notifications based on status change
    try {
      if (status === 'approved' && previousStatus !== 'approved') {
        await sendAdApproved(ad.advertiser, ad);
      } else if (status === 'rejected' && previousStatus !== 'rejected') {
        await sendAdRejected(ad.advertiser, ad, rejectionReason || ad.rejectionReason);
      } else if (status === 'active' && previousStatus !== 'active') {
        await sendAdActivated(ad.advertiser, ad);
      }
    } catch (emailError) {
      console.error('❌ Failed to send ad status email:', emailError);
      // Don't fail the status update if email fails
    }

    res.json({
      success: true,
      message: `Advertisement ${status}`,
      ad
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ADMIN: Update advertisement details
 */
exports.adminUpdateAd = async (req, res, next) => {
  try {
    const allowedUpdates = [
      'title', 'description', 'callToAction', 'targetUrl', 'imageUrl', 'videoUrl',
      'placement', 'category', 'startDate', 'endDate', 'settings', 'adminNotes'
    ];

    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const ad = await Advertisement.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!ad) {
      throw new NotFoundError('Advertisement not found');
    }

    res.json({
      success: true,
      message: 'Advertisement updated',
      ad
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ADMIN: Delete advertisement
 */
exports.adminDeleteAd = async (req, res, next) => {
  try {
    const ad = await Advertisement.findByIdAndDelete(req.params.id);

    if (!ad) {
      throw new NotFoundError('Advertisement not found');
    }

    res.json({
      success: true,
      message: 'Advertisement deleted'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Complete payment for approved ad
 * Authenticated route - advertiser completes payment after approval
 */
exports.completeAdPayment = async (req, res, next) => {
  try {
    const { orderId, paypalData } = req.body;

    const ad = await Advertisement.findById(req.params.id);

    if (!ad) {
      throw new NotFoundError('Advertisement not found');
    }

    // Verify ownership
    const isOwner = (ad.advertiser.userId && ad.advertiser.userId.toString() === req.user._id.toString()) ||
                    (ad.advertiser.email === req.user.email);

    if (!isOwner) {
      throw new ForbiddenError('Not authorized to pay for this advertisement');
    }

    // Check if ad is approved
    if (ad.status !== 'approved') {
      throw new BadRequestError('Advertisement must be approved before payment');
    }

    // Update payment details
    ad.paymentDetails = {
      transactionId: orderId,
      paidAt: new Date(),
      method: 'paypal',
      paypalData
    };
    ad.paymentStatus = 'paid';
    ad.status = 'active'; // Activate the ad

    await ad.save();

    // Send activation email
    try {
      await sendAdActivated(ad.advertiser, ad);
    } catch (emailError) {
      console.error('❌ Failed to send ad activation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Payment completed successfully. Your ad is now active!',
      ad
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ADMIN: Get advertisement analytics summary
 */
exports.adminGetAnalytics = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const dateFilter = {};
    if (startDate) dateFilter.startDate = { $gte: new Date(startDate) };
    if (endDate) dateFilter.endDate = { $lte: new Date(endDate) };

    const [
      totalAds,
      activeAds,
      pendingAds,
      totalRevenue,
      performanceData
    ] = await Promise.all([
      Advertisement.countDocuments(),
      Advertisement.countDocuments({ status: 'active' }),
      Advertisement.countDocuments({ status: 'pending' }),
      Advertisement.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$pricing.amount' } } }
      ]),
      Advertisement.aggregate([
        { $match: { status: { $in: ['active', 'completed'] } } },
        {
          $group: {
            _id: null,
            totalImpressions: { $sum: '$analytics.impressions' },
            totalClicks: { $sum: '$analytics.clicks' }
          }
        }
      ])
    ]);

    const revenue = totalRevenue[0]?.total || 0;
    const performance = performanceData[0] || { totalImpressions: 0, totalClicks: 0 };
    const avgCTR = performance.totalImpressions > 0
      ? ((performance.totalClicks / performance.totalImpressions) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      analytics: {
        totalAds,
        activeAds,
        pendingAds,
        revenue,
        impressions: performance.totalImpressions,
        clicks: performance.totalClicks,
        avgCTR: parseFloat(avgCTR)
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: Create advertisement without payment
 * Bypasses payment requirements for admin-created ads
 */
exports.adminCreateAd = async (req, res, next) => {
  try {
    const {
      name,
      email,
      company,
      phone,
      title,
      description,
      targetUrl,
      placement,
      category,
      startDate,
      endDate,
      plan,
      amount,
      basePlanAmount,
      videoAddonAmount,
      mediaFiles,
      videoDuration,
      videoTier,
      message
    } = req.body;

    // Validation
    if (!name || !email || !title || !targetUrl || !placement || !startDate || !endDate || !plan) {
      throw new BadRequestError('Missing required fields');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new BadRequestError('End date must be after start date');
    }

    const advertisement = new Advertisement({
      advertiser: {
        userId: req.user?._id,
        name,
        email,
        company,
        phone
      },
      title,
      description,
      targetUrl,
      placement,
      category,
      startDate: start,
      endDate: end,
      pricing: {
        plan,
        amount: amount || 0,
        basePlanAmount: basePlanAmount || amount || 0,
        videoAddonAmount: videoAddonAmount || 0,
        billingCycle: 'monthly'
      },
      mediaFiles: mediaFiles || [],
      imageUrl: mediaFiles && mediaFiles.length > 0 ? mediaFiles[0] : null,
      videoDuration: videoDuration || 0,
      videoTier: videoTier || null,
      status: 'active', // Admin-created ads are active immediately
      paymentStatus: 'paid', // Mark as paid (admin bypass)
      paymentDetails: {
        method: 'admin',
        transactionId: `ADMIN_${Date.now()}`,
        paidAt: new Date()
      },
      adminNotes: `Admin created: ${message || 'No notes'}`,
      createdBy: req.user._id
    });

    await advertisement.save();

    console.log(`✅ Admin created advertisement: ${advertisement._id} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Advertisement created and activated successfully (admin bypass)',
      advertisement: {
        _id: advertisement._id,
        status: advertisement.status,
        paymentStatus: advertisement.paymentStatus
      }
    });
  } catch (error) {
    next(error);
  }
};
