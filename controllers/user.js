const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");
const { RECENT_VIEWS_MAX, RECENT_VIEWS_TTL_DAYS } = require("../utils/config");
const Listing = require("../models/Listing");
const { isAdminEmail } = require("../utils/adminCheck");
const { logActivity } = require("../utils/activityLogger");
const {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");

// GET /users/me - Get current user
const getCurrentUser = (req, res, next) =>
  User.findById(req.user._id)
    .orFail(() => new NotFoundError("User not found"))
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send(userObj);
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid ID format"));
      }
      return next(err);
    });

// POST /signup - Create user
const createUser = (req, res, next) => {
  const { name, email, phone, country, password } = req.body;

  if (!name || !email || !phone || !password) {
    return next(new BadRequestError("Name, email, phone, and password are required"));
  }

  return bcrypt
    .hash(password, 10)
    .then((hash) => {
      // Determine role based on ADMIN_EMAILS configuration
      const role = isAdminEmail(email) ? "admin" : "user";
      return User.create({ name, email, phone, country, password: hash, role });
    })
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;

      // Log user registration activity
      logActivity({
        type: "user_registered",
        description: `New user registered: ${name} (${email})`,
        userId: user._id,
        userName: name,
        userEmail: email,
        action: "create",
        targetType: "user",
        targetId: user._id,
        details: { email, phone, country },
      });

      // Generate token for immediate login after signup
      const token = jwt.sign({ _id: user._id }, JWT_SECRET, { expiresIn: "7d" });

      return res.status(201).send({
        user: userObj,
        token: token,
      });
    })
    .catch((err) => {
      if (err.code === 11000) {
        return next(new ConflictError("User with this email already exists"));
      }
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
};

// POST /signin - Login
const login = (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new BadRequestError("Email and password are required"));
  }

  return User.findUserByCredentials(email, password)
    .then(async (user) => {
      // Sync role with ADMIN_EMAILS configuration
      const expectedRole = isAdminEmail(user.email) ? "admin" : "user";
      if (user.role !== expectedRole) {
        user.role = expectedRole;
        await user.save();
      }

      const userObj = user.toObject();
      delete userObj.password;

      return res.send({
        user: userObj,
        token: jwt.sign({ _id: user._id }, JWT_SECRET, { expiresIn: "7d" }),
      });
    })
    .catch((err) => {
      if (err.message === "Incorrect email or password") {
        return next(new UnauthorizedError("Incorrect email or password"));
      }
      return next(err);
    });
};

// PATCH /users/me - Update user name
const updateUser = (req, res, next) => {
  const { name } = req.body;

  if (!name) {
    return next(new BadRequestError("Name is required"));
  }

  return User.findByIdAndUpdate(req.user._id, { name }, { new: true, runValidators: true })
    .orFail(() => new NotFoundError("User not found"))
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      delete userObj.email;
      return res.send(userObj);
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
};

// PATCH /users/me/photo - Update profile photo (Starter+)
const updateUserPhoto = (req, res, next) => {
  if (!req.file) {
    return next(new BadRequestError("No photo file provided"));
  }

  // Tier check is handled by middleware, but double-check here
  if (req.user.tier === "Free") {
    return next(new ForbiddenError("Profile photo customization requires Starter tier or higher"));
  }

  // For local storage, construct the URL path
  const profilePhoto = `/uploads/profiles/${req.file.filename}`;

  return User.findByIdAndUpdate(req.user._id, { profilePhoto }, { new: true, runValidators: true })
    .orFail(() => new NotFoundError("User not found"))
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        profilePhoto: userObj.profilePhoto,
        message: `✅ Profile photo updated (${user.tier} tier feature)`,
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
};

// DELETE /users/me/photo - Remove profile photo (Starter+)
const deleteUserPhoto = (req, res, next) => {
  // Tier check is handled by middleware
  if (req.user.tier === "Free") {
    return next(new ForbiddenError("Profile photo customization requires Starter tier or higher"));
  }

  return User.findByIdAndUpdate(
    req.user._id,
    { profilePhoto: null },
    { new: true, runValidators: true }
  )
    .orFail(() => new NotFoundError("User not found"))
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        profilePhoto: null,
        message: "Profile photo removed successfully (Starter+ feature)",
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
};

// PATCH /users/me/settings - Update user settings
const updateUserSettings = (req, res, next) => {
  const { settingName, value } = req.body;

  if (!settingName || value === undefined) {
    return next(new BadRequestError("Setting name and value are required"));
  }

  const validSettings = [
    "emailNotifications",
    "profileVisibility",
    "phoneVisibility",
    "twoFactorAuth",
  ];
  if (!validSettings.includes(settingName)) {
    return next(
      new BadRequestError(`Invalid setting name. Must be one of: ${validSettings.join(", ")}`)
    );
  }

  const updateData = {};
  updateData[`settings.${settingName}`] = value;

  return User.findByIdAndUpdate(req.user._id, updateData, { new: true, runValidators: true })
    .orFail(() => new NotFoundError("User not found"))
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        message: "Setting updated successfully",
        user: userObj,
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
};

// PATCH /users/me/verified-badge - Toggle verified badge (Pro only)
const toggleVerifiedBadge = (req, res, next) => {
  if (req.user.tier !== "Pro" && req.user.role !== "admin") {
    return next(new ForbiddenError("Verified badge requires Pro tier"));
  }

  return User.findByIdAndUpdate(req.user._id, { verifiedBadge: true }, { new: true })
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        message: "Verified badge activated",
        user: userObj,
      });
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid ID format"));
      }
      return next(err);
    });
};

