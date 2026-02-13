function isCloudinaryUrl(value) {
  if (!value) return false;
  const raw = String(value);
  try {
    const url = new URL(raw);
    const host = String(url.hostname || "").toLowerCase();
    return host === "res.cloudinary.com" || host.endsWith(".cloudinary.com");
  } catch {
    return raw.toLowerCase().includes("res.cloudinary.com/");
  }
}

function stripCloudinaryUrl(value) {
  if (!value) return value;
  return isCloudinaryUrl(value) ? null : value;
}

function sanitizeMediaFiles(mediaFiles) {
  if (!Array.isArray(mediaFiles)) return mediaFiles;

  return mediaFiles
    .map((file) => {
      if (!file) return null;
      if (typeof file === "string") {
        const url = stripCloudinaryUrl(file);
        return url ? url : null;
      }

      if (typeof file === "object") {
        const url = stripCloudinaryUrl(file.url || file.src);
        if (!url) return null;
        return { ...file, url };
      }

      return null;
    })
    .filter(Boolean);
}

module.exports = {
  isCloudinaryUrl,
  stripCloudinaryUrl,
  sanitizeMediaFiles,
};
