const multer = require("multer");
const path = require("path");
const fs = require("fs");

function getMaxVideoUploadBytes() {
  const raw =
    process.env.UPLOAD_MAX_VIDEO_SIZE_MB ||
    process.env.UPLOAD_MAX_FILE_SIZE_MB ||
    process.env.VIDEO_UPLOAD_MAX_MB;

  const parsedMb = Number(raw);
  const maxMb = Number.isFinite(parsedMb) && parsedMb > 0 ? parsedMb : 500;
  return Math.floor(maxMb * 1024 * 1024);
}

// Temp disk storage for videos.
// We store locally first, then the route uploads to cloud storage.
const tmpUploadDir = path.join(__dirname, "..", "uploads", "tmp", "videos");
if (!fs.existsSync(tmpUploadDir)) {
  fs.mkdirSync(tmpUploadDir, { recursive: true });
}

const tmpVideoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpUploadDir),
  filename: (req, file, cb) => {
    const userId = req.user?._id || "anon";
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, `video-${userId}-${Date.now()}${ext}`);
  },
});

const uploadVideoTmp = multer({
  storage: tmpVideoStorage,
  limits: {
    fileSize: getMaxVideoUploadBytes(),
  },
  fileFilter: (req, file, cb) => {
    const allowedExt = /\.(mp4|mov|avi|wmv|mpeg|webm)$/i.test(
      path.extname(file.originalname || "")
    );
    const isVideoMime = Boolean(file.mimetype && file.mimetype.startsWith("video/"));
    if (isVideoMime && allowedExt) return cb(null, true);
    return cb(new Error("Only video files (MP4, MOV, AVI, WMV, MPEG, WEBM) are allowed"));
  },
});

module.exports = uploadVideoTmp;
