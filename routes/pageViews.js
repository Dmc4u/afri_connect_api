const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const geoip = require("geoip-lite");
const auth = require("../middlewares/auth");
const { adminCheckMiddleware } = require("../utils/adminCheck");
const { JWT_SECRET } = require("../utils/config");
const PageView = require("../models/PageView");
const RecognizedDevice = require("../models/RecognizedDevice");
const User = require("../models/User");

const router = express.Router();
const RETENTION_MS = 24 * 60 * 60 * 1000;
let lastRetentionCleanup = 0;
const SENSITIVE_PARAMETERS = new Set([
  "access_token",
  "auth",
  "code",
  "id_token",
  "oauth_token",
  "refresh_token",
  "session",
  "state",
  "token",
  "user",
]);
const SENSITIVE_QUERY_PATTERN =
  /[?&](?:access_token|auth|code|id_token|oauth_token|refresh_token|session|state|token|user)=/i;

const cleanText = (value, maxLength) =>
  String(value || "")
    .trim()
    .slice(0, maxLength);

const hashDeviceId = (value) => {
  const deviceId = cleanText(value, 120);
  return deviceId ? crypto.createHash("sha256").update(deviceId).digest("hex") : "";
};

const getOptionalAuthenticatedUser = async (req) => {
  const { authorization } = req.headers;
  if (!authorization?.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.verify(authorization.slice(7), JWT_SECRET);
    const user = await User.findById(decoded._id || decoded.id)
      .select("name isActive authSessionVersion")
      .lean();
    if (!user || user.isActive === false) return null;
    const currentVersion = Number(user.authSessionVersion) || 0;
    if (
      (decoded.sessionVersion === undefined && currentVersion > 0) ||
      (decoded.sessionVersion !== undefined && Number(decoded.sessionVersion) !== currentVersion)
    )
      return null;
    return user;
  } catch {
    return null;
  }
};

const getAnonymousVisitorLabel = (sessionId) => {
  const code = crypto
    .createHash("sha256")
    .update(String(sessionId))
    .digest("hex")
    .slice(0, 6)
    .toUpperCase();
  return code;
};

const normalizePath = (value) => {
  const path = cleanText(value, 500);
  try {
    const url = new URL(path, "https://afrionet.com");
    ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"].forEach((parameter) =>
      url.searchParams.delete(parameter)
    );
    [...url.searchParams.keys()]
      .filter((parameter) => {
        const normalizedParameter = parameter.toLowerCase();
        return (
          normalizedParameter.startsWith("utm_") || SENSITIVE_PARAMETERS.has(normalizedParameter)
        );
      })
      .forEach((parameter) => url.searchParams.delete(parameter));
    return `${url.pathname}${url.search}${url.hash}`.slice(0, 500);
  } catch {
    return path;
  }
};

const decodeHeader = (value) => {
  try {
    return decodeURIComponent(cleanText(value, 120));
  } catch {
    return cleanText(value, 120);
  }
};

const getVisitorLocation = (req) => {
  const forwardedIp = cleanText(req.headers["x-forwarded-for"], 200).split(",")[0].trim();
  const ip =
    cleanText(req.headers["cf-connecting-ip"], 80) ||
    forwardedIp ||
    cleanText(req.ip || req.socket?.remoteAddress, 80);
  const geo = geoip.lookup(ip.replace(/^::ffff:/, ""));

  return {
    city: decodeHeader(req.headers["cf-ipcity"]) || cleanText(geo?.city, 120),
    country: decodeHeader(req.headers["cf-ipcountry-name"]) || cleanText(geo?.country, 120),
    countryCode: cleanText(req.headers["cf-ipcountry"] || geo?.country, 2).toUpperCase(),
  };
};

const purgeExpiredPageViews = async () => {
  const now = Date.now();
  if (now - lastRetentionCleanup < 5 * 60 * 1000) return;
  lastRetentionCleanup = now;
  await PageView.deleteMany({
    $or: [
      { viewedAt: { $lt: new Date(now - RETENTION_MS) } },
      { path: SENSITIVE_QUERY_PATTERN },
      { referrer: SENSITIVE_QUERY_PATTERN },
    ],
  });
};

