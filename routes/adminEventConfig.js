const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const ShowcaseEventTimeline = require('../models/ShowcaseEventTimeline');
const TalentShowcase = require('../models/TalentShowcase');

/**
 * Admin Event Timeline Configuration Routes
 * Allows admins to manage event phase durations and settings
 */

// Get event configuration template
router.get('/config/template', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // TEST MODE: Faster intervals for testing
    const defaultConfig = {
      totalDuration: 15,              // 15 min (normal: 60)
      welcomeDuration: 1,             // 1 min (normal: 5)
      performanceSlotDuration: 2,     // 2 min per contestant (normal: 5)
      maxVideoLength: 3600,           // 3600 sec = 1 hour (normal: 3600)
      commercialDuration: 1,          // 1 min (normal: 5)
      votingDuration: 3,              // 3 min (normal: 20)
      winnerDeclarationDuration: 1,   // 1 min (normal: 3)
      thankYouDuration: 1             // 1 min (normal: 2)
    };

    res.json({
      success: true,
      config: defaultConfig,
      phases: [
        { name: 'welcome', description: 'Welcome & Rules', defaultDuration: 1 },
        { name: 'performance', description: 'Contestant Performances (auto-calculated)', perContestant: 2 },
        { name: 'commercial', description: 'Commercial Break', defaultDuration: 1 },
        { name: 'voting', description: 'Voting Period', defaultDuration: 3 },
        { name: 'winner', description: 'Winner Declaration', defaultDuration: 1 },
        { name: 'thankyou', description: 'Thank You Message', defaultDuration: 1 }
      ]
    });
  } catch (error) {
    console.error('Error getting config template:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update event timeline configuration
router.put('/:showcaseId/config', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { showcaseId } = req.params;
    const { config } = req.body;

    // Validate config
    if (!config) {
      return res.status(400).json({ message: 'Configuration is required' });
    }

    // Get showcase
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: 'Showcase not found' });
    }

    // Find or create timeline
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      // Create new timeline with config - TEST MODE values
      timeline = new ShowcaseEventTimeline({
        showcase: showcaseId,
        config: {
          totalDuration: 15,
          welcomeDuration: 1,
          performanceSlotDuration: 2,
          maxVideoLength: 90,
          commercialDuration: 1,
          votingDuration: 3,
          winnerDeclarationDuration: 1,
          thankYouDuration: 1,
          ...config
        },
        eventStatus: 'scheduled',
        isLive: false,
        phases: [],
        performances: []
      });
    } else {
      // Check if event is already live
      if (timeline.isLive) {
        return res.status(400).json({
          message: 'Cannot modify configuration while event is live'
        });
      }

      // Update configuration
      timeline.config = {
        ...timeline.config,
        ...config
      };
    }

    // Recalculate total duration - TEST MODE values
    const performanceDuration = timeline.performances.length * (timeline.config.performanceSlotDuration || 2);
    timeline.config.totalDuration =
      (timeline.config.welcomeDuration || 1) +
      performanceDuration +
      (timeline.config.commercialDuration || 1) +
      (timeline.config.votingDuration || 3) +
      (timeline.config.winnerDeclarationDuration || 1) +
      (timeline.config.thankYouDuration || 1);

    await timeline.save();

    res.json({
      success: true,
      message: 'Event configuration saved successfully',
      config: timeline.config,
      totalDuration: timeline.config.totalDuration
    });

  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current event configuration
