const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("../utils/cloudinary");

// Cloudinary storage for videos (faster, CDN-backed)
// Note: Free tier has 100MB upload limit for videos
const videoCloudinaryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "afrionet/videos",
    resource_type: "video",
    allowed_formats: ["mp4", "mov", "avi", "wmv", "mpeg", "webm"],
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  },
});

const uploadVideoCloudinary = multer({
  storage: videoCloudinaryStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit (Cloudinary free tier max for videos)
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /mp4|mpeg|quicktime|x-msvideo|x-ms-wmv|avi|mov|wmv|webm/;
    const mimetype = file.mimetype.startsWith("video/");
    if (mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only video files are allowed"));
  },
});

module.exports = uploadVideoCloudinary;
