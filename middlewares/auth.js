const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");
const { UnauthorizedError } = require("../utils/errors");

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

    console.log("[Auth] ✅ User authenticated:", user.email, "tier:", user.tier);
    req.user = user; // 👈 now req.user has _id, email, tier, etc.
    next();
  } catch (err) {
    console.error("[Auth] Error:", err.message);
    return next(new UnauthorizedError("Authorization required"));
  }
};
