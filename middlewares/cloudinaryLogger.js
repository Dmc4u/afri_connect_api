// middlewares/cloudinaryLogger.js
module.exports = (req, res, next) => {
  console.log("=== Upload Debug Info ===");
  if (!req.file) {
    console.error("❌ No file received. Check field name — expected 'file' or 'photo'.");
  } else {
    console.log({
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  }
  console.log("==========================");
  next();
};