router.post("/", async (req, res, next) => {
  try {
    await purgeExpiredPageViews();
    const sessionId = cleanText(req.body?.sessionId, 120);
    const path = normalizePath(req.body?.path);
    if (!sessionId || !path || !path.startsWith("/")) {
      return res.status(400).json({
        ok: false,
        message: "sessionId and a valid path are required",
      });
    }

    const allowedDevices = new Set(["mobile", "tablet", "desktop", "unknown"]);
    const requestedDevice = cleanText(req.body?.device, 20).toLowerCase();
    const deviceHash = hashDeviceId(req.body?.deviceId);
    const authenticatedUser = await getOptionalAuthenticatedUser(req);
    if (deviceHash && authenticatedUser) {
      await RecognizedDevice.findOneAndUpdate(
        { deviceHash },
        { user: authenticatedUser._id, lastAuthenticatedAt: new Date() },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    const visitorLabel = authenticatedUser?.name || getAnonymousVisitorLabel(sessionId);

    await PageView.create({
      sessionId,
      deviceHash,
      path,
      title: cleanText(req.body?.title, 250),
      visitorLabel,
      referrer: cleanText(req.body?.referrer, 1000),
      device: allowedDevices.has(requestedDevice) ? requestedDevice : "unknown",
      location: getVisitorLocation(req),
      viewedAt: new Date(),
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/admin/realtime", auth, adminCheckMiddleware, async (req, res, next) => {
  try {
    await purgeExpiredPageViews();
    const requestedRecentLimit = Number.parseInt(req.query.recentLimit, 10);
    const recentLimit = Number.isFinite(requestedRecentLimit)
      ? Math.min(Math.max(requestedRecentLimit, 20), 200)
      : 20;
    const now = new Date();
    const activeSince = new Date(now.getTime() - 5 * 60 * 1000);
    const hourSince = new Date(now.getTime() - 60 * 60 * 1000);
    const daySince = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [activeSessions, viewsLastHour, uniqueLastHour, viewsLastDay, topPages, recentViews] =
      await Promise.all([
        PageView.distinct("sessionId", { viewedAt: { $gte: activeSince } }),
        PageView.countDocuments({ viewedAt: { $gte: hourSince } }),
        PageView.distinct("sessionId", { viewedAt: { $gte: hourSince } }),
        PageView.countDocuments({ viewedAt: { $gte: daySince } }),
        PageView.aggregate([
          { $match: { viewedAt: { $gte: daySince } } },
          { $group: { _id: "$path", views: { $sum: 1 }, visitors: { $addToSet: "$sessionId" } } },
          { $project: { _id: 0, path: "$_id", views: 1, visitors: { $size: "$visitors" } } },
          { $sort: { views: -1 } },
          { $limit: 10 },
        ]),
        PageView.find({ viewedAt: { $gte: daySince } })
          .sort({ viewedAt: -1 })
          .limit(recentLimit)
          .select("path title visitorLabel device location viewedAt sessionId deviceHash")
          .lean(),
      ]);

    const anonymousDeviceHashes = [
      ...new Set(
        recentViews
          .filter((view) => view.deviceHash && /^[A-F0-9]{6}$/.test(view.visitorLabel || ""))
          .map((view) => view.deviceHash)
      ),
    ];
    const recognizedDevices = anonymousDeviceHashes.length
      ? await RecognizedDevice.find({ deviceHash: { $in: anonymousDeviceHashes } })
          .populate("user", "name isActive")
          .lean()
      : [];
    const recognizedNames = new Map(
      recognizedDevices
        .filter((entry) => entry.user?.isActive !== false && entry.user?.name)
        .map((entry) => [entry.deviceHash, entry.user.name])
    );

    res.json({
      ok: true,
      generatedAt: now,
      activeVisitors: activeSessions.length,
      viewsLastHour,
      uniqueVisitorsLastHour: uniqueLastHour.length,
      viewsLastDay,
      recentViewsTotal: viewsLastDay,
      recentViewsLimit: recentLimit,
      recentViewsHasMore: recentViews.length < viewsLastDay && recentLimit < 200,
      topPages,
      recentViews: recentViews.map((view) => {
        const recognizedUserName = recognizedNames.get(view.deviceHash);
        const safeView = { ...view };
        delete safeView.deviceHash;
        return {
          ...safeView,
          visitorLabel:
            recognizedUserName ||
            (!view.visitorLabel || view.visitorLabel === "Guest"
              ? getAnonymousVisitorLabel(view.sessionId)
              : view.visitorLabel),
          recognizedDevice: Boolean(recognizedUserName),
          sessionId: `${String(view.sessionId).slice(0, 8)}…`,
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
