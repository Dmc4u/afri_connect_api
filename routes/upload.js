const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const uploadVideo = require("../middlewares/uploadVideo");
const uploadVideoCloudinary = require("../middlewares/uploadVideoCloudinary");
const uploadImage = require("../middlewares/uploadImage");

/**
 * @route   POST /api/upload/video-cloud
 * @desc    Upload video file to Cloudinary (FASTER - Recommended)
 * @access  Private
 */
router.post("/video-cloud", auth, uploadVideoCloudinary.single("video"), async (req, res) => {
  try {
    console.log(
      `☁️ Cloudinary video upload started - User: ${req.user._id}, File: ${req.file?.originalname || "unknown"}`
    );

    if (!req.file) {
      console.error("❌ Video upload failed: No file in request");
      return res.status(400).json({ message: "No video file provided" });
    }

    console.log(
      `✅ Video uploaded to Cloudinary: ${req.file.filename}, Size: ${(req.file.size / (1024 * 1024)).toFixed(2)}MB`
    );

    // Cloudinary response
    const videoUrl = req.file.path; // Cloudinary URL
    const videoDuration = req.file.duration || null; // Cloudinary provides duration

    console.log(
      `✅ Cloudinary video upload completed - URL: ${videoUrl}, Duration: ${videoDuration || "unknown"}s`
    );

    res.json({
      success: true,
      videoUrl: videoUrl,
      videoDuration: videoDuration,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      cloudinaryId: req.file.filename,
    });
  } catch (error) {
    console.error("❌ Cloudinary video upload error:", error.message);
    console.error("Stack trace:", error.stack);

    res.status(500).json({
      success: false,
      message: "Video upload failed",
      error: error.message,
    });
  }
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
