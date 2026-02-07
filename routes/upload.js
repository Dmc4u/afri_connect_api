const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const uploadVideo = require("../middlewares/uploadVideo");
const uploadVideoCloudinary = require("../middlewares/uploadVideoCloudinary");
const uploadImage = require("../middlewares/uploadImage");
const { cloudinary, cloudinarySdk, isCloudinaryEnabled } = require("../utils/cloudinary");
const fsp = require("fs/promises");

function getCloudinaryVideoFolder() {
  return process.env.CLOUDINARY_VIDEO_FOLDER || "afrionet/videos";
}

function getCloudinaryImageFolder() {
  return process.env.CLOUDINARY_IMAGE_FOLDER || "afrionet/images";
}

/**
 * @route   GET /api/upload/cloudinary-signature
 * @desc    Generate a signed Cloudinary upload signature so the browser can upload directly.
 * @access  Private
 */
router.get("/cloudinary-signature", auth, async (req, res) => {
  try {
    if (!isCloudinaryEnabled) {
      return res.status(503).json({
        success: false,
        message:
          "Cloudinary is disabled on the server. Set USE_CLOUDINARY=true and Cloudinary credentials.",
      });
    }

    const resourceType = String(req.query.resource_type || "video").toLowerCase();
    if (resourceType !== "video" && resourceType !== "image") {
      return res.status(400).json({
        success: false,
        message: "Invalid resource_type. Must be 'video' or 'image'.",
      });
    }

    const folder =
      resourceType === "video" ? getCloudinaryVideoFolder() : getCloudinaryImageFolder();

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign = {
      timestamp,
      folder,
    };

    const signature = cloudinarySdk.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return res.json({
      success: true,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      folder,
      resourceType,
    });
  } catch (error) {
    const { statusCode, message } = classifyUploadError(error);
    console.error("❌ Cloudinary signature error:", {
      name: error?.name,
      message: error?.message,
      http_code: error?.http_code,
      statusCode: error?.statusCode,
    });
    return res.status(statusCode).json({ success: false, message });
  }
});

function getMaxVideoUploadMb() {
  const raw =
    process.env.UPLOAD_MAX_VIDEO_SIZE_MB ||
    process.env.UPLOAD_MAX_FILE_SIZE_MB ||
    process.env.VIDEO_UPLOAD_MAX_MB;
  const parsedMb = Number(raw);
  return Number.isFinite(parsedMb) && parsedMb > 0 ? parsedMb : 500;
}

function classifyUploadError(err) {
  if (!err) return { statusCode: 500, message: "Upload failed" };

  const messageStr = String(err.message || "");
  if (messageStr.includes("Cloudinary is disabled")) {
    return {
      statusCode: 503,
      message:
        "Video upload is temporarily unavailable (Cloudinary disabled). Set USE_CLOUDINARY=true and Cloudinary credentials on the server.",
    };
  }

  if (err.name === "MulterError") {
    if (err.code === "LIMIT_FILE_SIZE") {
      return {
        statusCode: 413,
        message: `File too large. Maximum allowed size is ${getMaxVideoUploadMb()}MB.`,
      };
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return { statusCode: 400, message: "Unexpected file field." };
    }

    return { statusCode: 400, message: err.message || "Upload failed" };
  }

  const httpCode = Number(err.http_code || err.statusCode || err.status);
  const msg = messageStr || "Upload failed";

  if (/too\s*large|file\s*size/i.test(msg)) {
    return {
      statusCode: 413,
      message: `File too large. Maximum allowed size is ${getMaxVideoUploadMb()}MB.`,
    };
  }

  if (Number.isFinite(httpCode) && httpCode >= 400 && httpCode <= 599) {
    return { statusCode: httpCode, message: msg };
  }

  return { statusCode: 500, message: msg };
}

function getCloudinaryLargeThresholdBytes() {
  const parsed = Number(process.env.CLOUDINARY_UPLOAD_LARGE_THRESHOLD_MB);
  const mb = Number.isFinite(parsed) ? parsed : 95;
  if (mb <= 0) return 0;
  return Math.floor(mb * 1024 * 1024);
}

function getCloudinaryChunkSizeBytes() {
  const parsed = Number(process.env.CLOUDINARY_CHUNK_SIZE_MB);
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
  return Math.floor(mb * 1024 * 1024);
}

