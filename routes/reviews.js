const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const { createReview, getListingReviews, adminListPending, adminSetStatus } = require('../controllers/reviews');
const optionalAuth = require('../middlewares/optionalAuth');

// Listing reviews (optionally includes pending for viewer/owner)
router.get('/listing/:listingId', optionalAuth, getListingReviews);
router.post('/listing/:listingId', auth, createReview);

// Admin moderation
router.get('/admin/pending', auth, adminListPending);
router.patch('/admin/:id', auth, adminSetStatus);

module.exports = router;
