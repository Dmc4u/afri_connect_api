const express = require("express");

const fsp = require("fs/promises");

const auth = require("../middlewares/auth");
const uploadVideo = require("../middlewares/uploadVideo");
const uploadVideoTmp = require("../middlewares/uploadVideoTmp");
const uploadImage = require("../middlewares/uploadImage");
const {
  isGcsEnabled,
  getGcsBucketName,
  buildObjectName,
  getPublicUrl,
  getSignedUploadUrl,
  uploadFromPath,
} = require("../utils/gcs");

const router = express.Router();

/**
 * @route   GET /api/upload/cloudinary-signature
 * @desc    Generate a signed upload URL so the browser can upload directly to cloud storage.
 * @access  Private
 */
router.get("/cloudinary-signature", auth, async (req, res) => {
  try {
    const resourceType = String(req.query.resource_type || "video").toLowerCase();
    if (resourceType !== "video" && resourceType !== "image") {
      return res.status(400).json({
        success: false,
        message: "Invalid resource_type. Must be 'video' or 'image'.",
      });
    }

    if (!isGcsEnabled()) {
      return res.status(503).json({
        success: false,
        message: "GCS uploads are not enabled on the server.",
      });
    }

    const bucketName = getGcsBucketName();
    if (!bucketName) {
      return res.status(500).json({
        success: false,
        message: "GCS is enabled but GCS_BUCKET is not configured.",
      });
    }

    const purpose = String(req.query.purpose || "").toLowerCase();
    const filename = String(req.query.filename || "upload");
    const objectName = buildObjectName({ resourceType, purpose, filename });
    const uploadUrl = await getSignedUploadUrl({ bucketName, objectName });
    const fileUrl = getPublicUrl(bucketName, objectName);

    return res.json({
      success: true,
      provider: "gcs",
      resourceType,
      bucket: bucketName,
      objectName,
      uploadUrl,
      method: "PUT",
      fileUrl,
    });
  } catch (error) {
    // eslint-disable-next-line no-use-before-define
    const { statusCode, message } = classifyUploadError(error);
    console.error("❌ Signed upload URL error:", {
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

/**
 * @route   POST /api/upload/video-cloud
 * @desc    Upload video file to cloud storage (GCS)
 * @access  Private
 */
router.post("/video-cloud", auth, (req, res) => {
  uploadVideoTmp.single("video")(req, res, async (err) => {
    if (err) {
      const { statusCode, message } = classifyUploadError(err);
      console.error("❌ Cloud video upload middleware error:", {
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
        `☁️ Cloud video upload started - User: ${req.user._id}, File: ${req.file?.originalname || "unknown"}`
      );

      if (!req.file) {
        console.error("❌ Video upload failed: No file in request");
        return res.status(400).json({ success: false, message: "No video file provided" });
      }

      const localPath = req.file.path;
      if (!isGcsEnabled()) {
        return res.status(503).json({
          success: false,
          message: "GCS uploads are not enabled on the server.",
        });
      }

      const bucketName = getGcsBucketName();
      if (!bucketName) {
        return res
          .status(500)
          .json({ success: false, message: "GCS is enabled but GCS_BUCKET is not configured." });
      }

      const objectName = buildObjectName({
        resourceType: "video",
        purpose: String(req.query.purpose || "").toLowerCase(),
        filename: req.file.originalname || req.file.filename,
      });

      let videoUrl;
      try {
        videoUrl = await uploadFromPath({
          bucketName,
          objectName,
          localPath,
          contentType: req.file.mimetype,
        });
      } finally {
        try {
          await fsp.unlink(localPath);
        } catch {
          // ignore
        }
      }

      return res.json({
        success: true,
        provider: "gcs",
        videoUrl,
        videoDuration: null,
        filename: objectName,
        size: req.file.size,
        mimetype: req.file.mimetype,
        cloudinaryId: null,
      });
    } catch (error) {
      const { statusCode, message } = classifyUploadError(error);
      console.error("❌ Cloud video upload handler error:", {
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
      // eslint-disable-next-line global-require, import/no-unresolved
      const { ffprobe } = require("fluent-ffmpeg");
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

    return res.json({
      success: true,
      videoUrl,
      videoDuration, // Video duration in seconds
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error("❌ Video upload error:", error.message);
    console.error("Stack trace:", error.stack);

    return res.status(500).json({
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

    return res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    console.error("Image upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Image upload failed",
      error: error.message,
    });
  }
});

module.exports = router;
