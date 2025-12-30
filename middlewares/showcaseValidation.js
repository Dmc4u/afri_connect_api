const { body, param, query, validationResult } = require('express-validator');

// Validation middleware to check for errors
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array()
    });
  }
  next();
};

// Showcase creation validation
const validateShowcaseCreation = [
  body('title')
    .trim()
    .notEmpty().withMessage('Title is required')
    .isLength({ min: 5, max: 200 }).withMessage('Title must be 5-200 characters'),

  body('description')
    .trim()
    .notEmpty().withMessage('Description is required')
    .isLength({ min: 20, max: 2000 }).withMessage('Description must be 20-2000 characters'),

  body('category')
    .isIn(['Dance', 'Music', 'Comedy', 'Art', 'Fashion', 'Acting', 'Mixed'])
    .withMessage('Invalid category'),

  body('competitionType')
    .isIn(['country-vs-country', 'talent-vs-talent', 'open-category'])
    .withMessage('Invalid competition type'),

  body('eventDate')
    .isISO8601().withMessage('Invalid event date')
    .custom((value) => {
      const date = new Date(value);
      if (date < new Date()) {
        throw new Error('Event date must be in the future');
      }
      return true;
    }),

  body('votingStartTime')
    .optional()
    .isISO8601().withMessage('Invalid voting start time'),

  body('votingEndTime')
    .optional()
    .isISO8601().withMessage('Invalid voting end time')
    .custom((value, { req }) => {
      if (!req.body.votingStartTime) {
        return true; // Skip validation if votingStartTime is not provided
      }
      const start = new Date(req.body.votingStartTime);
      const end = new Date(value);
      if (end <= start) {
        throw new Error('Voting end time must be after start time');
      }
      const duration = (end - start) / (1000 * 60); // minutes
      if (duration > 120) {
        throw new Error('Voting window cannot exceed 2 hours');
      }
      return true;
    }),

  body('streamUrl')
    .optional({ checkFalsy: true })
    .custom((value, { req }) => {
      // Only validate streamUrl if hasLiveStream is true
      if (req.body.hasLiveStream === true || req.body.hasLiveStream === 'true') {
        if (value && value.trim() !== '') {
          // Check if it's a valid URL
          const urlPattern = /^(https?:\/\/)([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?/;
          if (!urlPattern.test(value)) {
            throw new Error('Invalid stream URL');
          }
        }
      }
      return true;
    }),

  body('prizeDetails.amount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Prize amount must be positive'),

  body('commercialDuration')
    .optional()
    .isFloat({ min: 0, max: 3 }).withMessage('Commercial duration must be between 0 and 3 minutes'),

  body('commercialContent')
    .optional()
    .trim()
    .isLength({ max: 2000 }).withMessage('Commercial content cannot exceed 2000 characters'),

  body('commercials')
    .optional()
    .isArray().withMessage('Commercials must be an array'),

  body('commercials.*.title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Commercial title must be 1-100 characters'),

  body('commercials.*.duration')
    .optional()
    .isInt({ min: 1, max: 45 }).withMessage('Commercial duration must be between 1 and 45 seconds'),

  body('commercials.*.videoUrl')
    .optional()
    .trim()
    .notEmpty().withMessage('Commercial video URL is required'),

  validate
];

// Contestant registration validation
const validateContestantRegistration = [
  body('showcaseId')
    .notEmpty().withMessage('Showcase ID is required')
    .isMongoId().withMessage('Invalid showcase ID'),

  body('performanceTitle')
    .trim()
    .notEmpty().withMessage('Performance title is required')
    .isLength({ min: 3, max: 150 }).withMessage('Title must be 3-150 characters'),

  body('performanceDescription')
    .trim()
    .notEmpty().withMessage('Performance description is required')
    .isLength({ min: 10, max: 1000 }).withMessage('Description must be 10-1000 characters'),

  body('country')
    .trim()
    .notEmpty().withMessage('Country is required'),

  body('videoUrl')
    .notEmpty().withMessage('Video URL is required')
    .custom((value) => {
      // Accept YouTube URLs or uploaded video URLs (localhost or production)
      const isYouTube = value.includes('youtube.com') || value.includes('youtu.be');
      const isUploadedVideo = value.startsWith('http://') || value.startsWith('https://');

      if (!isYouTube && !isUploadedVideo) {
        throw new Error('Invalid video URL');
      }
      return true;
    }).withMessage('Invalid video URL'),

  body('thumbnailUrl')
    .optional({ checkFalsy: true })
    .isURL().withMessage('Invalid thumbnail URL'),

  body('socialMedia')
    .optional({ checkFalsy: true })
    .isObject().withMessage('Social media must be an object'),

  body('socialMedia.instagram')
    .optional({ checkFalsy: true })
    .isURL().withMessage('Invalid Instagram URL'),

  body('socialMedia.twitter')
    .optional({ checkFalsy: true })
    .isURL().withMessage('Invalid Twitter URL'),

  body('socialMedia.youtube')
    .optional({ checkFalsy: true })
    .isURL().withMessage('Invalid YouTube URL'),

  body('listingId')
    .optional()
    .isMongoId().withMessage('Invalid listing ID'),

  validate
];

// Vote validation
const validateVote = [
  param('showcaseId')
    .notEmpty().withMessage('Showcase ID is required')
    .isMongoId().withMessage('Invalid showcase ID'),

  body('contestantId')
    .notEmpty().withMessage('Contestant ID is required')
    .isMongoId().withMessage('Invalid contestant ID'),

  validate
];

// Query validation for listing showcases
const validateShowcaseQuery = [
  query('status')
    .optional()
    .isIn(['upcoming', 'nomination', 'live', 'voting', 'completed', 'cancelled'])
    .withMessage('Invalid status'),

  query('category')
    .optional()
    .isIn(['Dance', 'Music', 'Comedy', 'Art', 'Fashion', 'Acting', 'Mixed'])
    .withMessage('Invalid category'),

  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),

  validate
];

// ID parameter validation
const validateShowcaseId = [
  param('id')
    .isMongoId().withMessage('Invalid showcase ID'),

  validate
];

const validateContestantId = [
  param('id')
    .isMongoId().withMessage('Invalid contestant ID'),

  validate
];

// Judge score validation
const validateJudgeScore = [
  body('contestantId')
    .notEmpty().withMessage('Contestant ID is required')
    .isMongoId().withMessage('Invalid contestant ID'),

  body('judgeName')
    .trim()
    .notEmpty().withMessage('Judge name is required'),

  body('score')
    .isFloat({ min: 0, max: 10 }).withMessage('Score must be between 0 and 10'),

  body('comment')
    .optional()
    .isLength({ max: 500 }).withMessage('Comment cannot exceed 500 characters'),

  validate
];

// Commercial video upload validation
const validateCommercialUpload = [
  param('showcaseId')
    .notEmpty().withMessage('Showcase ID is required')
    .isMongoId().withMessage('Invalid showcase ID'),

  body('title')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Title must be 1-100 characters'),

  validate
];

// Commercial deletion validation
const validateCommercialDeletion = [
  param('showcaseId')
    .notEmpty().withMessage('Showcase ID is required')
    .isMongoId().withMessage('Invalid showcase ID'),

  param('commercialIndex')
    .notEmpty().withMessage('Commercial index is required')
    .isInt({ min: 0 }).withMessage('Commercial index must be a non-negative integer'),

  validate
];

// Time adjustment validation (for extend/reduce stage time)
const validateTimeAdjustment = [
  param('id')
    .notEmpty().withMessage('Showcase ID is required')
    .isMongoId().withMessage('Invalid showcase ID'),

  body('additionalMinutes')
    .notEmpty().withMessage('Additional minutes is required')
    .isFloat().withMessage('Additional minutes must be a number')
    .custom((value) => {
      // Allow both positive (extend) and negative (reduce) values
      // Max extend: 120 minutes, Max reduce: -120 minutes
      if (value > 120 || value < -120) {
        throw new Error('Time adjustment must be between -120 and 120 minutes');
      }
      if (value === 0) {
        throw new Error('Time adjustment cannot be zero');
      }
      return true;
    }),

  body('stage')
    .optional()
    .isIn(['welcome', 'performance', 'commercial', 'voting', 'winner', 'thankyou', 'countdown'])
    .withMessage('Invalid stage name'),

  validate
];

module.exports = {
  validateShowcaseCreation,
  validateContestantRegistration,
  validateVote,
  validateShowcaseQuery,
  validateShowcaseId,
  validateContestantId,
  validateJudgeScore,
  validateCommercialUpload,
  validateCommercialDeletion,
  validateTimeAdjustment
};
