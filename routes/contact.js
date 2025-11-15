const express = require('express');
const router = express.Router();
const { sendSupportMessage } = require('../controllers/contact');
const { Joi, celebrate } = require('celebrate');
const verifyRecaptcha = require('../middlewares/recaptcha');

/**
 * @route   POST /contact/support
 * @desc    Send message to support@dmclimited.net
 * @access  Public
 */
router.post(
  '/support',
  celebrate({
    body: Joi.object().keys({
      name: Joi.string().required().min(2).max(100).messages({
        'string.min': 'Name must be at least 2 characters',
        'string.max': 'Name must not exceed 100 characters',
        'string.empty': 'Name is required',
      }),
      email: Joi.string().required().email().messages({
        'string.email': 'Invalid email address',
        'string.empty': 'Email is required',
      }),
      subject: Joi.string().required().min(3).max(200).messages({
        'string.min': 'Subject must be at least 3 characters',
        'string.max': 'Subject must not exceed 200 characters',
        'string.empty': 'Subject is required',
      }),
      message: Joi.string().required().min(10).max(4000).messages({
        'string.min': 'Message must be at least 10 characters',
        'string.max': 'Message must not exceed 4000 characters',
        'string.empty': 'Message is required',
      }),
      recaptchaToken: Joi.string().allow(null, '').optional(), // Allow reCAPTCHA token
    }),
  }),
  // verifyRecaptcha, // Temporarily disabled for testing
  sendSupportMessage
);

module.exports = router;
