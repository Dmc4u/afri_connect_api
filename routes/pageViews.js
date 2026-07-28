const express = require("express");
const crypto = require("crypto");
const auth = require("../middlewares/auth");
const { adminCheckMiddleware } = require("../utils/adminCheck");
const PageView = require("../models/PageView");
const geoip = require("geoip-lite");

const router = express.Router();
const RETENTION_MS = 24 * 60 * 60 * 1000;
let lastRetentionCleanup = 0;

const cleanText = (value, maxLength) =>
  String(value || "").trim().slice(0, maxLength);

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
    ["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"]
      .forEach((parameter) => url.searchParams.delete(parameter));
    [...url.searchParams.keys()]
      .filter((parameter) => parameter.toLowerCase().startsWith("utm_"))
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
  const forwardedIp = cleanText(req.headers["x-forwarded-for"], 200)
    .split(",")[0]
    .trim();
  const ip = cleanText(req.headers["cf-connecting-ip"], 80)
    || forwardedIp
    || cleanText(req.ip || req.socket?.remoteAddress, 80);
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
    viewedAt: { $lt: new Date(now - RETENTION_MS) },
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
    const requestedVisitorLabel = cleanText(req.body?.visitorLabel, 120);
    const visitorLabel = !requestedVisitorLabel || requestedVisitorLabel === "Guest"
      ? getAnonymousVisitorLabel(sessionId)
      : requestedVisitorLabel;

    await PageView.create({
      sessionId,
      path,
      title: cleanText(req.body?.title, 250),
      visitorLabel,
      referrer: cleanText(req.body?.referrer, 1000),
      device: allowedDevices.has(requestedDevice)
        ? requestedDevice
        : "unknown",
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

    const [
      activeSessions,
      viewsLastHour,
      uniqueLastHour,
      viewsLastDay,
      topPages,
      recentViews,
    ] = await Promise.all([
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
        .select("path title visitorLabel device location viewedAt sessionId")
        .lean(),
    ]);

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
      recentViews: recentViews.map((view) => ({
        ...view,
        visitorLabel: !view.visitorLabel || view.visitorLabel === "Guest"
          ? getAnonymousVisitorLabel(view.sessionId)
          : view.visitorLabel,
        sessionId: `${String(view.sessionId).slice(0, 8)}…`,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
