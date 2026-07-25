const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");
const { UnauthorizedError } = require("../utils/errors");

const ACTIVE_TIMESTAMP_WRITE_INTERVAL_MS = 5 * 60 * 1000;

module.exports = async (req, res, next) => {
  try {
    const { authorization } = req.headers;

    console.log("[Auth] Headers received:", {
      hasAuth: !!authorization,
      authPreview: authorization ? authorization.substring(0, 20) + "..." : "none",
    });

    if (!authorization || !authorization.startsWith("Bearer ")) {
      console.log("[Auth] ❌ Missing or invalid authorization header");
      return next(new UnauthorizedError("Authorization required"));
    }

    const token = authorization.replace("Bearer ", "");
    console.log("[Auth] Token length:", token.length);

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("[Auth] Token decoded, userId:", decoded._id || decoded.id);
    req.auth = decoded;

    // ✅ Fetch full user document
    const user = await User.findById(decoded._id || decoded.id);
    if (!user) {
      console.log("[Auth] ❌ User not found in database for ID:", decoded._id || decoded.id);
      return next(new UnauthorizedError("User not found"));
    }

    if (user.isActive === false) {
      console.log("[Auth] ❌ Account suspended or inactive:", user.email);
      return next(new UnauthorizedError("Account suspended. Contact support."));
    }

    const userSessionVersion = Number(user.authSessionVersion) || 0;
    const tokenHasSessionVersion = decoded.sessionVersion !== undefined;
    const tokenSessionVersion = Number(decoded.sessionVersion);

    if (
      (tokenHasSessionVersion && tokenSessionVersion !== userSessionVersion) ||
      (!tokenHasSessionVersion && userSessionVersion > 0)
    ) {
      console.log("[Auth] ❌ Session revoked for user:", user.email);
      return next(new UnauthorizedError("Session expired. Please sign in again."));
    }

    console.log("[Auth] ✅ User authenticated:", user.email, "tier:", user.tier);
    req.user = user; // 👈 now req.user has _id, email, tier, etc.
    const now = new Date();
    const lastActiveAt = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    if (now.getTime() - lastActiveAt >= ACTIVE_TIMESTAMP_WRITE_INTERVAL_MS) {
      User.updateOne(
        { _id: user._id },
        { $set: { lastActiveAt: now } },
        { timestamps: false }
      ).catch((error) => {
        // Activity tracking must never prevent an otherwise valid request.
        console.error("[Auth] Failed to update user activity:", error.message);
      });
      user.lastActiveAt = now;
    }

    next();
  } catch (err) {
    console.error("[Auth] Error:", err.message);
    return next(new UnauthorizedError("Authorization required"));
  }
};
