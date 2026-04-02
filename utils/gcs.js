const path = require("path");
const crypto = require("crypto");

let Storage;
try {
  // Lazy dependency: only required when GCS is enabled.
  // eslint-disable-next-line global-require
  Storage = require("@google-cloud/storage").Storage;
} catch {
  Storage = null;
}

function parseBoolEnv(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  return null;
}

function getUploadProvider() {
  const provider = String(process.env.UPLOAD_PROVIDER || "")
    .trim()
    .toLowerCase();
  if (provider) return provider;
  // Default to GCS now that Cloudinary has been removed.
  return "gcs";
}

function isGcsEnabled() {
  // Only enable GCS in production environment
  const nodeEnv = String(process.env.NODE_ENV || "")
    .trim()
    .toLowerCase();
  if (nodeEnv === "development" || nodeEnv === "dev") {
    return false;
  }

  const explicit = parseBoolEnv(process.env.USE_GCS);
  if (explicit !== null) return explicit;
  return getUploadProvider() === "gcs";
}

function getGcsBucketName() {
  return String(process.env.GCS_BUCKET || "").trim();
}

function getGcsUploadPrefix() {
  const raw = String(process.env.GCS_UPLOAD_PREFIX || "afrionet").trim();
  return raw.replace(/^\/+/, "").replace(/\/+$/, "");
}

function shouldMakePublic() {
  const v = parseBoolEnv(process.env.GCS_MAKE_PUBLIC);
  return v === null ? true : v;
}

function getPublicBaseUrl() {
  const raw = String(process.env.GCS_PUBLIC_BASE_URL || "").trim();
  return raw ? raw.replace(/\/+$/, "") : "";
}

function sanitizeBasename(filename) {
  const base = path
    .basename(String(filename || "file"))
    .replace(/\s+/g, " ")
    .trim();
  // Keep it simple: allow letters/numbers/._- and spaces.
  return base.replace(/[^a-zA-Z0-9._\-\s]/g, "").replace(/\s+/g, "-");
}

function inferExt(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (!ext) return "";
  if (ext.length > 12) return "";
  return ext;
}

function buildObjectName({ resourceType, purpose, filename, customName }) {
  const prefix = getGcsUploadPrefix();
  const typeFolder = resourceType === "image" ? "images" : "videos";
  const purposeFolder = purpose === "commercial" ? "commercials" : "";

  // Use custom name if provided, otherwise use filename
  const nameToUse = customName || filename;
  const safeName = sanitizeBasename(nameToUse);
  const ext = inferExt(safeName) || inferExt(filename);
  const nonce = crypto.randomBytes(6).toString("hex");
  const ts = Date.now();

  const parts = [prefix, typeFolder];
  if (purposeFolder) parts.push(purposeFolder);
  const base = safeName ? safeName.replace(ext, "") : "upload";
  // Only add timestamp and nonce for uniqueness, but keep readable name
  parts.push(`${base || "upload"}-${nonce}${ext}`);
  return parts.filter(Boolean).join("/");
}

function getStorageClient() {
  if (!Storage) {
    throw new Error(
      "@google-cloud/storage is not installed. Run 'npm i @google-cloud/storage' in afri_connect_api."
    );
  }

  // Uses Application Default Credentials by default.
  // GOOGLE_APPLICATION_CREDENTIALS can point to a service-account json.
  return new Storage({
    projectId: process.env.GCS_PROJECT_ID || undefined,
  });
}

function getPublicUrl(bucketName, objectName) {
  const customBase = getPublicBaseUrl();
  if (customBase) return `${customBase}/${encodeURI(objectName)}`;
  return `https://storage.googleapis.com/${encodeURIComponent(bucketName)}/${encodeURI(
    objectName
  )}`;
}

async function getSignedUploadUrl({ bucketName, objectName, expiresSeconds = 15 * 60 }) {
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);

  const expires = Date.now() + expiresSeconds * 1000;
  const [url] = await file.getSignedUrl({
    version: "v4",
    action: "write",
    expires,
  });

  return url;
}

async function uploadFromPath({ bucketName, objectName, localPath, contentType }) {
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);

  await bucket.upload(localPath, {
    destination: objectName,
    resumable: false,
    metadata: {
      contentType: contentType || undefined,
      cacheControl: "public, max-age=31536000",
    },
  });

  const file = bucket.file(objectName);
  if (shouldMakePublic()) {
    try {
      await file.makePublic();
    } catch (e) {
      // If uniform bucket-level access or policy prevents it, keep going.
      // The caller can still use a CDN/custom base or adjust bucket IAM.
      console.warn("⚠️ GCS makePublic failed:", e?.message || e);
    }
  }

  return getPublicUrl(bucketName, objectName);
}

async function deleteObject({ bucketName, objectName }) {
  const storage = getStorageClient();
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(objectName);
  try {
    await file.delete({ ignoreNotFound: true });
    console.log(`✅ GCS file deleted: ${objectName}`);
  } catch (e) {
    console.warn("⚠️ GCS delete failed:", e?.message || e);
  }
}

// Helper function to extract GCS object name from URL and delete
async function deleteFromUrl(fileUrl) {
  if (!fileUrl || !isGcsEnabled()) return;

  const bucketName = getGcsBucketName();
  if (!bucketName) return;

  try {
    // Extract object name from GCS URL
    // Format: https://storage.googleapis.com/bucket-name/path/to/file.jpg
    const storagePattern = /storage\.googleapis\.com\/[^\/]+\/(.+)$/;
    const customPattern = new RegExp(`${getPublicBaseUrl()}\/(.+)$`);

    let objectName;
    if (storagePattern.test(fileUrl)) {
      objectName = decodeURIComponent(fileUrl.match(storagePattern)[1]);
    } else if (getPublicBaseUrl() && customPattern.test(fileUrl)) {
      objectName = decodeURIComponent(fileUrl.match(customPattern)[1]);
    }

    if (objectName) {
      await deleteObject({ bucketName, objectName });
    }
  } catch (e) {
    console.warn("⚠️ Failed to parse/delete GCS URL:", fileUrl, e.message);
  }
}

// Helper function to delete all media files from a listing
async function deleteListingMedia(listing) {
  if (!listing || !isGcsEnabled()) return;

  const deletePromises = [];

  // Delete all media files
  if (listing.mediaFiles && listing.mediaFiles.length > 0) {
    for (const media of listing.mediaFiles) {
      if (media.url) {
        deletePromises.push(deleteFromUrl(media.url));
      }
    }
  }

  await Promise.allSettled(deletePromises);
  console.log(`✅ Deleted ${deletePromises.length} media files for listing ${listing._id}`);
}

module.exports = {
  getUploadProvider,
  isGcsEnabled,
  getGcsBucketName,
  getGcsUploadPrefix,
  getPublicBaseUrl,
  buildObjectName,
  getPublicUrl,
  getSignedUploadUrl,
  uploadFromPath,
  deleteObject,
  deleteFromUrl,
  deleteListingMedia,
};
