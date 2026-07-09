const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../utils/config");

// Optional authentication - doesn't throw error if no token
module.exports = async (req, res, next) => {
  try {
    const { authorization } = req.headers;

    // If no authorization header, just continue without user
    if (!authorization || !authorization.startsWith("Bearer ")) {
      req.user = null;
      return next();
    }

    const token = authorization.replace("Bearer ", "");
    const decoded = jwt.verify(token, JWT_SECRET);

    // Fetch user if token is valid
    const user = await User.findById(decoded._id || decoded.id);
    if (!user) {
      req.user = null;
      return next();
    }

    const userSessionVersion = Number(user.authSessionVersion) || 0;
    const tokenHasSessionVersion = decoded.sessionVersion !== undefined;
    const tokenSessionVersion = Number(decoded.sessionVersion);

    if (
      (tokenHasSessionVersion && tokenSessionVersion !== userSessionVersion) ||
      (!tokenHasSessionVersion && userSessionVersion > 0)
    ) {
      req.user = null;
      return next();
    }

    req.user = user;

    next();
  } catch (err) {
    // If token is invalid, just continue without user
    req.user = null;
    next();
  }
};
