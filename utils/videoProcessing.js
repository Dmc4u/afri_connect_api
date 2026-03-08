const fs = require("fs");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

/**
 * Detect video duration using ffprobe (requires ffmpeg/ff probe installed)
 * @param {string} filePath - Path to the video file
 * @returns {Promise<number>} Duration in seconds
 */
async function detectVideoDuration(filePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error("Video file not found");
    }

    // Try using ffprobe first (most reliable)
    try {
      const { stdout } = await exec(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
      );
      const duration = parseFloat(stdout.trim());

      if (duration && duration > 0) {
        console.log(`✅ ffprobe detected duration: ${duration}s`);
        return Math.round(duration);
      }
    } catch (ffprobeError) {
      console.log(`⚠️ ffprobe not available: ${ffprobeError.message}`);
    }

    // Fallback: Try using fluent-ffmpeg if available
    try {
      const ffmpeg = require("fluent-ffmpeg");

      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            return reject(err);
          }

          const duration = metadata.format.duration;
          if (duration && duration > 0) {
            console.log(`✅ fluent-ffmpeg detected duration: ${duration}s`);
            resolve(Math.round(duration));
          } else {
            reject(new Error("Could not detect video duration"));
          }
        });
      });
    } catch (ffmpegError) {
      console.log(`⚠️ fluent-ffmpeg not available: ${ffmpegError.message}`);
    }

    // Fallback: Try mp4box or other tools
    try {
      const { stdout } = await exec(`mp4info "${filePath}" | grep "sec."`);
      const match = stdout.match(/(\d+\.?\d*)\s*sec/);
      if (match) {
        const duration = parseFloat(match[1]);
        console.log(`✅ mp4info detected duration: ${duration}s`);
        return Math.round(duration);
      }
    } catch (mp4Error) {
      console.log(`⚠️ mp4info not available: ${mp4Error.message}`);
    }

    throw new Error("No video duration detection tool available. Please install ffmpeg/ffprobe.");
  } catch (error) {
    console.error("❌ Error detecting video duration:", error);
    throw error;
  }
}

/**
 * Validate video file
 * @param {Object} file - Multer file object
 * @returns {Object} Validation result
 */
function validateVideoFile(file) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime"];

  if (!file) {
    return { valid: false, error: "No file provided" };
  }

  if (file.size > MAX_SIZE) {
    return { valid: false, error: `File too large. Maximum size is 50MB` };
  }

  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    return { valid: false, error: "Invalid file type. Only MP4, WebM, OGG, MOV are supported" };
  }

  return { valid: true };
}

module.exports = {
  detectVideoDuration,
  validateVideoFile,
};
