const router = require('express').Router();
const { chatQuery, getQuickActions, healthCheck } = require('../controllers/aiSupport');

// Public routes - no authentication required
router.post('/chat', chatQuery);
router.get('/suggestions', getQuickActions);
router.get('/health', healthCheck);

module.exports = router;
