const express = require("express");
const auth = require("../middlewares/auth");
const { adminCheckMiddleware } = require("../utils/adminCheck");
const PageView = require("../models/PageView");

const router = express.Router();
const RETENTION_MS = 24 * 60 * 60 * 1000;
let lastRetentionCleanup = 0;

const cleanText = (value, maxLength) =>
  String(value || "").trim().slice(0, maxLength);

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
    const path = cleanText(req.body?.path, 500);
    if (!sessionId || !path || !path.startsWith("/")) {
      return res.status(400).json({
        ok: false,
        message: "sessionId and a valid path are required",
      });
    }

    const allowedDevices = new Set(["mobile", "tablet", "desktop", "unknown"]);
    const requestedDevice = cleanText(req.body?.device, 20).toLowerCase();

    await PageView.create({
      sessionId,
      path,
      title: cleanText(req.body?.title, 250),
      visitorLabel: cleanText(req.body?.visitorLabel, 120) || "Guest",
      referrer: cleanText(req.body?.referrer, 1000),
      device: allowedDevices.has(requestedDevice)
        ? requestedDevice
        : "unknown",
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
      PageView.find({ viewedAt: { $gte: hourSince } })
        .sort({ viewedAt: -1 })
        .limit(50)
        .select("path title visitorLabel device viewedAt sessionId")
        .lean(),
    ]);

    res.json({
      ok: true,
      generatedAt: now,
      activeVisitors: activeSessions.length,
      viewsLastHour,
      uniqueVisitorsLastHour: uniqueLastHour.length,
      viewsLastDay,
      topPages,
      recentViews: recentViews.map((view) => ({
        ...view,
        sessionId: `${String(view.sessionId).slice(0, 8)}…`,
      })),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
