const express = require('express');
const router = express.Router();
const liveShowcaseController = require('../controllers/liveShowcase');
const auth = require('../middlewares/auth');
const adminAuth = require('../middlewares/adminAuth');
const { liveEventLimiter, voteLimiter } = require('../middlewares/rateLimiter');

/**
 * Live Showcase Event Routes
 * Manages real-time talent showcase events with automatic phase transitions
 */

// Initialize event timeline (before going live)
router.post('/:showcaseId/timeline/initialize', auth, adminAuth, liveShowcaseController.initializeEventTimeline);

// Reschedule performances (if timeline exists but performances missing)
router.post('/:showcaseId/timeline/reschedule', auth, adminAuth, liveShowcaseController.reschedulePerformances);

// Start live event
router.post('/:showcaseId/start', auth, adminAuth, liveShowcaseController.startLiveEvent);

// NOTE: Event status/timeline data is provided by /talent-showcase/:id/timeline endpoint
// See: talentShowcase.getStructuredTimeline()

// Advance to next phase (admin only)
router.post('/:showcaseId/advance', auth, adminAuth, liveShowcaseController.advanceToNextPhase);

// Declare winner (during winner phase)
router.post('/:showcaseId/declare-winner', auth, adminAuth, liveShowcaseController.declareWinner);

// Vote for contestant (during voting phase)
router.post('/:showcaseId/vote', auth, voteLimiter, liveShowcaseController.voteForContestant);

// Update viewer count (called by frontend)
router.post('/:showcaseId/viewers', liveEventLimiter, liveShowcaseController.updateViewerCount);

// Update baseline viewers (admin only)
router.patch('/:showcaseId/viewers/baseline', auth, adminAuth, liveShowcaseController.updateViewerCountBase);

// Join live event (viewer tracking)
router.post('/:showcaseId/join', liveEventLimiter, liveShowcaseController.joinLiveEvent);

// Leave live event (viewer tracking)
router.post('/:showcaseId/leave', liveEventLimiter, liveShowcaseController.leaveLiveEvent);

// End event (emergency stop)
router.post('/:showcaseId/end', auth, adminAuth, liveShowcaseController.endEvent);

// Delete timeline (for testing/reset)
router.delete('/:showcaseId/timeline', auth, adminAuth, liveShowcaseController.deleteTimeline);

// Get event analytics
router.get('/:showcaseId/analytics', liveShowcaseController.getEventAnalytics);

module.exports = router;
