const Advertisement = require("../models/Advertisement");
const Payment = require("../models/Payment");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");
const {
  sendAdRequestReceived,
  sendAdApproved,
  sendAdRejected,
  sendAdActivated,
} = require("../utils/notifications");

// Cloud storage cleanup (GCS) is handled by bucket lifecycle/IAM policies.
// Keep a no-op helper to preserve existing controller flow.
const destroyMediaAsset = async () => {};

const normalizeMediaFiles = (mediaFiles = []) => {
  if (!Array.isArray(mediaFiles)) return [];

  return mediaFiles
    .map((file) => {
      if (!file) return null;

      if (typeof file === "string") {
        const isVideo = file.startsWith("data:video") || file.includes("/videos/");
        return {
          url: file,
          type: isVideo ? "video" : "image",
          uploadedAt: new Date(),
        };
      }

      if (typeof file === "object") {
        const url = file.url || file.src || file.imageUrl || file.videoUrl || file.path;
        if (!url) return null;

        const inferredType =
          file.type ||
          (file.mimetype && file.mimetype.startsWith("video/") ? "video" : null) ||
          (file.videoUrl ? "video" : "image");

        return {
          filename: file.filename || file.name,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          url,
          gcsObjectName: file.gcsObjectName || file.public_id || null,
          type: inferredType,
          duration: file.duration || file.videoDuration,
          uploadedAt: file.uploadedAt ? new Date(file.uploadedAt) : new Date(),
        };
      }

      return null;
    })
    .filter(Boolean);
};

/**
 * Get active advertisements for a specific placement
 * Public route - used to display ads on frontend
 * Supports both single placement and package-based multiple placements
 */
