const express = require('express');
const router = express.Router();
const TalentShowcase = require('../models/TalentShowcase');
const ShowcaseEventTimeline = require('../models/ShowcaseEventTimeline');
const auth = require('../middlewares/auth');

/**
 * Admin Live Event Management
 * Allows admins to manage event timing and configuration
 */

// Get upcoming/current live event
router.get('/current', auth, async (req, res) => {
  try {
    const now = new Date();
    const oneMonthLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Find upcoming or live event
    const showcase = await TalentShowcase.findOne({
      title: /LIVE.*Talent/i,
      eventDate: { $gte: now, $lte: oneMonthLater }
    }).sort({ eventDate: 1 }).populate('contestants');

    if (!showcase) {
      return res.status(404).json({ message: 'No upcoming event found' });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcase._id });

    res.json({
      success: true,
      event: {
        id: showcase._id,
        title: showcase.title,
        eventDate: showcase.eventDate,
        status: showcase.status,
        contestants: showcase.contestants.length,
        timeline: timeline ? {
          id: timeline._id,
          eventStatus: timeline.eventStatus,
          isLive: timeline.isLive,
          currentPhase: timeline.currentPhase,
          phases: timeline.phases,
          config: timeline.config
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching current event:', error);
    res.status(500).json({ message: 'Failed to fetch event', error: error.message });
  }
});

// Update event start time
router.put('/reschedule', auth, async (req, res) => {
  try {
    const { showcaseId, newEventDate } = req.body;

    if (!showcaseId || !newEventDate) {
      return res.status(400).json({ message: 'showcaseId and newEventDate are required' });
    }

    const eventDate = new Date(newEventDate);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }

    // Update showcase
    const showcase = await TalentShowcase.findByIdAndUpdate(
      showcaseId,
      { eventDate: eventDate },
      { new: true }
    );

    if (!showcase) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Update timeline if it exists
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (timeline && timeline.eventStatus === 'scheduled') {
      // Regenerate timeline with new start time
      timeline.actualStartTime = eventDate;
      timeline.generateTimeline();
      await timeline.save();
    }

    res.json({
      success: true,
      message: 'Event rescheduled successfully',
      eventDate: showcase.eventDate,
      timeline: timeline ? {
        phases: timeline.phases,
        config: timeline.config
      } : null
    });
  } catch (error) {
    console.error('Error rescheduling event:', error);
    res.status(500).json({ message: 'Failed to reschedule event', error: error.message });
  }
});

// Quick reschedule - start in X minutes
router.post('/start-in-minutes', auth, async (req, res) => {
  try {
    const { showcaseId, minutes } = req.body;

    if (!showcaseId || minutes === undefined) {
      return res.status(400).json({ message: 'showcaseId and minutes are required' });
    }

    const newEventDate = new Date(Date.now() + minutes * 60 * 1000);

    // Update showcase
    const showcase = await TalentShowcase.findByIdAndUpdate(
      showcaseId,
      { eventDate: newEventDate },
      { new: true }
    );

    if (!showcase) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Update timeline
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (timeline && timeline.eventStatus === 'scheduled') {
      timeline.actualStartTime = newEventDate;
      timeline.generateTimeline();
      await timeline.save();
    }

    res.json({
      success: true,
      message: `Event will start in ${minutes} minutes`,
      eventDate: showcase.eventDate,
      startsAt: showcase.eventDate.toLocaleString()
    });
  } catch (error) {
    console.error('Error rescheduling event:', error);
    res.status(500).json({ message: 'Failed to reschedule event', error: error.message });
  }
});

// Force start event now
router.post('/force-start', auth, async (req, res) => {
  try {
    const { showcaseId } = req.body;

    if (!showcaseId) {
      return res.status(400).json({ message: 'showcaseId is required' });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: 'Event timeline not found' });
    }

    // Start the event immediately
    timeline.actualStartTime = new Date();
    timeline.isLive = true;
    timeline.eventStatus = 'live';
    timeline.currentPhase = 'welcome';

    // Generate/regenerate timeline starting now
    timeline.generateTimeline();

    // Set first phase to active
    if (timeline.phases.length > 0) {
      timeline.phases[0].status = 'active';
    }

    await timeline.save();

    // Update showcase
    await TalentShowcase.findByIdAndUpdate(showcaseId, {
      status: 'live',
      liveStartTime: new Date()
    });

    res.json({
      success: true,
      message: 'Event started successfully',
      currentPhase: timeline.currentPhase,
      phases: timeline.phases
    });
  } catch (error) {
    console.error('Error starting event:', error);
    res.status(500).json({ message: 'Failed to start event', error: error.message });
  }
});

