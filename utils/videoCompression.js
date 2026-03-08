const fs = require("fs");
const path = require("path");
const util = require("util");
const exec = util.promisify(require("child_process").exec);

/**
 * Compress video using FFmpeg
 * Reduces file size while maintaining reasonable quality
 * @param {string} inputPath - Path to input video file
 * @param {Object} options - Compression options
 * @returns {Promise<{outputPath: string, originalSize: number, compressedSize: number}>}
 */
async function compressVideo(inputPath, options = {}) {
  const {
    maxWidth = 1280, // Max width (720p)
    videoBitrate = "1500k", // Video bitrate
    audioBitrate = "128k", // Audio bitrate
    fps = 30, // Frame rate
    crf = 23, // Constant Rate Factor (18-28, lower = better quality)
  } = options;

  try {
    // Check if input file exists
    if (!fs.existsSync(inputPath)) {
      throw new Error("Input video file not found");
    }

    // Get original file size
    const originalStats = fs.statSync(inputPath);
    const originalSize = originalStats.size;
    const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(2);

    console.log(`🎬 Starting video compression: ${originalSizeMB}MB`);

    // Generate output path
    const ext = path.extname(inputPath);
    const basename = path.basename(inputPath, ext);
    const dirname = path.dirname(inputPath);
    const outputPath = path.join(dirname, `${basename}-compressed${ext}`);

    // Build FFmpeg command
    // -i: input file
    // -vf: video filter (scale to max width, maintain aspect ratio)
    // -c:v: video codec (libx264)
    // -crf: quality (23 is default, lower = better quality)
    // -preset: encoding speed (faster = quicker but larger file)
    // -c:a: audio codec (aac)
    // -b:a: audio bitrate
    // -movflags: optimize for web streaming
    const ffmpegCmd = `ffmpeg -i "${inputPath}" \
      -vf "scale='min(${maxWidth},iw)':'min(${maxWidth}*ih/iw,ih)':force_original_aspect_ratio=decrease" \
      -c:v libx264 \
      -crf ${crf} \
      -preset medium \
      -r ${fps} \
      -c:a aac \
      -b:a ${audioBitrate} \
      -movflags +faststart \
      -y "${outputPath}"`;

    console.log("🔄 Compressing video with FFmpeg...");

    try {
      await exec(ffmpegCmd);
    } catch (execError) {
      console.error("❌ FFmpeg compression failed:", execError.message);

      // Try alternative compression with fluent-ffmpeg if available
      try {
        const ffmpeg = require("fluent-ffmpeg");
        console.log("🔄 Trying compression with fluent-ffmpeg...");

        await new Promise((resolve, reject) => {
          ffmpeg(inputPath)
            .videoCodec("libx264")
            .size(`${maxWidth}x?`)
            .videoBitrate(videoBitrate)
            .fps(fps)
            .audioCodec("aac")
            .audioBitrate(audioBitrate)
            .outputOptions(["-crf " + crf, "-preset medium", "-movflags +faststart"])
            .output(outputPath)
            .on("end", () => resolve())
            .on("error", (err) => reject(err))
            .run();
        });
      } catch (fluentError) {
        console.error("❌ fluent-ffmpeg also failed:", fluentError.message);
        throw new Error("Video compression failed. FFmpeg may not be installed on the server.");
      }
    }

    // Verify output file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error("Compression completed but output file not found");
    }

    // Get compressed file size
    const compressedStats = fs.statSync(outputPath);
    const compressedSize = compressedStats.size;
    const compressedSizeMB = (compressedSize / (1024 * 1024)).toFixed(2);
    const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);

    console.log(
      `✅ Video compressed: ${originalSizeMB}MB → ${compressedSizeMB}MB (${compressionRatio}% reduction)`
    );

    return {
      outputPath,
      originalSize,
      compressedSize,
      compressionRatio: parseFloat(compressionRatio),
    };
  } catch (error) {
    console.error("❌ Video compression error:", error);
    throw error;
  }
}

/**
 * Check if video should be compressed based on duration
 * @param {number} duration - Video duration in seconds
 * @returns {boolean}
 */
function shouldCompressVideo(duration) {
  // Compress videos longer than 15 seconds
  return duration > 15;
}

module.exports = {
  compressVideo,
  shouldCompressVideo,
};
