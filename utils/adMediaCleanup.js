const Advertisement = require("../models/Advertisement");
const {
  isGcsEnabled,
  getGcsBucketName,
  getGcsUploadPrefix,
  getPublicBaseUrl,
  deleteObject,
} = require("./gcs");

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

function safeDecodePath(pathname) {
  try {
    // pathname is already URL-decoded in WHATWG URL, but keep this defensive.
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function isLikelyUrl(value) {
  const s = String(value || "")
    .trim()
    .toLowerCase();
  return s.startsWith("http://") || s.startsWith("https://");
}

function normalizeObjectName(value) {
  const name = String(value || "")
    .trim()
    .replace(/^\/+/, "");
  if (!name) return null;
  if (name.includes("..")) return null;
  return name;
}

function extractGcsObjectNameFromUrl(urlString, bucketName) {
  try {
    const raw = String(urlString || "").trim();
    if (!raw) return null;

    const publicBase = getPublicBaseUrl();
    if (publicBase && raw.startsWith(publicBase + "/")) {
      return normalizeObjectName(safeDecodePath(raw.slice(publicBase.length + 1)));
    }

    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const pathname = safeDecodePath(url.pathname || "");

    // https://storage.googleapis.com/<bucket>/<object>
    if (host === "storage.googleapis.com") {
      const prefix = `/${bucketName}/`;
      if (pathname.startsWith(prefix)) {
        return normalizeObjectName(pathname.slice(prefix.length));
      }
    }

    // https://<bucket>.storage.googleapis.com/<object>
    if (host === `${bucketName}.storage.googleapis.com`) {
      return normalizeObjectName(pathname.replace(/^\//, ""));
    }

    return null;
  } catch {
    return null;
  }
}

function extractGcsObjectName({ filename, url, bucketName, uploadPrefix }) {
  const fileNameStr = String(filename || "").trim();
  if (fileNameStr && !isLikelyUrl(fileNameStr)) {
    const candidate = normalizeObjectName(fileNameStr);
    if (candidate && candidate.startsWith(`${uploadPrefix}/`)) return candidate;
  }

  const fromUrl = extractGcsObjectNameFromUrl(url, bucketName);
  if (fromUrl && fromUrl.startsWith(`${uploadPrefix}/`)) return fromUrl;

  return null;
}

async function runAdMediaCleanupOnce({ limit = 50 } = {}) {
  const enabled = parseBool(process.env.AD_MEDIA_AUTO_DELETE, true);
  if (!enabled) {
    return { ok: true, skipped: true, reason: "AD_MEDIA_AUTO_DELETE disabled" };
  }

  if (!isGcsEnabled()) {
    return { ok: true, skipped: true, reason: "GCS not enabled" };
  }

  const bucketName = getGcsBucketName();
  if (!bucketName) {
    return { ok: false, skipped: true, reason: "Missing GCS_BUCKET" };
  }

  const uploadPrefix = getGcsUploadPrefix();
  if (!uploadPrefix) {
    return { ok: false, skipped: true, reason: "Missing GCS_UPLOAD_PREFIX" };
  }

  const now = new Date();

  // Only clean ads that have ended and were not cleaned before.
  const candidates = await Advertisement.find({
    endDate: { $lt: now },
    $or: [{ "mediaCleanup.deletedAt": { $exists: false } }, { "mediaCleanup.deletedAt": null }],
  })
    .sort({ endDate: 1 })
    .limit(limit)
    .lean();

  let cleanedCount = 0;
  let skippedCount = 0;
  let deletedObjectsCount = 0;

  for (const ad of candidates) {
    const deletedObjects = new Set();

    const mediaFiles = Array.isArray(ad.mediaFiles) ? ad.mediaFiles : [];
    for (const file of mediaFiles) {
      const objectName = extractGcsObjectName({
        filename: file?.filename,
        url: file?.url,
        bucketName,
        uploadPrefix,
      });
      if (objectName) deletedObjects.add(objectName);
    }

    // Legacy fields (only if they look like our GCS objects)
    const legacyImage = extractGcsObjectName({
      filename: null,
      url: ad.imageUrl,
      bucketName,
      uploadPrefix,
    });
    if (legacyImage) deletedObjects.add(legacyImage);

    const legacyVideo = extractGcsObjectName({
      filename: null,
      url: ad.videoUrl,
      bucketName,
      uploadPrefix,
    });
    if (legacyVideo) deletedObjects.add(legacyVideo);

    const objectNames = Array.from(deletedObjects);

    try {
      for (const objectName of objectNames) {
        await deleteObject({ bucketName, objectName });
      }

      deletedObjectsCount += objectNames.length;

      const update = {
        "mediaCleanup.checkedAt": now,
        "mediaCleanup.deletedAt": now,
        "mediaCleanup.deletedObjects": objectNames,
        "mediaCleanup.lastError": null,
      };

      // Mark status completed if it is still active and ended.
      if (String(ad.status || "").toLowerCase() === "active") {
        update.status = "completed";
      }

      await Advertisement.updateOne(
        { _id: ad._id },
        {
          $set: update,
        }
      );

      cleanedCount += 1;
    } catch (e) {
      skippedCount += 1;
      const msg = String(e?.message || e || "cleanup failed");
      await Advertisement.updateOne(
        { _id: ad._id },
        {
          $set: {
            "mediaCleanup.checkedAt": now,
            "mediaCleanup.lastError": msg.slice(0, 1000),
          },
        }
      );
      // Keep going with other ads.
      // eslint-disable-next-line no-console
      console.warn("⚠️ Ad media cleanup failed:", { adId: String(ad._id), message: msg });
    }
  }

  return {
    ok: true,
    checked: candidates.length,
    cleaned: cleanedCount,
    skipped: skippedCount,
    deletedObjects: deletedObjectsCount,
  };
}

function startAdMediaCleanupJob({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  const enabled = parseBool(process.env.AD_MEDIA_AUTO_DELETE, true);
  if (!enabled) {
    // eslint-disable-next-line no-console
    console.log("ℹ️ Ad media cleanup job disabled (AD_MEDIA_AUTO_DELETE=false)");
    return null;
  }

  let stopped = false;

  async function tick() {
    if (stopped) return;

    // Wait for Mongo connection.
    const readyState = require("mongoose").connection?.readyState;
    if (readyState !== 1) {
      // eslint-disable-next-line no-console
      console.log("ℹ️ Ad media cleanup: Mongo not connected yet; will retry later");
      return;
    }

    const result = await runAdMediaCleanupOnce();
    if (result?.skipped) {
      // eslint-disable-next-line no-console
      console.log("ℹ️ Ad media cleanup skipped:", result.reason);
      return;
    }

    // eslint-disable-next-line no-console
    console.log("🧹 Ad media cleanup:", result);
  }

  // Run shortly after boot, then on interval.
  const initialTimeout = setTimeout(
    () => {
      tick().catch((e) =>
        // eslint-disable-next-line no-console
        console.warn("⚠️ Ad media cleanup initial tick failed:", e?.message || e)
      );
    },
    2 * 60 * 1000
  );

  const interval = setInterval(() => {
    tick().catch((e) =>
      // eslint-disable-next-line no-console
      console.warn("⚠️ Ad media cleanup tick failed:", e?.message || e)
    );
  }, intervalMs);

  interval.unref?.();

  return {
    stop() {
      stopped = true;
      clearTimeout(initialTimeout);
      clearInterval(interval);
    },
  };
}

module.exports = {
  runAdMediaCleanupOnce,
  startAdMediaCleanupJob,
};