// Reduce stage time
router.post('/reduce-time', auth, async (req, res) => {
  try {
    const { showcaseId, stage, minutesToReduce } = req.body;

    if (!showcaseId || !stage || !minutesToReduce) {
      return res.status(400).json({ message: 'showcaseId, stage, and minutesToReduce are required' });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: 'Event timeline not found' });
    }

    // Find the phase
    const phase = timeline.phases.find(p => p.name === stage);
    if (!phase) {
      return res.status(404).json({ message: 'Stage not found' });
    }

    // Check if reducing will make the phase duration negative
    const currentDuration = (new Date(phase.endTime) - new Date(phase.startTime)) / 60000; // in minutes
    if (currentDuration - minutesToReduce < 1) {
      return res.status(400).json({ message: 'Cannot reduce time below 1 minute' });
    }

    // Reduce the phase end time
    const reductionMs = minutesToReduce * 60 * 1000;
    phase.endTime = new Date(phase.endTime.getTime() - reductionMs);

    // Update all subsequent phases
    const phaseIndex = timeline.phases.findIndex(p => p.name === stage);
    for (let i = phaseIndex + 1; i < timeline.phases.length; i++) {
      timeline.phases[i].startTime = new Date(timeline.phases[i].startTime.getTime() - reductionMs);
      timeline.phases[i].endTime = new Date(timeline.phases[i].endTime.getTime() - reductionMs);
    }

    // Record the reduction
    if (!timeline.timeExtensions) {
      timeline.timeExtensions = [];
    }
    timeline.timeExtensions.push({
      stage,
      additionalMinutes: -minutesToReduce,
      addedAt: new Date()
    });

    await timeline.save();

    res.json({
      success: true,
      message: `Reduced ${stage} by ${minutesToReduce} minutes`,
      liveEventControl: {
        currentStage: timeline.currentPhase?.name || timeline.currentPhase,
        timeExtensions: timeline.timeExtensions
      }
    });
  } catch (error) {
    console.error('Error reducing stage time:', error);
    res.status(500).json({ message: 'Failed to reduce stage time', error: error.message });
  }
});

// Control background music (play/stop)
router.patch('/music-control', auth, async (req, res) => {
  try {
    const { showcaseId, action } = req.body;

    if (!showcaseId || !action) {
      return res.status(400).json({ message: 'showcaseId and action are required' });
    }

    if (!['play', 'stop'].includes(action)) {
      return res.status(400).json({ message: 'action must be "play" or "stop"' });
    }

    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Update music playing state
    const musicPlaying = action === 'play';
    showcase.musicPlaying = musicPlaying;
    await showcase.save();

    res.json({
      success: true,
      message: `Music ${action === 'play' ? 'started' : 'stopped'} successfully`,
      musicPlaying
    });
  } catch (error) {
    console.error('Error controlling music:', error);
    res.status(500).json({ message: 'Failed to control music', error: error.message });
  }
});

// Stop/End event
router.post('/stop', auth, async (req, res) => {
  try {
    const { showcaseId } = req.body;

    if (!showcaseId) {
      return res.status(400).json({ message: 'showcaseId is required' });
    }

    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });
    if (!timeline) {
      return res.status(404).json({ message: 'Event timeline not found' });
    }

    timeline.isLive = false;
    timeline.eventStatus = 'completed';
    timeline.currentPhase = 'ended';
    await timeline.save();

    await TalentShowcase.findByIdAndUpdate(showcaseId, {
      status: 'completed'
    });

    res.json({
      success: true,
      message: 'Event stopped successfully'
    });
  } catch (error) {
    console.error('Error stopping event:', error);
    res.status(500).json({ message: 'Failed to stop event', error: error.message });
  }
});

module.exports = router;
