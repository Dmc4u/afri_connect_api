const { queryHuggingFace, getQuickSuggestions, FALLBACK_URL } = require('../utils/aiSupport');

/**
 * Handle AI chat query
 */
const chatQuery = async (req, res, next) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    // Query AI with conversation context
    console.log('🤖 AI Support request:', message);
    const response = await queryHuggingFace(message.trim(), conversationHistory);
    console.log('🤖 AI Response:', response);

    res.json({
      success: true,
      response,
      fallbackUrl: FALLBACK_URL,
    });
  } catch (error) {
    console.error('AI Support Error:', error);
    next(error);
  }
};

/**
 * Get quick suggestion buttons
 */
const getQuickActions = async (req, res, next) => {
  try {
    const suggestions = getQuickSuggestions();

    res.json({
      success: true,
      suggestions,
      fallbackUrl: FALLBACK_URL,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Health check for AI service
 */
const healthCheck = async (req, res) => {
  const apiKeyConfigured = process.env.HUGGING_FACE_API_KEY &&
                          process.env.HUGGING_FACE_API_KEY !== 'your_huggingface_token_here';

  res.json({
    success: true,
    status: apiKeyConfigured ? 'configured' : 'fallback-mode',
    model: process.env.HUGGING_FACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2',
    fallbackUrl: FALLBACK_URL,
  });
};

module.exports = {
  chatQuery,
  getQuickActions,
  healthCheck,
};
