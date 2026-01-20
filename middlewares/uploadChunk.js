const multer = require("multer");

// Keep chunk size conservative so it passes through proxies/CDNs.
// Default 8MB; can be overridden per-request via route-level limits.
const DEFAULT_MAX_CHUNK_BYTES = Number(process.env.UPLOAD_CHUNK_MAX_BYTES || 8 * 1024 * 1024);

const uploadChunk = (maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES) =>
  multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxChunkBytes,
    },
  });

module.exports = uploadChunk;
