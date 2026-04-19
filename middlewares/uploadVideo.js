const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure videos directory exists
const uploadDir = path.join(__dirname, "..", "uploads", "videos");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Local disk storage for videos
const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve original filename (sanitized for safety)
    const sanitizedName = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    cb(null, sanitizedName || `video_${Date.now()}${path.extname(file.originalname)}`);
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mpeg|quicktime|x-msvideo|x-ms-wmv|avi|mov|wmv/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = file.mimetype.startsWith("video/");
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only video files (MP4, MOV, AVI, WMV, MPEG) are allowed"));
  },
});

module.exports = uploadVideo;