exports.getActiveAds = async (req, res, next) => {
  try {
    const { placement, category, limit = 5 } = req.query;

    const now = new Date();
    const query = {
      status: "active",
      startDate: { $lte: now },
      endDate: { $gte: now },
    };

    if (placement) {
      // Support both new placements array and legacy single placement field
      query.$or = [
        { placements: placement }, // New: ad has this placement in its array
        { placement: placement }, // Legacy: ad uses single placement field
      ];
    }

    if (category) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [{ category: category }, { category: { $exists: false } }],
      });
    }

    console.log("📢 [Ads] Fetching ads with query:", JSON.stringify(query));
    console.log("📢 [Ads] Current time:", now);

    // Fetch ads sorted by priority (highest first), then by pricing tier
    const ads = await Advertisement.find(query)
      .sort({
        "settings.priority": -1, // Priority first (10, 9, 8, 7...)
        "pricing.amount": -1, // Then by price (higher paying first)
        createdAt: -1, // Finally by recency
      })
      .limit(parseInt(limit));

    console.log(`📢 [Ads] Found ${ads.length} ads before filtering`);

    // Manual filter for impression/click caps (don't use isActive method)
    const activeAds = ads.filter((ad) => {
      const maxImpressions = ad.settings?.maxImpressions;
      const maxClicks = ad.settings?.maxClicks;
      const impressions = ad.analytics?.impressions || 0;
      const clicks = ad.analytics?.clicks || 0;

      return (
        (!maxImpressions || impressions < maxImpressions) && (!maxClicks || clicks < maxClicks)
      );
    });

    console.log(`📢 [Ads] ${activeAds.length} ads after filtering caps`);
    if (activeAds.length > 0) {
      console.log(
        "📢 [Ads] Returning ads:",
        activeAds.map((ad) => ({
          id: ad._id,
          title: ad.title,
          placement: ad.placement,
          hasMedia: ad.mediaFiles?.length > 0,
        }))
      );
    }

    // Implement weighted rotation for premium ads
    // Give premium ads (enterprise/professional) more weight
    const weightedAds = [];
    activeAds.forEach((ad) => {
      const plan = ad.pricing?.plan || "starter";
      let weight = 1;

      // Weight based on pricing tier
      if (plan === "enterprise" || plan === "custom") {
        weight = 3; // Appear 3x more often
      } else if (plan === "professional") {
        weight = 2; // Appear 2x more often
      }

      // Add ad multiple times based on weight
      for (let i = 0; i < weight; i++) {
        weightedAds.push(ad);
      }
    });

    const sanitizeAd = (adDoc) => {
      if (!adDoc) return adDoc;
      const ad = typeof adDoc.toObject === "function" ? adDoc.toObject() : adDoc;

      // Google Cloud Storage URLs are already public and safe to expose
      return {
        ...ad,
        mediaFiles: ad.mediaFiles,
        imageUrl: ad.imageUrl,
        videoUrl: ad.videoUrl,
        primaryMediaUrl: ad.primaryMediaUrl,
        thumbnailUrl: ad.thumbnailUrl,
      };
    };

    res.json({
      success: true,
      ads: activeAds.map(sanitizeAd), // Return unique ads for display
      weightedAds: weightedAds.map(sanitizeAd), // Return weighted array for rotation
      count: activeAds.length,
    });
  } catch (error) {
    console.error("❌ Ad fetch error:", error);
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
      paymentOrderId,
    } = req.body;

    // Validation
    if (
      !name ||
      !email ||
      !title ||
      !targetUrl ||
      !placement ||
      !startDate ||
      !endDate ||
      !plan ||
      !amount
    ) {
      throw new BadRequestError("Missing required fields");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new BadRequestError("End date must be after start date");
    }

    // Determine status based on server-verified payment (never trust client-sent paymentStatus)
    let isPaid = false;
    let verifiedPayment = null;
    if (paymentOrderId) {
      verifiedPayment = await Payment.findOne({
        orderId: paymentOrderId,
        status: "completed",
        paymentType: "advertising",
      }).select("user amount status paymentType");

      // Paid ads must be tied to an authenticated user to prevent spoofing
      if (
        verifiedPayment &&
        req.user &&
        (String(verifiedPayment.user) === String(req.user._id) || req.user?.role === "admin")
      ) {
        isPaid = true;
      }
    }

    const adStatus = isPaid ? "active" : "pending";
    const adPaymentStatus = isPaid ? "paid" : "unpaid";

    const normalizedMediaFiles = normalizeMediaFiles(mediaFiles);
    const primaryMedia = normalizedMediaFiles[0] || null;
    const primaryImageUrl =
      primaryMedia?.type === "image"
        ? primaryMedia.url
        : normalizedMediaFiles.find((f) => f.type === "image")?.url || null;
    const primaryVideoUrl =
      primaryMedia?.type === "video"
        ? primaryMedia.url
        : normalizedMediaFiles.find((f) => f.type === "video")?.url || null;

    const primaryImageGcsId =
      primaryMedia?.type === "image"
        ? primaryMedia.gcsObjectName
        : normalizedMediaFiles.find((f) => f.type === "image")?.gcsObjectName || null;
    const primaryVideoGcsId =
      primaryMedia?.type === "video"
        ? primaryMedia.gcsObjectName
        : normalizedMediaFiles.find((f) => f.type === "video")?.gcsObjectName || null;
    const derivedVideoDuration = normalizedMediaFiles.find(
      (file) => file.type === "video" && Number.isFinite(file.duration)
    )?.duration;

    // Use backend-detected duration (validated during upload phase)
    let validatedDuration = videoDuration || derivedVideoDuration || 0;
    let requiresManualReview = false;
    let validationNotes = "";

    // Duration is now validated during /upload-video endpoint, so no additional validation needed here

    const advertisement = new Advertisement({
      advertiser: {
        userId: req.user?._id, // Optional - if logged in
        name,
        email,
        company,
        phone,
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
        billingCycle: "monthly",
      },
      mediaFiles: normalizedMediaFiles,
      imageUrl: primaryImageUrl,
      videoUrl: primaryVideoUrl,
      imageGcsId: primaryImageGcsId,
      videoGcsId: primaryVideoGcsId,
      videoDuration: validatedDuration,
      videoTier: videoTier || null,
      status: requiresManualReview && isPaid ? "pending" : adStatus, // Override active status if needs review
      paymentStatus: adPaymentStatus,
      paymentDetails: isPaid
        ? {
            method: "paypal",
            transactionId: paymentOrderId,
            paidAt: new Date(),
          }
        : undefined,
      adminNotes: validationNotes
        ? `${validationNotes}${message ? " | " + message : ""}`
        : message || "",
      createdBy: req.user?._id,
    });

    await advertisement.save();

    // Send appropriate email based on payment status
    try {
      if (isPaid) {
        // Send activation email for paid ads
        await sendAdActivated(advertisement.advertiser, advertisement);
        console.log(
          `✅ Advertisement auto-activated: ${advertisement._id} (Paid: ${paymentOrderId})`
        );
      } else {
        // Send request received email for unpaid ads
        await sendAdRequestReceived(advertisement.advertiser, advertisement);
      }
    } catch (emailError) {
      console.error("❌ Failed to send ad email:", emailError);
      // Don't fail the request if email fails
    }

    const responseMessage = isPaid
      ? "Advertisement is now live! Your ad is being displayed to users."
      : "Advertisement request submitted successfully. Our team will review and contact you within 24 hours.";

    res.status(201).json({
      success: true,
      message: responseMessage,
      advertisement: {
        _id: advertisement._id,
        status: advertisement.status,
        paymentStatus: advertisement.paymentStatus,
        isPaid: isPaid,
      },
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
      $or: [{ "advertiser.userId": req.user._id }, { "advertiser.email": req.user.email }],
    }).sort({ createdAt: -1 });

    res.json({
      success: true,
      ads,
      count: ads.length,
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
      throw new NotFoundError("Advertisement not found");
    }

    // Check ownership or admin
    const isOwner =
      req.user &&
      (String(ad.advertiser.userId) === String(req.user._id) ||
        ad.advertiser.email === req.user.email);

    if (!isOwner && req.user?.role !== "admin") {
      throw new ForbiddenError("Access denied");
    }

    res.json({
      success: true,
      ad,
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
        .populate("createdBy", "firstName lastName email")
        .populate("approvedBy", "firstName lastName email"),
      Advertisement.countDocuments(query),
    ]);

    res.json({
      success: true,
      ads,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
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
      throw new NotFoundError("Advertisement not found");
    }

    const previousStatus = ad.status;
    ad.status = status;

    if (adminNotes) {
      ad.adminNotes = adminNotes;
    }

    if (status === "rejected" && rejectionReason) {
      ad.rejectionReason = rejectionReason;
    }

    if (status === "approved") {
      ad.approvedBy = req.user._id;
      ad.approvedAt = new Date();
    }

    await ad.save();

    // Send email notifications based on status change
    try {
      if (status === "approved" && previousStatus !== "approved") {
        await sendAdApproved(ad.advertiser, ad);
      } else if (status === "rejected" && previousStatus !== "rejected") {
        await sendAdRejected(ad.advertiser, ad, rejectionReason || ad.rejectionReason);
      } else if (status === "active" && previousStatus !== "active") {
        await sendAdActivated(ad.advertiser, ad);
      }
    } catch (emailError) {
      console.error("❌ Failed to send ad status email:", emailError);
      // Don't fail the status update if email fails
    }

    res.json({
      success: true,
      message: `Advertisement ${status}`,
      ad,
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
      "title",
      "description",
      "callToAction",
      "targetUrl",
      "imageUrl",
      "videoUrl",
      "imageGcsId",
      "videoGcsId",
      "mediaFiles",
      "placement",
      "category",
      "startDate",
      "endDate",
      "settings",
      "adminNotes",
    ];

    const existing = await Advertisement.findById(req.params.id);
    if (!existing) {
      throw new NotFoundError("Advertisement not found");
    }

    const oldIds = new Set(
      [
        existing.imageGcsId,
        existing.videoGcsId,
        ...(existing.mediaFiles || []).map((f) => f?.gcsObjectName),
      ].filter(Boolean)
    );

    const updates = {};
    Object.keys(req.body).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (updates.mediaFiles) {
      const normalizedMediaFiles = normalizeMediaFiles(updates.mediaFiles);
      updates.mediaFiles = normalizedMediaFiles;

      const primaryMedia = normalizedMediaFiles[0] || null;
      if (!updates.imageUrl) {
        updates.imageUrl =
          (primaryMedia?.type === "image" ? primaryMedia.url : null) ||
          normalizedMediaFiles.find((f) => f.type === "image")?.url ||
          null;
      }
      if (!updates.videoUrl) {
        updates.videoUrl =
          (primaryMedia?.type === "video" ? primaryMedia.url : null) ||
          normalizedMediaFiles.find((f) => f.type === "video")?.url ||
          null;
      }

      if (!updates.imageGcsId) {
        updates.imageGcsId =
          (primaryMedia?.type === "image" ? primaryMedia.gcsObjectName : null) ||
          normalizedMediaFiles.find((f) => f.type === "image")?.gcsObjectName ||
          null;
      }
      if (!updates.videoGcsId) {
        updates.videoGcsId =
          (primaryMedia?.type === "video" ? primaryMedia.gcsObjectName : null) ||
          normalizedMediaFiles.find((f) => f.type === "video")?.gcsObjectName ||
          null;
      }
    }

    const ad = await Advertisement.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    const newIds = new Set(
      [
        ad?.imageCloudinaryId,
        ad?.videoCloudinaryId,
        ...(ad?.mediaFiles || []).map((f) => f?.cloudinaryId),
      ].filter(Boolean)
    );

    // Delete any Cloudinary assets that were removed/replaced.
    for (const oldId of oldIds) {
      if (!newIds.has(oldId)) {
        // Try as video first (common), then image.
        // Cloudinary will ignore mismatched type errors in best-effort manner.
        // eslint-disable-next-line no-await-in-loop
        await destroyMediaAsset(oldId, "video");
        // eslint-disable-next-line no-await-in-loop
        await destroyMediaAsset(oldId, "image");
      }
    }

    res.json({
      success: true,
      message: "Advertisement updated",
      ad,
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
    const ad = await Advertisement.findById(req.params.id);

    if (!ad) {
      throw new NotFoundError("Advertisement not found");
    }

    const idsToDelete = [
      ad.imageCloudinaryId,
      ad.videoCloudinaryId,
      ...(ad.mediaFiles || []).map((f) => f?.cloudinaryId),
    ].filter(Boolean);

    for (const id of idsToDelete) {
      // eslint-disable-next-line no-await-in-loop
      await destroyMediaAsset(id, "video");
      // eslint-disable-next-line no-await-in-loop
      await destroyMediaAsset(id, "image");
    }

    await Advertisement.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: "Advertisement deleted",
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
      throw new NotFoundError("Advertisement not found");
    }

    // Verify ownership
    const isOwner =
      (ad.advertiser.userId && ad.advertiser.userId.toString() === req.user._id.toString()) ||
      ad.advertiser.email === req.user.email;

    if (!isOwner) {
      throw new ForbiddenError("Not authorized to pay for this advertisement");
    }

    // Check if ad is approved
    if (ad.status !== "approved") {
      throw new BadRequestError("Advertisement must be approved before payment");
    }

    // Update payment details
    ad.paymentDetails = {
      transactionId: orderId,
      paidAt: new Date(),
      method: "paypal",
      paypalData,
    };
    ad.paymentStatus = "paid";
    ad.status = "active"; // Activate the ad

    await ad.save();

    // Send activation email
    try {
      await sendAdActivated(ad.advertiser, ad);
    } catch (emailError) {
      console.error("❌ Failed to send ad activation email:", emailError);
    }

    res.json({
      success: true,
      message: "Payment completed successfully. Your ad is now active!",
      ad,
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

    const [totalAds, activeAds, pendingAds, totalRevenue, performanceData] = await Promise.all([
      Advertisement.countDocuments(),
      Advertisement.countDocuments({ status: "active" }),
      Advertisement.countDocuments({ status: "pending" }),
      Advertisement.aggregate([
        { $match: { paymentStatus: "paid" } },
        { $group: { _id: null, total: { $sum: "$pricing.amount" } } },
      ]),
      Advertisement.aggregate([
        { $match: { status: { $in: ["active", "completed"] } } },
        {
          $group: {
            _id: null,
            totalImpressions: { $sum: "$analytics.impressions" },
            totalClicks: { $sum: "$analytics.clicks" },
          },
        },
      ]),
    ]);

    const revenue = totalRevenue[0]?.total || 0;
    const performance = performanceData[0] || { totalImpressions: 0, totalClicks: 0 };
    const avgCTR =
      performance.totalImpressions > 0
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
        avgCTR: parseFloat(avgCTR),
      },
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
      package: packageType, // Support package-based ads
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
    } = req.body;

    // Validation - support both placement and package
    if (
      !name ||
      !email ||
      !title ||
      !targetUrl ||
      (!placement && !packageType) ||
      !startDate ||
      !endDate ||
      !plan
    ) {
      throw new BadRequestError("Missing required fields");
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start >= end) {
      throw new BadRequestError("End date must be after start date");
    }

    const normalizedMediaFiles = normalizeMediaFiles(mediaFiles);
    const primaryMedia = normalizedMediaFiles[0] || null;
    const primaryImageUrl =
      primaryMedia?.type === "image"
        ? primaryMedia.url
        : normalizedMediaFiles.find((f) => f.type === "image")?.url || null;
    const primaryVideoUrl =
      primaryMedia?.type === "video"
        ? primaryMedia.url
        : normalizedMediaFiles.find((f) => f.type === "video")?.url || null;

    const primaryImageGcsId =
      primaryMedia?.type === "image"
        ? primaryMedia.gcsObjectName
        : normalizedMediaFiles.find((f) => f.type === "image")?.gcsObjectName || null;
    const primaryVideoGcsId =
      primaryMedia?.type === "video"
        ? primaryMedia.gcsObjectName
        : normalizedMediaFiles.find((f) => f.type === "video")?.gcsObjectName || null;
    const derivedVideoDuration = normalizedMediaFiles.find(
      (file) => file.type === "video" && Number.isFinite(file.duration)
    )?.duration;

    // Use backend-detected duration (validated during upload phase)
    let validatedDuration = videoDuration || derivedVideoDuration || 0;
    let validationWarning = "";

    // Duration is now validated during /upload-video endpoint, so no additional validation needed

    // Determine placements array based on package type
    let placements = [];
    let adPackage = "basic";

    if (packageType) {
      // New package-based system
      if (packageType === "basic") {
        placements = ["homepage-banner"];
        adPackage = "basic";
      } else if (packageType === "standard") {
        placements = ["homepage-banner", "footer-banner"];
        adPackage = "standard";
      } else if (packageType === "premium") {
        placements = ["homepage-banner", "listing-feed", "talent-feed", "business-leaders"];
        adPackage = "premium";
      }
    } else {
      // Legacy single placement system
      placements = [placement];
      adPackage = "basic";
    }

    const advertisement = new Advertisement({
      advertiser: {
        userId: req.user?._id,
        name,
        email,
        company,
        phone,
      },
      title,
      description,
      targetUrl,
      package: adPackage,
      placements: placements,
      placement, // Legacy field for backwards compatibility
      category,
      startDate: start,
      endDate: end,
      pricing: {
        plan,
        amount: amount || 0,
        basePlanAmount: basePlanAmount || amount || 0,
        videoAddonAmount: videoAddonAmount || 0,
        billingCycle: "monthly",
      },
      mediaFiles: normalizedMediaFiles,
      imageUrl: primaryImageUrl,
      videoUrl: primaryVideoUrl,
      imageGcsId: primaryImageGcsId,
      videoGcsId: primaryVideoGcsId,
      videoDuration: validatedDuration,
      videoTier: videoTier || null,
      status: "active", // Admin-created ads are active immediately
      paymentStatus: "paid", // Mark as paid (admin bypass)
      paymentDetails: {
        method: "admin",
        transactionId: `ADMIN_${Date.now()}`,
        paidAt: new Date(),
      },
      adminNotes: validationWarning
        ? `${validationWarning} | ${message || "No notes"}`
        : `Admin created: ${message || "No notes"}`,
      createdBy: req.user._id,
    });

    await advertisement.save();

    console.log(`✅ Admin created advertisement: ${advertisement._id} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: "Advertisement created and activated successfully (admin bypass)",
      advertisement: {
        _id: advertisement._id,
        status: advertisement.status,
        paymentStatus: advertisement.paymentStatus,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Validate video duration (public endpoint for frontend to check before submission)
 */
/**
 * Handle video upload for advertising with duration detection
 * POST /api/advertising/upload-video
 */
exports.uploadAdvertisingVideo = async (req, res, next) => {
  try {
    console.log("🎬 Upload video request received");

    if (!req.file) {
      console.error("❌ No file in request");
      throw new BadRequestError("No video file uploaded");
    }

    const { detectVideoDuration, validateVideoFile } = require("../utils/videoProcessing");
    const { compressVideo, shouldCompressVideo } = require("../utils/videoCompression");
    const gcs = require("../utils/gcs");
    const fs = require("fs");
    const path = require("path");

    const videoFile = req.file;
    console.log("📹 Processing advertising video upload:", videoFile.originalname);

    // Validate video file
    const validation = validateVideoFile(videoFile);
    if (!validation.valid) {
      // Clean up uploaded file
      if (fs.existsSync(videoFile.path)) {
        fs.unlinkSync(videoFile.path);
      }
      throw new BadRequestError(validation.error);
    }

    // Detect video duration and immediately compress if > 15 seconds
    let duration = 0;
    let finalVideoPath = videoFile.path;
    let compressedPath = null;
    let originalSize = videoFile.size;
    let finalSize = videoFile.size;
    let compressed = false;

    // Try to detect duration (optional - will skip if ffmpeg not available)
    try {
      duration = await detectVideoDuration(videoFile.path);
      console.log(`✅ Video duration detected: ${duration} seconds`);

      // Immediately compress if > 15 seconds
      if (shouldCompressVideo(duration)) {
        console.log(`🎬 Video exceeds 15 seconds (${duration}s), attempting compression...`);
        try {
          const compressionResult = await compressVideo(videoFile.path, {
            maxWidth: 1280,
            videoBitrate: "1500k",
            audioBitrate: "128k",
            fps: 30,
            crf: 23,
          });

          compressedPath = compressionResult.outputPath;
          finalVideoPath = compressedPath;
          finalSize = compressionResult.compressedSize;
          compressed = true;

          console.log(
            `✅ Video compressed: ${(originalSize / 1024 / 1024).toFixed(2)}MB → ${(finalSize / 1024 / 1024).toFixed(2)}MB (${compressionResult.compressionRatio}% reduction)`
          );
        } catch (compressionError) {
          console.warn("⚠️ Compression failed:", compressionError.message);
          console.warn("⚠️ Continuing with original video (FFmpeg may not be installed)");
          finalVideoPath = videoFile.path;
          finalSize = originalSize;
        }
      } else {
        console.log(`✅ Video ≤15 seconds (${duration}s), no compression needed`);
      }
    } catch (durationError) {
      console.warn("⚠️ Duration detection failed:", durationError.message);
      console.warn("⚠️ Continuing without duration (FFmpeg may not be installed)");
      // Continue without duration - set to 0 and use original video
      duration = 0;
      finalVideoPath = videoFile.path;
      finalSize = originalSize;
    }

    // Upload to storage (GCS for production, local for development)
    let videoUrl;
    let objectName;
    const isProduction = process.env.NODE_ENV === "production";

    console.log(`📦 Storage mode: ${isProduction ? "production (GCS)" : "development (local)"}`);
    console.log(`📂 Final video path: ${finalVideoPath}`);
    console.log(`📂 Path exists: ${fs.existsSync(finalVideoPath)}`);

    if (!fs.existsSync(finalVideoPath)) {
      throw new Error(`Video file not found at path: ${finalVideoPath}`);
    }

    if (isProduction) {
      // Production: Upload to Google Cloud Storage
      try {
        const bucketName = gcs.getGcsBucketName();
        if (!bucketName) {
          throw new Error("GCS_BUCKET not configured");
        }

        // Build GCS object name
        objectName = gcs.buildObjectName({
          resourceType: "video",
          purpose: "commercial",
          filename: videoFile.originalname,
        });

        // Upload video to GCS
        videoUrl = await gcs.uploadFromPath({
          bucketName,
          objectName,
          localPath: finalVideoPath,
          contentType: videoFile.mimetype,
        });

        console.log("✅ Video uploaded to Google Cloud Storage:", objectName);
      } catch (uploadError) {
        console.error("❌ GCS upload failed:", uploadError);
        // Clean up all temp files
        if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
        throw new Error("Failed to upload video to cloud storage");
      }

      // Clean up all local temp files after successful upload
      try {
        if (fs.existsSync(videoFile.path)) fs.unlinkSync(videoFile.path);
        if (compressedPath && fs.existsSync(compressedPath)) fs.unlinkSync(compressedPath);
      } catch (cleanupError) {
        console.warn("⚠️ Failed to clean up temp files:", cleanupError);
      }
    } else {
      // Development: Use local storage
      console.log("📦 Using local storage (development mode)");
      const uploadDirDev = path.join(__dirname, "..", "uploads", "videos", "advertising");

      try {
        if (!fs.existsSync(uploadDirDev)) {
          console.log("📁 Creating directory:", uploadDirDev);
          fs.mkdirSync(uploadDirDev, { recursive: true });
        }

        const finalFilename = `advert-${Date.now()}-${path.basename(finalVideoPath)}`;
        const finalPath = path.join(uploadDirDev, finalFilename);

        console.log("📤 Moving video from", finalVideoPath, "to", finalPath);

        // Copy instead of rename to avoid cross-device link errors
        if (finalVideoPath !== finalPath) {
          fs.copyFileSync(finalVideoPath, finalPath);

          // Clean up temp files after successful copy
          if (fs.existsSync(videoFile.path)) {
            fs.unlinkSync(videoFile.path);
          }
          if (compressed && compressedPath && fs.existsSync(compressedPath)) {
            fs.unlinkSync(compressedPath);
          }
        }

        // Generate local URL
        videoUrl = `/uploads/videos/advertising/${finalFilename}`;
        objectName = finalFilename;

        console.log("✅ Video stored locally (development):", finalPath);
      } catch (storageError) {
        console.error("❌ Local storage failed:", storageError.message);
        console.error("Stack:", storageError.stack);
        throw new Error(`Failed to store video locally: ${storageError.message}`);
      }
    }

    // Return video info with detected duration
    res.json({
      success: true,
      videoUrl,
      gcsObjectName: objectName,
      duration,
      filename: videoFile.originalname,
      size: finalSize,
      originalSize: originalSize,
      compressed,
      mimetype: videoFile.mimetype,
    });
  } catch (error) {
    console.error("❌ Video upload error:", error.message);
    console.error("Error stack:", error.stack);
    // Try to clean up if files exist
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupErr) {
        console.warn("Failed to cleanup original:", cleanupErr);
      }
    }
    next(error);
  }
};
