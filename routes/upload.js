const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const uploadVideo = require('../middlewares/uploadVideo');
const uploadImage = require('../middlewares/uploadImage');

/**
 * @route   POST /api/upload/video
 * @desc    Upload video file to local storage
 * @access  Private
 */
router.post('/video', auth, uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No video file provided' });
    }

    // Get video duration using ffprobe if available
    let videoDuration = null;
    try {
      const ffprobe = require('fluent-ffmpeg').ffprobe;
      const videoPath = req.file.path;

      // Make ffprobe async with Promise
      videoDuration = await new Promise((resolve) => {
        ffprobe(videoPath, (err, metadata) => {
          if (!err && metadata && metadata.format && metadata.format.duration) {
            const duration = Math.round(metadata.format.duration);
            console.log(`✅ Video duration detected: ${duration} seconds (${(duration/60).toFixed(1)} minutes)`);
            resolve(duration);
          } else {
            console.log('⚠️ Could not detect video duration');
            resolve(null);
          }
        });
      });
    } catch (error) {
      console.log('⚠️ ffprobe not available, video duration will not be auto-detected');
    }

    // Generate URL for the uploaded file (served from /uploads)
    const videoUrl = `${req.protocol}://${req.get('host')}/uploads/videos/${req.file.filename}`;

    res.json({
      success: true,
      videoUrl: videoUrl,
      videoDuration: videoDuration, // Video duration in seconds
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Video upload error:', error);

    res.status(500).json({
      success: false,
      message: 'Video upload failed',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/upload/image
 * @desc    Upload image file to local storage
 * @access  Private
 */
router.post('/image', auth, uploadImage.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/images/${req.file.filename}`;

    res.json({
      success: true,
      imageUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Image upload error:', error);

    res.status(500).json({
      success: false,
      message: 'Image upload failed',
      error: error.message
    });
  }
});

module.exports = router;
