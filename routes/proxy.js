const express = require("express");
const geoip = require("geoip-lite");
const rateLimit = require("express-rate-limit");

const router = express.Router();

const ipLocationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * IP-based geolocation endpoint (server-side, avoids browser CORS/mixed-content)
 * GET /proxy/ip-location
 */
router.get("/ip-location", ipLocationLimiter, (req, res) => {
  try {
    const xff = req.headers["x-forwarded-for"];
    const forwardedIp = (Array.isArray(xff) ? xff[0] : String(xff || ""))
      .split(",")[0]
      .trim();

    const rawIp = forwardedIp || req.ip;
    const ip = rawIp && rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
    const geo = ip ? geoip.lookup(ip) : null;

    res.set("Cache-Control", "private, max-age=3600"); // 1 hour
    res.set("Access-Control-Allow-Origin", "*");

    if (!geo || !geo.ll) {
      return res.json({
        success: false,
        ip,
        source: "geoip-lite",
      });
    }

    const [latitude, longitude] = geo.ll;
    return res.json({
      success: true,
      ip,
      city: geo.city || null,
      region: geo.region || null,
      country: geo.country || null,
      latitude,
      longitude,
      timezone: geo.timezone || null,
      source: "geoip-lite",
    });
  } catch (error) {
    console.error("IP location proxy error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to detect IP location",
    });
  }
});

/**
 * Image proxy endpoint to avoid CORS issues with external images
 * GET /proxy/image?url=<encoded_image_url>
 */
router.get("/image", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ message: "URL parameter is required" });
    }

    // Validate URL format
    let imageUrl;
    try {
      imageUrl = new URL(decodeURIComponent(url));
    } catch (err) {
      return res.status(400).json({ message: "Invalid URL format" });
    }

    // Only allow http and https protocols
    if (!["http:", "https:"].includes(imageUrl.protocol)) {
      return res.status(400).json({ message: "Only HTTP(S) URLs are allowed" });
    }

    // Fetch the image
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(imageUrl.href, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AfriOnet/1.0)",
        "Accept": "image/*"
      },
      timeout: 10000 // 10 second timeout
    });

    if (!response.ok) {
      return res.status(response.status).json({
        message: `Failed to fetch image: ${response.statusText}`
      });
    }

    // Get content type from response
    const contentType = response.headers.get("content-type");

    // Validate it's an image
    if (!contentType || !contentType.startsWith("image/")) {
      return res.status(400).json({ message: "URL does not point to an image" });
    }

    // Set appropriate headers
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400"); // Cache for 24 hours
    res.set("Access-Control-Allow-Origin", "*");

    // Stream the image
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));

  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({ message: "Failed to proxy image" });
  }
});

module.exports = router;
