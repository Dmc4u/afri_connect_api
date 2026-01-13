const express = require('express');
const router = express.Router();
const liveShowcaseController = require('../controllers/liveShowcase');
const auth = require('../middlewares/auth');

/**
 * Live Showcase Event Routes
 * Manages real-time talent showcase events with automatic phase transitions
 */

// Initialize event timeline (before going live)
router.post('/:showcaseId/timeline/initialize', auth, liveShowcaseController.initializeEventTimeline);

// Reschedule performances (if timeline exists but performances missing)
router.post('/:showcaseId/timeline/reschedule', auth, liveShowcaseController.reschedulePerformances);

// Start live event
router.post('/:showcaseId/start', auth, liveShowcaseController.startLiveEvent);

// NOTE: Event status/timeline data is provided by /talent-showcase/:id/timeline endpoint
// See: talentShowcase.getStructuredTimeline()

// Advance to next phase (admin only)
router.post('/:showcaseId/advance', auth, liveShowcaseController.advanceToNextPhase);

// Declare winner (during winner phase)
router.post('/:showcaseId/declare-winner', auth, liveShowcaseController.declareWinner);

// Vote for contestant (during voting phase)
router.post('/:showcaseId/vote', auth, liveShowcaseController.voteForContestant);

// Update viewer count (called by frontend)
router.post('/:showcaseId/viewers', liveShowcaseController.updateViewerCount);

// Update baseline viewers (admin only)
router.patch('/:showcaseId/viewers/baseline', auth, liveShowcaseController.updateViewerCountBase);

// Join live event (viewer tracking)
router.post('/:showcaseId/join', liveShowcaseController.joinLiveEvent);

// Leave live event (viewer tracking)
router.post('/:showcaseId/leave', liveShowcaseController.leaveLiveEvent);

// End event (emergency stop)
router.post('/:showcaseId/end', auth, liveShowcaseController.endEvent);

// Delete timeline (for testing/reset)
router.delete('/:showcaseId/timeline', auth, liveShowcaseController.deleteTimeline);

// Get event analytics
router.get('/:showcaseId/analytics', liveShowcaseController.getEventAnalytics);

module.exports = router;
