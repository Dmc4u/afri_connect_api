const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");
const { RECENT_VIEWS_MAX, RECENT_VIEWS_TTL_DAYS } = require("../utils/config");
const Listing = require("../models/Listing");
const { isAdminEmail } = require("../utils/adminCheck");
const { logActivity } = require("../utils/activityLogger");
const { emailTemplates, sendEmail, utils: notificationUtils } = require("../utils/notifications");
const {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  NotFoundError,
  ForbiddenError,
} = require("../utils/errors");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const maskEmail = (email) => {
  const raw = String(email || "");
  const at = raw.indexOf("@");
  if (at <= 1) return raw;
  const name = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const visible = name.slice(0, 1);
  return `${visible}${"*".repeat(Math.min(6, Math.max(2, name.length - 1)))}@${domain}`;
};

const otpHmac = (otp) => {
  const secret = String(process.env.OTP_SECRET || JWT_SECRET || "");
  return crypto.createHmac("sha256", secret).update(String(otp)).digest("hex");
};

const safeHexEqual = (a, b) => {
  try {
    const bufA = Buffer.from(String(a || ""), "hex");
    const bufB = Buffer.from(String(b || ""), "hex");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

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
  const { name, email, phone, city, country, password } = req.body;

  if (!name || !email || !phone || !city || !country || !password) {
    return next(
      new BadRequestError("Name, email, phone, city, country, and password are required")
    );
  }

  // Check if user already exists with this email or phone
  return User.findOne({ $or: [{ email }, { phone }] })
    .then((existingUser) => {
      if (existingUser) {
        if (existingUser.email === email) {
          throw new ConflictError("An account with this email already exists");
        }
        if (existingUser.phone === phone) {
          throw new ConflictError("An account with this phone number already exists");
        }
      }
      return bcrypt.hash(password, 10);
    })
    .then((hash) => {
      // Determine role based on ADMIN_EMAILS configuration
      const role = isAdminEmail(email) ? "admin" : "user";
      // Create location string from city and country
      const location = city && country ? `${city}, ${country}` : country || city || null;
      return User.create({
        name,
        email,
        phone,
        city,
        country,
        location,
        password: hash,
        role,
        // Auto-enable 2FA for admins (high-privilege accounts)
        settings: {
          emailNotifications: true,
          profileVisibility: true,
          phoneVisibility: false,
          twoFactorAuth: role === "admin",
        },
      });
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
        // Handle MongoDB duplicate key error
        const field = Object.keys(err.keyPattern || {})[0];
        if (field === "email") {
          return next(new ConflictError("An account with this email already exists"));
        } else if (field === "phone") {
          return next(new ConflictError("An account with this phone number already exists"));
        }
        return next(new ConflictError("An account with these credentials already exists"));
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

      // Auto-enable 2FA for admins (high-privilege accounts)
      if (user.role === "admin" && !(user.settings && user.settings.twoFactorAuth === true)) {
        user.settings = user.settings || {};
        user.settings.twoFactorAuth = true;
        await user.save();
      }

      // If 2FA is enabled, require Email OTP before issuing JWT
      if (user.settings && user.settings.twoFactorAuth === true) {
        const now = Date.now();
        const existingExpiresAt =
          user.loginOtp && user.loginOtp.expiresAt
            ? new Date(user.loginOtp.expiresAt).getTime()
            : 0;
        const existingLastSentAt =
          user.loginOtp && user.loginOtp.lastSentAt
            ? new Date(user.loginOtp.lastSentAt).getTime()
            : 0;
        const existingValid = existingExpiresAt && existingExpiresAt > now;
        const withinCooldown =
          existingLastSentAt && now - existingLastSentAt < OTP_RESEND_COOLDOWN_MS;

        let otp = null;
        if (!existingValid || !withinCooldown) {
          otp = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
          user.loginOtp = {
            hash: otpHmac(otp),
            expiresAt: new Date(now + OTP_TTL_MS),
            attempts: 0,
            lastSentAt: new Date(now),
          };
          await user.save();

          const subject = "Your AfriOnet login verification code";
          const html = `
            <div style="font-family:Inter,Arial,sans-serif; font-size:14px; line-height:1.6; max-width:520px; margin:0 auto;">
              <h2 style="margin:0 0 12px;">Verify your login</h2>
              <p>Use this 6-digit code to complete your sign-in:</p>
              <div style="font-size:28px; letter-spacing:6px; font-weight:700; padding:12px 16px; background:#f3f4f6; border-radius:8px; display:inline-block;">${otp}</div>
              <p style="margin-top:16px; color:#666; font-size:12px;">This code expires in 10 minutes. If you didn’t try to sign in, you can ignore this email.</p>
            </div>
          `;

          const result = await sendEmail(user.email, subject, html);
          if (!result || result.success !== true) {
            // Don’t leave a valid OTP sitting around if sending failed.
            user.loginOtp = { hash: null, expiresAt: null, attempts: 0, lastSentAt: null };
            await user.save();
            const details = result && result.error ? result.error : "Email delivery failed";
            const message =
              process.env.NODE_ENV !== "production"
                ? `Unable to send verification code: ${details}`
                : "Unable to send verification code. Please try again.";
            return next(new BadRequestError(message));
          }
        }

        const preAuthToken = jwt.sign({ _id: user._id, purpose: "login_otp" }, JWT_SECRET, {
          expiresIn: "10m",
        });

        return res.send({
          requiresOtp: true,
          preAuthToken,
          otpSent: !!otp,
          email: maskEmail(user.email),
        });
      }

      const userObj = user.toObject();
      delete userObj.password;

      // Extract login details and send notification email
      if (!(user.settings && user.settings.emailNotifications === false)) {
        const loginDetails = notificationUtils.extractLoginDetails(req);
        const loginEmail = emailTemplates.loginNotification(user, loginDetails);

        // Send login notification asynchronously (don't block login)
        sendEmail(user.email, loginEmail.subject, loginEmail.html).catch((error) => {
          console.error("Failed to send login notification:", error);
        });
      }

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

// POST /auth/verify-otp - Verify Email OTP login and issue JWT
const verifyLoginOtp = async (req, res, next) => {
  try {
    const { preAuthToken, otp } = req.body;
    if (!preAuthToken || !otp) {
      return next(new BadRequestError("preAuthToken and otp are required"));
    }

    let payload;
    try {
      payload = jwt.verify(preAuthToken, JWT_SECRET);
    } catch {
      return next(new UnauthorizedError("OTP session expired. Please sign in again."));
    }

    if (!payload || payload.purpose !== "login_otp" || !payload._id) {
      return next(new UnauthorizedError("Invalid OTP session. Please sign in again."));
    }

    // Need the OTP hash (select: false)
    const user = await User.findById(payload._id).select(
      "+loginOtp.hash name email role tier settings loginOtp.expiresAt loginOtp.attempts loginOtp.lastSentAt"
    );
    if (!user) return next(new NotFoundError("User not found"));
    if (!(user.settings && user.settings.twoFactorAuth === true)) {
      return next(new BadRequestError("Two-factor authentication is not enabled for this account"));
    }

    const now = Date.now();
    const expiresAt =
      user.loginOtp && user.loginOtp.expiresAt ? new Date(user.loginOtp.expiresAt).getTime() : 0;
    if (!user.loginOtp || !user.loginOtp.hash || !expiresAt || expiresAt <= now) {
      return next(new UnauthorizedError("OTP expired. Please sign in again."));
    }

    const attempts = Number(user.loginOtp.attempts || 0);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      return next(new UnauthorizedError("Too many incorrect codes. Please sign in again."));
    }

    const candidate = otpHmac(String(otp));
    const ok = safeHexEqual(user.loginOtp.hash, candidate);
    if (!ok) {
      user.loginOtp.attempts = attempts + 1;
      await user.save();
      return next(new UnauthorizedError("Incorrect verification code"));
    }

    // OTP verified: clear it
    user.loginOtp = { hash: null, expiresAt: null, attempts: 0, lastSentAt: null };

    // Sync role with ADMIN_EMAILS configuration
    const expectedRole = isAdminEmail(user.email) ? "admin" : "user";
    if (user.role !== expectedRole) {
      user.role = expectedRole;
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    // Send login notification after successful OTP verification (opt-in)
    if (!(user.settings && user.settings.emailNotifications === false)) {
      const loginDetails = notificationUtils.extractLoginDetails(req);
      const loginEmail = emailTemplates.loginNotification(user, loginDetails);
      sendEmail(user.email, loginEmail.subject, loginEmail.html).catch((error) => {
        console.error("Failed to send login notification:", error);
      });
    }

    return res.send({
      user: userObj,
      token: jwt.sign({ _id: user._id, twoFactor: true }, JWT_SECRET, { expiresIn: "7d" }),
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /users/me - Update user profile
const updateUser = (req, res, next) => {
  const { name, phone, country, location } = req.body;

  if (!name) {
    return next(new BadRequestError("Name is required"));
  }

  // Prepare update object with only provided fields
  const updateFields = { name };
  if (phone !== undefined) updateFields.phone = phone;
  if (country !== undefined) updateFields.country = country;
  if (location !== undefined) updateFields.location = location;

  return User.findByIdAndUpdate(req.user._id, updateFields, { new: true, runValidators: true })
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

// PATCH /users/me/photo - Update profile photo (All tiers allowed)
const updateUserPhoto = (req, res, next) => {
  if (!req.file) {
    return next(new BadRequestError("No photo file provided"));
  }

  // All tiers can now upload profile photos (including Free talent)
  // No tier restrictions for basic profile customization

  // For local storage, construct the URL path
  const profilePhoto = `/uploads/profiles/${req.file.filename}`;

  return User.findByIdAndUpdate(req.user._id, { profilePhoto }, { new: true, runValidators: true })
    .orFail(() => new NotFoundError("User not found"))
    .then((user) => {
      const userObj = user.toObject();
      delete userObj.password;
      return res.send({
        profilePhoto: userObj.profilePhoto,
        message: "✅ Profile photo updated successfully",
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
};

// DELETE /users/me/photo - Remove profile photo (All tiers allowed)
const deleteUserPhoto = (req, res, next) => {
  // All tiers can now remove profile photos (including Free talent)
  // No tier restrictions for basic profile customization

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
        message: "Profile photo removed successfully",
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
  verifyLoginOtp,
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
          if (l.status && ["deleted", "suspended"].includes(String(l.status).toLowerCase()))
            return null;
          const thumbnail =
            (l.mediaFiles || []).find((m) => m.type === "image")?.url || rv.thumbnail || "";
          return {
            _id: String(rv.listingId),
            title: l.title,
            location:
              typeof l.location === "object"
                ? `${l.location?.city || ""}, ${l.location?.country || ""}`
                    .trim()
                    .replace(/^,\s*/, "")
                    .replace(/,\s*$/, "")
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
      if (
        listing.status &&
        ["deleted", "suspended"].includes(String(listing.status).toLowerCase())
      ) {
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
        {
          listingId,
          title: listing.title,
          thumbnail: thumb,
          viewedAt: new Date(),
          pinned: wasPinned,
        },
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
