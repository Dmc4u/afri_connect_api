const express = require("express");

const { resolveOneDriveEmbedUrl, isHttpUrl } = require("../utils/oneDriveResolve");

const router = express.Router();

router.post("/resolve", async (req, res) => {
  try {
    const rawUrl = String(req.body?.url || "").trim();
    if (!rawUrl) {
      return res.status(400).json({ success: false, message: "Missing url" });
    }
    if (rawUrl.length > 4000) {
      return res.status(400).json({ success: false, message: "URL too long" });
    }
    if (!isHttpUrl(rawUrl)) {
      return res.status(400).json({ success: false, message: "Invalid URL" });
    }

    const resolved = await resolveOneDriveEmbedUrl(rawUrl, 6500);
    const finalUrl = resolved?.finalUrl || rawUrl;
    const embedUrl = resolved?.embedUrl || null;
    const directUrl = resolved?.directUrl || null;

    const provider = embedUrl
      ? "onedrive"
      : String(finalUrl).toLowerCase().includes("sharepoint.com")
        ? "sharepoint"
        : "generic";

    return res.json({
      success: true,
      inputUrl: rawUrl,
      finalUrl,
      provider,
      embedUrl: embedUrl || null,
      directUrl: directUrl || null,
    });
  } catch (err) {
    const message = err?.name === "AbortError" ? "Timed out resolving URL" : err?.message;
    return res.status(502).json({ success: false, message: message || "Failed to resolve URL" });
  }
});

module.exports = router;
