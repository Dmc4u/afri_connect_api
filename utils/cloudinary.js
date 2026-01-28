const cloudinarySdk = require("cloudinary").v2;

// Cloudinary is intentionally DISABLED by default.
// This project currently uses local disk storage (see middlewares/upload*.js).
// To enable Cloudinary, explicitly set: USE_CLOUDINARY=true
const CLOUDINARY_ENABLED = String(process.env.USE_CLOUDINARY || "").toLowerCase() === "true";

if (CLOUDINARY_ENABLED) {
  cloudinarySdk.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const disabledCloudinary = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "Cloudinary is disabled. This server is configured for local storage. Set USE_CLOUDINARY=true to enable Cloudinary uploads."
      );
    },
  }
);

module.exports = { cloudinary: CLOUDINARY_ENABLED ? cloudinarySdk : disabledCloudinary };