// PATCH /users/me/page-design - Update page design (Pro only)
const updatePageDesign = (req, res, next) => {
  if (req.user.tier !== "Pro" && req.user.role !== "admin") {
    return next(new ForbiddenError("Custom page design requires Pro tier"));
  }

  const { primaryColor, headerBanner, removeBranding } = req.body;

  if (!primaryColor && !headerBanner && removeBranding === undefined) {
    return next(new BadRequestError("At least one design field is required"));
  }

  const updateData = {};
  if (primaryColor) updateData["pageDesign.primaryColor"] = primaryColor;
  if (headerBanner) updateData["pageDesign.headerBanner"] = headerBanner;
  if (removeBranding !== undefined) updateData["pageDesign.removeBranding"] = removeBranding;

  return User.findByIdAndUpdate(req.user._id, updateData, { new: true })
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        message: "Page design updated successfully",
        user: userObj,
      });
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid ID format"));
      }
      return next(err);
    });
};

// PATCH /users/me/lead-generation - Enable lead generation tools (Pro only)
const enableLeadGeneration = (req, res, next) => {
  if (req.user.tier !== "Pro" && req.user.role !== "admin") {
    return next(new ForbiddenError("Lead generation tools require Pro tier"));
  }

  return User.findByIdAndUpdate(
    req.user._id,
    { "settings.leadGenerationEnabled": true },
    { new: true }
  )
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        message: "Lead generation tools enabled",
        user: userObj,
      });
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid ID format"));
      }
      return next(err);
    });
};

module.exports = {
  getCurrentUser,
  createUser,
  login,
  updateUser,
  updateUserPhoto,
  deleteUserPhoto,
  updateUserSettings,
  toggleVerifiedBadge,
  updatePageDesign,
  enableLeadGeneration,
  // recent views
  getRecentViews: async (req, res, next) => {
    try {
      const ttlMs = (Number(RECENT_VIEWS_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000;
      const cutoff = new Date(Date.now() - ttlMs);

      const user = await User.findById(req.user._id).select("recentViews");
      if (!user) return next(new NotFoundError("User not found"));

      // Filter expired
      const filtered = (user.recentViews || []).filter((rv) => {
        if (rv.pinned) return true; // keep pinned regardless of TTL
        return rv.viewedAt && rv.viewedAt >= cutoff;
      });

      // Fetch latest listing info for display (title/thumbnail)
      const ids = filtered.map((rv) => rv.listingId).filter(Boolean);
      const listings = await Listing.find({ _id: { $in: ids } })
        .select("title location mediaFiles status")
        .lean();
      const map = new Map(listings.map((l) => [String(l._id), l]));

      const response = filtered
        .map((rv) => {
          const l = rv.listingId ? map.get(String(rv.listingId)) : null;
          if (!l) return null;
          if (l.status && ["deleted", "suspended"].includes(String(l.status).toLowerCase())) return null;
          const thumbnail = (l.mediaFiles || []).find((m) => m.type === "image")?.url || rv.thumbnail || "";
          return {
            _id: String(rv.listingId),
            title: l.title,
            location: typeof l.location === "object"
              ? `${l.location?.city || ""}, ${l.location?.country || ""}`.trim().replace(/^,\s*/, "").replace(/,\s*$/, "")
              : l.location,
            thumbnail,
            viewedAt: rv.viewedAt,
            pinned: !!rv.pinned,
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          // Pinned items first, then most recent
          if (a.pinned && !b.pinned) return -1;
          if (b.pinned && !a.pinned) return 1;
          return new Date(b.viewedAt) - new Date(a.viewedAt);
        })
        .slice(0, Number(RECENT_VIEWS_MAX) || 10);

      return res.json({ success: true, recent: response });
    } catch (err) {
      next(err);
    }
  },
  addRecentView: async (req, res, next) => {
    try {
      const { listingId } = req.body || {};
      if (!listingId) return next(new BadRequestError("listingId is required"));

      const listing = await Listing.findById(listingId).select("title mediaFiles status");
      if (!listing) return next(new NotFoundError("Listing not found"));
      if (listing.status && ["deleted", "suspended"].includes(String(listing.status).toLowerCase())) {
        return next(new BadRequestError("Listing not available"));
      }

      const thumb = (listing.mediaFiles || []).find((m) => m.type === "image")?.url || "";

      const user = await User.findById(req.user._id).select("recentViews");
      if (!user) return next(new NotFoundError("User not found"));

      // Remove any existing entry for this listing; preserve pinned if previously set
      let wasPinned = false;
      const filtered = (user.recentViews || []).filter((rv) => {
        const same = String(rv.listingId) === String(listingId);
        if (same && rv.pinned) wasPinned = true;
        return !same;
      });

      const nextViews = [
        { listingId, title: listing.title, thumbnail: thumb, viewedAt: new Date(), pinned: wasPinned },
        ...filtered,
      ].slice(0, Number(RECENT_VIEWS_MAX) || 10);

      user.recentViews = nextViews;
      await user.save();
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
  pinRecentView: async (req, res, next) => {
    try {
      const { listingId, pinned = true } = req.body || {};
      if (!listingId) return next(new BadRequestError("listingId is required"));
      const user = await User.findById(req.user._id).select("recentViews");
      if (!user) return next(new NotFoundError("User not found"));
      let changed = false;
      user.recentViews = (user.recentViews || []).map((rv) => {
        if (String(rv.listingId) === String(listingId)) {
          rv.pinned = !!pinned;
          changed = true;
        }
        return rv;
      });
      if (changed) await user.save();
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
  clearRecentViews: async (req, res, next) => {
    try {
      await User.findByIdAndUpdate(req.user._id, { $set: { recentViews: [] } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
