const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");
const { UnauthorizedError } = require("../utils/errors");

module.exports = async (req, res, next) => {
  try {
    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return next(new UnauthorizedError("Authorization required"));
    }

    const token = authorization.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);

    // ✅ Fetch full user document
    const user = await User.findById(decoded._id || decoded.id);
    if (!user) {
      return next(new UnauthorizedError("User not found"));
    }

    req.user = user; // 👈 now req.user has _id, email, tier, etc.
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return next(new UnauthorizedError("Authorization required"));
  }
};
