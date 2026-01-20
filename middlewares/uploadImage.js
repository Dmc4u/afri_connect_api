const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure images directory exists
const uploadDir = path.join(__dirname, "..", "uploads", "images");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeExt = ext && ext.length <= 10 ? ext : "";
    const uniqueSuffix = `${req.user?._id || "user"}-${Date.now()}`;
    cb(null, `image-${uniqueSuffix}${safeExt}`);
  },
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image files (jpg, jpeg, png, webp, gif) are allowed"));
  },
});

module.exports = uploadImage;
