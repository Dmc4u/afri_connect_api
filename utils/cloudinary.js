const cloudinarySdk = require("cloudinary").v2;

function parseBoolEnv(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "n" || v === "off") return false;
  return null;
}

// Cloudinary enablement rules:
// - If USE_CLOUDINARY is explicitly set, respect it.
// - Otherwise, auto-enable in production when credentials exist.
// This prevents confusing production failures where credentials are set but the
// upload route errors because USE_CLOUDINARY was omitted.
const useCloudinaryEnv = parseBoolEnv(process.env.USE_CLOUDINARY);
const hasCloudinaryCreds = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);
const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
const CLOUDINARY_ENABLED =
  useCloudinaryEnv !== null ? useCloudinaryEnv : Boolean(isProd && hasCloudinaryCreds);

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

module.exports = {
  cloudinary: CLOUDINARY_ENABLED ? cloudinarySdk : disabledCloudinary,
  cloudinarySdk,
  isCloudinaryEnabled: CLOUDINARY_ENABLED,
  cloudinaryEnabled: CLOUDINARY_ENABLED,
};
