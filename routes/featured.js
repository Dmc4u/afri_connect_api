const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const { requestPlacement, myPlacements, activePlacements, adminList, adminUpdateStatus, trackImpression, trackClick, availability, forecast, initiatePaypal, capturePaypal, popularity, capturePaypalByToken, paypalWebhook } = require('../controllers/featured');

// Public: get active placements
router.get('/active', activePlacements);
router.get('/availability', availability);
router.get('/forecast', auth, forecast);
router.get('/popularity', popularity);

// Authed user: request and view own
router.post('/', auth, requestPlacement);
router.get('/my', auth, myPlacements);
router.post('/checkout/paypal/order', auth, initiatePaypal);
router.post('/checkout/paypal/capture', auth, capturePaypal);
router.post('/checkout/paypal/capture-by-token', auth, capturePaypalByToken);
router.post('/webhook/paypal', paypalWebhook); // webhook should not require auth (PayPal posts server-to-server)

// Admin: list and update
router.get('/admin', auth, adminList);
router.patch('/admin/:id', auth, adminUpdateStatus);

// Tracking (public; no auth required)
router.post('/track/impression/:id', trackImpression);
router.post('/track/click/:id', trackClick);

module.exports = router;