function getCloudinaryUploadTimeoutMs() {
  const parsed = Number(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20 * 60 * 1000;
}

/**
 * @route   POST /api/upload/video-cloud
 * @desc    Upload video file to Cloudinary (FASTER - Recommended)
 * @access  Private
 */
router.post("/video-cloud", auth, (req, res) => {
  uploadVideoCloudinary.single("video")(req, res, async (err) => {
    if (err) {
      const { statusCode, message } = classifyUploadError(err);
      console.error("❌ Cloudinary video upload middleware error:", {
        name: err.name,
        code: err.code,
        message: err.message,
        http_code: err.http_code,
        statusCode: err.statusCode,
      });
      return res.status(statusCode).json({ success: false, message });
    }

    try {
      console.log(
        `☁️ Cloudinary video upload started - User: ${req.user._id}, File: ${req.file?.originalname || "unknown"}`
      );

      if (!req.file) {
        console.error("❌ Video upload failed: No file in request");
        return res.status(400).json({ success: false, message: "No video file provided" });
      }

      const localPath = req.file.path;
      const fileSizeBytes = Number(req.file.size || 0);
      const thresholdBytes = getCloudinaryLargeThresholdBytes();
      const useLarge = thresholdBytes === 0 ? true : fileSizeBytes >= thresholdBytes;

      console.log(
        `📦 Temp video received: ${req.file.filename} (${(fileSizeBytes / (1024 * 1024)).toFixed(2)}MB). Upload mode: ${useLarge ? "upload_large" : "upload"}`
      );

      const folder = getCloudinaryVideoFolder();
      const uploadOptions = {
        resource_type: "video",
        folder,
        transformation: [{ quality: "auto", fetch_format: "auto" }],
        timeout: getCloudinaryUploadTimeoutMs(),
      };

      let result;
      try {
        if (useLarge) {
          result = await cloudinary.uploader.upload_large(localPath, {
            ...uploadOptions,
            chunk_size: getCloudinaryChunkSizeBytes(),
          });
        } else {
          result = await cloudinary.uploader.upload(localPath, uploadOptions);
        }
      } finally {
        try {
          await fsp.unlink(localPath);
        } catch {
          // ignore temp cleanup failures
        }
      }

      const videoUrl = result?.secure_url || result?.url;
      const videoDuration = result?.duration ?? null;
      const cloudinaryId = result?.public_id || null;

      console.log(
        `✅ Cloudinary video upload completed - URL: ${videoUrl}, Duration: ${videoDuration || "unknown"}s, Public ID: ${cloudinaryId || "unknown"}`
      );

      return res.json({
        success: true,
        videoUrl,
        videoDuration,
        filename: cloudinaryId || req.file.filename,
        size: result?.bytes ?? req.file.size,
        mimetype: req.file.mimetype,
        cloudinaryId,
      });
    } catch (error) {
      const { statusCode, message } = classifyUploadError(error);
      console.error("❌ Cloudinary video upload handler error:", {
        name: error?.name,
        message: error?.message,
        http_code: error?.http_code,
        statusCode: error?.statusCode,
      });
      return res.status(statusCode).json({
        success: false,
        message,
        ...(statusCode >= 500 && { error: error?.message || "Unknown error" }),
      });
    }
  });
});

/**
 * @route   POST /api/upload/video
 * @desc    Upload video file to local storage (slower, use /video-cloud for faster uploads)
 * @access  Private
 */
router.post("/video", auth, uploadVideo.single("video"), async (req, res) => {
  try {
    console.log(
      `📹 Video upload started - User: ${req.user._id}, File: ${req.file?.originalname || "unknown"}`
    );

    if (!req.file) {
      console.error("❌ Video upload failed: No file in request");
      return res.status(400).json({ message: "No video file provided" });
    }

    console.log(
      `✅ Video file received: ${req.file.filename}, Size: ${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
    );

    // Get video duration using ffprobe if available
    let videoDuration = null;
    try {
      console.log("🔍 Attempting to detect video duration...");
      const ffprobe = require("fluent-ffmpeg").ffprobe;
      const videoPath = req.file.path;

      // Make ffprobe async with Promise
      videoDuration = await new Promise((resolve) => {
        ffprobe(videoPath, (err, metadata) => {
          if (!err && metadata && metadata.format && metadata.format.duration) {
            const duration = Math.round(metadata.format.duration);
            console.log(
              `✅ Video duration detected: ${duration} seconds (${(duration / 60).toFixed(1)} minutes)`
            );
            resolve(duration);
          } else {
            console.log("⚠️ Could not detect video duration:", err?.message || "No metadata");
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.log(
        "⚠️ ffprobe not available, video duration will not be auto-detected:",
        error.message
      );
    }

    // Generate URL for the uploaded file (served from /uploads)
    const videoUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${req.file.filename}`;

    console.log(
      `✅ Video upload completed successfully - URL: ${videoUrl}, Duration: ${videoDuration || "unknown"}s`
    );

    res.json({
      success: true,
      videoUrl: videoUrl,
      videoDuration: videoDuration, // Video duration in seconds
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error("❌ Video upload error:", error.message);
    console.error("Stack trace:", error.stack);

    res.status(500).json({
      success: false,
      message: "Video upload failed",
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/upload/image
 * @desc    Upload image file to local storage
 * @access  Private
 */
router.post("/image", auth, uploadImage.single("image"), async (req, res) => {
  try {
    console.log(
      `📸 Image upload started - User: ${req.user._id}, File: ${req.file?.originalname || "unknown"}`
    );

    if (!req.file) {
      console.error("❌ Image upload failed: No file in request");
      return res.status(400).json({ message: "No image file provided" });
    }

    console.log(
      `✅ Image file received: ${req.file.filename}, Size: ${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
    );

    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/images/${req.file.filename}`;
    console.log(`✅ Image upload completed successfully - URL: ${imageUrl}`);

    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error("Image upload error:", error);

    res.status(500).json({
      success: false,
      message: "Image upload failed",
      error: error.message,
    });
  }
});

module.exports = router;