router.get('/:showcaseId/config', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { showcaseId } = req.params;

    // Get showcase info
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: 'Showcase not found' });
    }

    // Try to find existing timeline
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId })
      .populate('showcase', 'title eventDate');

    // If no timeline exists, return default config
    if (!timeline) {
      return res.json({
        success: true,
        showcase: { _id: showcase._id, title: showcase.title, eventDate: showcase.eventDate },
        config: {
          totalDuration: 60,
          welcomeDuration: 5,
          performanceSlotDuration: 5,
          maxVideoLength: 3600,
          commercialDuration: 5,
          votingDuration: 20,
          winnerDeclarationDuration: 3,
          thankYouDuration: 2,
          musicUrl: showcase.musicUrl || null
        },
        phases: [],
        totalDuration: 60,
        isLive: false,
        canEdit: true,
        timelineExists: false
      });
    }

    res.json({
      success: true,
      showcase: timeline.showcase,
      config: {
        ...timeline.config,
        musicUrl: showcase.musicUrl || null
      },
      phases: timeline.phases.map(p => ({
        name: p.name,
        duration: p.duration,
        startTime: p.startTime,
        endTime: p.endTime,
        status: p.status
      })),
      totalDuration: timeline.config.totalDuration,
      isLive: timeline.isLive,
      canEdit: !timeline.isLive,
      timelineExists: true
    });

  } catch (error) {
    console.error('Error getting config:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update individual phase duration
router.put('/:showcaseId/config/phase/:phaseName', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { showcaseId, phaseName } = req.params;
    const { duration } = req.body;

    // Get showcase
    const showcase = await TalentShowcase.findById(showcaseId);
    if (!showcase) {
      return res.status(404).json({ message: 'Showcase not found' });
    }

    // Handle music URL update separately (not a duration field)
    if (phaseName === 'music') {
      showcase.musicUrl = duration; // 'duration' param is actually the musicUrl for this case
      await showcase.save();

      return res.json({
        success: true,
        message: 'Event music URL updated successfully',
        musicUrl: showcase.musicUrl
      });
    }

    if (!duration || duration <= 0) {
      return res.status(400).json({ message: 'Valid duration is required (in minutes)' });
    }

    // Find or create timeline
    let timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      // Create new timeline with default config
      timeline = new ShowcaseEventTimeline({
        showcase: showcaseId,
        config: {
          totalDuration: 60,
          welcomeDuration: 5,
          performanceSlotDuration: 5,
          maxVideoLength: 3600,
          commercialDuration: 5,
          votingDuration: 20,
          winnerDeclarationDuration: 3,
          thankYouDuration: 2
        },
        eventStatus: 'scheduled',
        isLive: false,
        phases: [],
        performances: []
      });
    }

    if (timeline.isLive) {
      return res.status(400).json({ message: 'Cannot modify configuration while event is live' });
    }

    // Update the specific phase duration in config
    const configMap = {
      'welcome': 'welcomeDuration',
      'performance': 'performanceSlotDuration',
      'commercial': 'commercialDuration',
      'voting': 'votingDuration',
      'winner': 'winnerDeclarationDuration',
      'thankyou': 'thankYouDuration'
    };

    const configKey = configMap[phaseName];
    if (!configKey) {
      return res.status(400).json({ message: 'Invalid phase name' });
    }

    timeline.config[configKey] = duration;

    // Recalculate total duration
    const performanceDuration = timeline.performances.length * timeline.config.performanceSlotDuration;
    timeline.config.totalDuration =
      timeline.config.welcomeDuration +
      performanceDuration +
      timeline.config.commercialDuration +
      timeline.config.votingDuration +
      timeline.config.winnerDeclarationDuration +
      timeline.config.thankYouDuration;

    // Regenerate timeline
    timeline.generateTimeline();

    await timeline.save();

    res.json({
      success: true,
      message: `${phaseName} duration updated to ${duration} minutes`,
      config: timeline.config,
      totalDuration: timeline.config.totalDuration,
      phases: timeline.phases
    });

  } catch (error) {
    console.error('Error updating phase duration:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all event timelines (admin overview)
router.get('/all', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const timelines = await ShowcaseEventTimeline.find()
      .populate('showcase', 'title eventDate status')
      .sort({ createdAt: -1 });

    const summary = timelines.map(t => ({
      id: t._id,
      showcase: t.showcase,
      eventStatus: t.eventStatus,
      isLive: t.isLive,
      totalDuration: t.config.totalDuration,
      viewerCount: t.viewerCount,
      peakViewerCount: t.peakViewerCount,
      currentPhase: t.currentPhase,
      phasesCompleted: t.phases.filter(p => p.status === 'completed').length,
      totalPhases: t.phases.length,
      createdAt: t.createdAt
    }));

    res.json({
      success: true,
      count: timelines.length,
      timelines: summary
    });

  } catch (error) {
    console.error('Error getting all timelines:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete event timeline (before it goes live)
router.delete('/:showcaseId', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { showcaseId } = req.params;
    const timeline = await ShowcaseEventTimeline.findOne({ showcase: showcaseId });

    if (!timeline) {
      return res.status(404).json({ message: 'Event timeline not found' });
    }

    if (timeline.isLive) {
      return res.status(400).json({
        message: 'Cannot delete timeline while event is live. Use end event instead.'
      });
    }

    await ShowcaseEventTimeline.deleteOne({ _id: timeline._id });

    res.json({
      success: true,
      message: 'Event timeline deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting timeline:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
