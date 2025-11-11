const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("../utils/cloudinary");

const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "afrionet/profiles",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    public_id: `${req.user._id}-${Date.now()}`,
    transformation: [{ width: 400, height: 400, crop: "fill", gravity: "face" }],
  }),
});

const uploadProfile = multer({ storage: profileStorage });
module.exports = uploadProfile;
