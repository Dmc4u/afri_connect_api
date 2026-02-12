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

function buildObjectName({ resourceType, purpose, filename }) {
  const prefix = getGcsUploadPrefix();
  const typeFolder = resourceType === "image" ? "images" : "videos";
  const purposeFolder = purpose === "commercial" ? "commercials" : "";
  const safeName = sanitizeBasename(filename);
  const ext = inferExt(safeName) || inferExt(filename);
  const nonce = crypto.randomBytes(6).toString("hex");
  const ts = Date.now();

  const parts = [prefix, typeFolder];
  if (purposeFolder) parts.push(purposeFolder);
  const base = safeName ? safeName.replace(ext, "") : "upload";
  parts.push(`${base || "upload"}-${ts}-${nonce}${ext}`);
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
  } catch (e) {
    console.warn("⚠️ GCS delete failed:", e?.message || e);
  }
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
};
