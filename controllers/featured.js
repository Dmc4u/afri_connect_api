const FeaturedPlacement = require("../models/FeaturedPlacement");
const Listing = require("../models/Listing");
const { ForbiddenError, BadRequestError } = require("../utils/errors");
const { createOrder, captureOrder } = require("../utils/paypal");

// Pricing configuration & helpers
// Pricing tuned down for current market conditions (economy relief)
const FEATURED_PRICING = {
  standard: { basePerDay: 9, durationHours: 24, peakMultiplier: 1.15 },
  premium: { basePerWindow: 25, durationHours: 72, peakMultiplier: 1.2 },
  prime: { basePerDay: 18, durationHours: 24, peakMultiplier: 1.35, capacityPerDay: 2 },
  growth: { monthly: 99, durationHours: 24 * 30, subscription: true }
};

function isPeak(dt) {
  const d = new Date(dt);
  const h = d.getHours();
  const day = d.getDay(); // 0 Sun
  const peakHours = [8,9,10,11,12,13,14,15,16,17];
  return day >= 1 && day <= 5 && peakHours.includes(h);
}

async function getCapacitySnapshot(start, end, offerType) {
  // Count overlapping approved placements for same window (rough approximation)
  const overlapping = await FeaturedPlacement.countDocuments({
    status: 'approved',
    startAt: { $lte: end },
    endAt: { $gte: start }
  });
  return { overlapping }; // can extend with per-offer counts
}

function computePrice({ offerType, start, end }) {
  const cfg = FEATURED_PRICING[offerType];
  if (!cfg) throw new BadRequestError('Invalid offerType');
  if (cfg.subscription) return { price: cfg.monthly, billingMode: 'subscription' };
  const diffHours = (end - start) / 3600000;
  let base;
  if (cfg.basePerWindow && diffHours === cfg.durationHours) {
    base = cfg.basePerWindow;
  } else {
    const baseDayRate = cfg.basePerDay || (cfg.basePerWindow ? cfg.basePerWindow / (cfg.durationHours / 24) : 0);
    base = (baseDayRate / 24) * diffHours;
  }
  const peakApplied = cfg.peakMultiplier && isPeak(start) ? cfg.peakMultiplier : 1;
  // Gentle off-peak relief: additional 10% off when not peak
  const relief = peakApplied === 1 ? 0.9 : 1;
  const priceNoRelief = Math.round(base * peakApplied * 100) / 100;
  const finalPrice = Math.round(priceNoRelief * relief * 100) / 100;
  return { price: finalPrice, peakApplied, billingMode: 'fixed', base, priceNoRelief };
}

exports.requestPlacement = async (req, res, next) => {
  try {
    const { listingId, startAt, endAt, notes, offerType = 'standard', quotedPrice } = req.body;
    if (!listingId || !startAt || !endAt) {
      throw new BadRequestError("listingId, startAt and endAt are required");
    }
    const listing = await Listing.findById(listingId).select("owner tier category");
    if (!listing) throw new BadRequestError("Listing not found");
    if (String(listing.owner) !== String(req.user._id) && req.user.role !== 'admin') {
      throw new ForbiddenError("You can only schedule your own listing");
    }
    // Only Talent category can be featured in Talent Showcase
    if (listing.category !== 'Talent') {
      throw new BadRequestError("Only listings with the 'Talent' category can be featured in the Talent Showcase");
    }
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (!(start < end)) throw new BadRequestError("Invalid time range");

    // Enforce fixed durations for known types (auto-adjust end)
    const cfg = FEATURED_PRICING[offerType];
    if (!cfg) throw new BadRequestError('Invalid offerType');
    if (!cfg.subscription && cfg.durationHours) {
      const expectedEnd = new Date(start.getTime() + cfg.durationHours * 3600000);
      // If client gave a different end for a fixed window, override
      if (Math.abs(end - expectedEnd) > 60000) {
        end.setTime(expectedEnd.getTime());
      }
    }

    // Capacity rule for prime banner (limit active overlapping prime)
    if (offerType === 'prime') {
      const primeActive = await FeaturedPlacement.countDocuments({
        status: { $in: ['approved','pending'] },
        offerType: 'prime',
        startAt: { $lte: end },
        endAt: { $gte: start }
      });
      const allowed = FEATURED_PRICING.prime.capacityPerDay || 2;
      if (primeActive >= allowed) throw new BadRequestError('Prime banner capacity reached for selected window');
    }

    // Compute authoritative base price (already includes off-peak relief)
  const pricing = computePrice({ offerType, start, end });

    // Progressive multi-window discount tiers based on future windows for this listing & offer type
    const nowRef = new Date();
    const futureCount = await FeaturedPlacement.countDocuments({
      ownerId: req.user._id,
      listingId,
      offerType,
      status: { $in: ['pending','approved'] },
      startAt: { $gt: nowRef }
    });
    let multiPct = 0;
    const countWithThis = futureCount + 1;
    if (countWithThis >= 4) multiPct = 15; else if (countWithThis === 3) multiPct = 10; else if (countWithThis === 2) multiPct = 5;
    const offPeakPct = (pricing.peakApplied === 1 ? 10 : 0); // informational; already in pricing.price
    const combinedPct = offPeakPct + multiPct;
  const priceAfterMulti = Math.round(pricing.price * (1 - multiPct / 100) * 100) / 100;

    const capacitySnapshot = await getCapacitySnapshot(start, end, offerType);

    const doc = await FeaturedPlacement.create({
      ownerId: req.user._id,
      listingId,
      startAt: start,
      endAt: end,
      status: 'pending',
      notes: notes || '',
      offerType,
      quotedPriceClient: typeof quotedPrice === 'number' ? quotedPrice : undefined,
      priceBooked: priceAfterMulti,
      originalPriceBeforeDiscounts: pricing.priceNoRelief,
      billingMode: pricing.billingMode,
      slotType: offerType,
      capacitySnapshot,
      discountPercent: combinedPct,
      discountBreakdown: { offPeak: offPeakPct, multiWindow: multiPct }
    });
    res.json({ ok: true, placement: doc, pricing: { ...pricing, discount: { offPeakPct, multiPct, combinedPct }, original: pricing.priceNoRelief, final: priceAfterMulti } });
  } catch (e) { next(e); }
};

// Initiate PayPal payment for an existing pending placement (ensures price integrity)
exports.initiatePaypal = async (req, res, next) => {
  try {
    const { placementId } = req.body;
    if (!placementId) throw new BadRequestError('placementId required');
    const placement = await FeaturedPlacement.findById(placementId);
    if (!placement) throw new BadRequestError('Placement not found');
    if (String(placement.ownerId) !== String(req.user._id) && req.user.role !== 'admin') {
      throw new ForbiddenError('Not your placement');
    }
    if (placement.paymentStatus === 'captured') {
      return res.json({ ok: true, alreadyPaid: true });
    }
    // Create PayPal order using authoritative priceBooked
    const order = await createOrder(placement.priceBooked || 0, placement.offerType, placement.currency || 'USD', req.user._id, {
      returnUrl: process.env.PAYPAL_RETURN_URL || 'http://localhost:3001/featured?paypal=approved',
      cancelUrl: process.env.PAYPAL_CANCEL_URL || 'http://localhost:3001/featured?paypal=cancel'
    });
    // Extract approval link & store order metadata
    const approveLink = order.links?.find(l => l.rel === 'approve')?.href;
    placement.paymentProvider = 'paypal';
    placement.paymentOrderId = order.id;
    placement.paymentStatus = 'initiated';
    await placement.save();
    res.json({ ok: true, orderId: order.id, approveLink });
  } catch (e) { next(e); }
};

// Capture PayPal order after user returns from approval
exports.capturePaypal = async (req, res, next) => {
  try {
    const { placementId } = req.body;
    if (!placementId) throw new BadRequestError('placementId required');
    const placement = await FeaturedPlacement.findById(placementId);
    if (!placement) throw new BadRequestError('Placement not found');
    if (String(placement.ownerId) !== String(req.user._id) && req.user.role !== 'admin') {
      throw new ForbiddenError('Not your placement');
    }
    if (!placement.paymentOrderId) throw new BadRequestError('No PayPal order initiated');
    if (placement.paymentStatus === 'captured') {
      return res.json({ ok: true, alreadyCaptured: true });
    }
    const capture = await captureOrder(placement.paymentOrderId);
    // Determine final status and amount
    let amount = 0;
    const purchaseUnit = capture.purchase_units?.[0];
    if (purchaseUnit?.payments?.captures?.[0]?.amount?.value) {
      amount = parseFloat(purchaseUnit.payments.captures[0].amount.value);
    }
    placement.paymentStatus = 'captured';
    placement.paidAt = new Date();
    placement.amountPaid = amount;
    // Optionally auto-approve non-prime placements after payment
    if (placement.status === 'pending' && placement.offerType !== 'prime') {
      placement.status = 'approved';
      placement.approvedBy = req.user.role === 'admin' ? req.user._id : null;
    }
    await placement.save();
    res.json({ ok: true, capture, placement });
  } catch (e) { next(e); }
};

exports.myPlacements = async (req, res, next) => {
  try {
    const docs = await FeaturedPlacement.find({ ownerId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('listingId', 'title tier category');
    res.json({ ok: true, placements: docs });
  } catch (e) { next(e); }
};

exports.activePlacements = async (req, res, next) => {
  try {
    const now = new Date();
    const docs = await FeaturedPlacement.find({ status: 'approved', startAt: { $lte: now }, endAt: { $gte: now } })
      .populate({ path: 'listingId', select: 'title description category location tier owner mediaFiles', populate: { path: 'owner', select: 'name tier verifiedBadge profilePhoto' } })
      .sort({ startAt: 1 });
    res.json({ ok: true, placements: docs });
  } catch (e) { next(e); }
};

// Popularity endpoint: compute recent booking share by offer type
exports.popularity = async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    const metric = (req.query.metric || 'created').toLowerCase(); // 'created' | 'start'
    const since = new Date();
    since.setDate(since.getDate() - days);
    const match = { offerType: { $in: ['standard','premium','prime','growth'] } };
    if (metric === 'start') {
      match.startAt = { $gte: since };
    } else {
      match.createdAt = { $gte: since };
    }
    const placements = await FeaturedPlacement.find(match).select('offerType');
    const counts = placements.reduce((acc, p) => {
      acc[p.offerType] = (acc[p.offerType] || 0) + 1;
      return acc;
    }, {});
    const total = Object.values(counts).reduce((a,b) => a + b, 0);
    const shares = Object.fromEntries(Object.entries(counts).map(([k,v]) => [k, total>0 ? Math.round((v/total)*100) : 0]));
    // winner
    let mostPopular = null; let max = -1;
    Object.entries(counts).forEach(([t,c]) => { if (c > max) { max = c; mostPopular = t; } });
    res.json({ ok: true, since: since.toISOString(), days, metric, counts, shares, mostPopular });
  } catch (e) { next(e); }
};

// Capture PayPal by token (orderId) for auto-capture on return
exports.capturePaypalByToken = async (req, res, next) => {
  try {
    const { orderId } = req.body; // token from PayPal return
    if (!orderId) throw new BadRequestError('orderId required');
    let placement = await FeaturedPlacement.findOneAndUpdate({ paymentOrderId: orderId, capturing: { $ne: true } }, { $set: { capturing: true } }, { new: true });
    if (!placement) throw new BadRequestError('Placement not found for this order');
    // Require ownership or admin
    if (!req.user || (String(placement.ownerId) !== String(req.user._id) && req.user.role !== 'admin')) {
      throw new ForbiddenError('Not authorized to capture this order');
    }
    if (placement.paymentStatus === 'captured') {
      placement.capturing = false;
      await placement.save();
      return res.json({ ok: true, alreadyCaptured: true, placement });
    }
    const capture = await captureOrder(orderId);
    let amount = 0;
    const purchaseUnit = capture.purchase_units?.[0];
    if (purchaseUnit?.payments?.captures?.[0]?.amount?.value) {
      amount = parseFloat(purchaseUnit.payments.captures[0].amount.value);
    }
    placement.paymentStatus = 'captured';
    placement.paidAt = new Date();
    placement.amountPaid = amount;
    if (placement.status === 'pending' && placement.offerType !== 'prime') {
      placement.status = 'approved';
      placement.approvedBy = req.user.role === 'admin' ? req.user._id : null;
    }
    placement.capturing = false;
    await placement.save();
    res.json({ ok: true, capture, placement });
  } catch (e) { next(e); }
};

// PayPal Webhook with signature verification
exports.paypalWebhook = async (req, res, next) => {
  try {
    const cfg = require('../utils/config');
    const transmissionId = req.get('PayPal-Transmission-Id');
    const transmissionTime = req.get('PayPal-Transmission-Time');
    const certUrl = req.get('PayPal-Cert-Url');
    const authAlgo = req.get('PayPal-Auth-Algo');
    const webhookId = process.env.PAYPAL_WEBHOOK_ID; // must be set in env
    const transmissionSig = req.get('PayPal-Transmission-Sig');
    const body = req.body;
    if (!webhookId) {
      console.warn('PayPal webhook received but PAYPAL_WEBHOOK_ID missing');
      return res.status(500).json({ ok: false, error: 'Webhook not configured' });
    }
    // Verify via PayPal API
    const accessToken = await require('../utils/paypal').getAccessToken();
    const verifyPayload = {
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: webhookId,
      webhook_event: body
    };
    const baseUrl = cfg.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const verifyRes = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(verifyPayload)
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok || verifyData.verification_status !== 'SUCCESS') {
      console.warn('PayPal webhook signature failed', verifyData);
      return res.status(400).json({ ok: false });
    }
    const event = body || {};
    const eventType = event.event_type || event.eventType;
    let orderId = event.resource?.supplementary_data?.related_ids?.order_id || null;
    if (!orderId) {
      const upLink = event.resource?.links?.find?.(l => l.rel === 'up' && /\/v2\/checkout\/orders\//.test(l.href));
      if (upLink) {
        const m = upLink.href.match(/\/orders\/([A-Z0-9-]+)/i);
        if (m) orderId = m[1];
      }
    }
    if (!orderId) return res.status(200).json({ ok: true });
    const placement = await FeaturedPlacement.findOne({ paymentOrderId: orderId });
    if (!placement) return res.status(200).json({ ok: true });
    if (['PAYMENT.CAPTURE.COMPLETED','CHECKOUT.ORDER.APPROVED'].includes(eventType)) {
      if (placement.paymentStatus !== 'captured') {
        placement.paymentStatus = 'captured';
        placement.paidAt = new Date();
        const value = event.resource?.amount?.value || event.resource?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value;
        if (value) placement.amountPaid = parseFloat(value);
        if (placement.status === 'pending' && placement.offerType !== 'prime') {
          placement.status = 'approved';
        }
        await placement.save();
      }
    }
    res.status(200).json({ ok: true });
  } catch (e) { next(e); }
};

// Availability endpoint: returns counts of overlapping placements per day & slot type (simplified)
exports.availability = async (req, res, next) => {
  try {
    const days = parseInt(req.query.days || '30', 10);
    const now = new Date();
    const results = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 0,0,0);
      const dayEnd = new Date(dayStart.getTime() + 24*3600000 - 1);
      const placements = await FeaturedPlacement.find({
        startAt: { $lte: dayEnd },
        endAt: { $gte: dayStart },
        status: { $in: ['pending','approved'] }
      }).select('offerType');
      const counts = placements.reduce((acc, p) => {
        acc[p.offerType] = (acc[p.offerType] || 0) + 1;
        return acc;
      }, {});
      results.push({ date: dayStart.toISOString(), counts });
    }
    res.json({ ok: true, availability: results, pricing: FEATURED_PRICING });
  } catch (e) { next(e); }
};

// Revenue & capacity forecast (admin only)
exports.forecast = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'admin') throw new ForbiddenError('Admin only');
    const days = parseInt(req.query.days || '30', 10);
    const now = new Date();
    const results = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 0,0,0);
      const dayEnd = new Date(dayStart.getTime() + 24*3600000 - 1);
      const placements = await FeaturedPlacement.find({
        startAt: { $lte: dayEnd },
        endAt: { $gte: dayStart },
        status: { $in: ['pending','approved'] }
      }).select('offerType priceBooked originalPriceBeforeDiscounts discountPercent');
      const agg = {};
      let totalRevenue = 0;
      let totalOriginal = 0;
      placements.forEach(p => {
        if (!agg[p.offerType]) agg[p.offerType] = { count: 0, revenue: 0, original: 0, discountRevenue: 0, avgDiscountPct: 0 };
        agg[p.offerType].count += 1;
        const rev = typeof p.priceBooked === 'number' ? p.priceBooked : 0;
        const orig = typeof p.originalPriceBeforeDiscounts === 'number' ? p.originalPriceBeforeDiscounts : rev;
        agg[p.offerType].revenue += rev;
        agg[p.offerType].original += orig;
        totalRevenue += rev;
        totalOriginal += orig;
      });
      // compute discount deltas and average discount percent per type
      Object.values(agg).forEach(t => {
        t.discountRevenue = Math.max(0, Math.round((t.original - t.revenue) * 100) / 100);
        t.avgDiscountPct = t.original > 0 ? Math.round((t.discountRevenue / t.original) * 100) : 0;
      });
      // Include capacity + remaining for capped types (prime)
      Object.keys(FEATURED_PRICING).forEach(type => {
        if (!agg[type]) agg[type] = { count: 0, revenue: 0, original: 0, discountRevenue: 0, avgDiscountPct: 0 };
        const cfg = FEATURED_PRICING[type];
        if (cfg.capacityPerDay) {
          agg[type].capacity = cfg.capacityPerDay;
          agg[type].remaining = Math.max(0, cfg.capacityPerDay - agg[type].count);
          agg[type].pct = cfg.capacityPerDay > 0 ? Math.round((agg[type].count / cfg.capacityPerDay) * 100) : null;
        } else {
          agg[type].capacity = null;
          agg[type].remaining = null;
          agg[type].pct = null;
        }
      });
      results.push({
        date: dayStart.toISOString(),
        types: agg,
        totals: {
          original: Math.round(totalOriginal * 100) / 100,
          revenue: Math.round(totalRevenue * 100) / 100,
          discount: Math.max(0, Math.round((totalOriginal - totalRevenue) * 100) / 100),
          avgDiscountPct: totalOriginal > 0 ? Math.round(((totalOriginal - totalRevenue) / totalOriginal) * 100) : 0
        }
      });
    }
    res.json({ ok: true, forecast: results, pricing: FEATURED_PRICING });
  } catch (e) { next(e); }
};

exports.adminList = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new ForbiddenError("Admin only");
    const docs = await FeaturedPlacement.find({}).sort({ createdAt: -1 }).populate('listingId', 'title tier');
    res.json({ ok: true, placements: docs });
  } catch (e) { next(e); }
};

exports.adminUpdateStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new ForbiddenError("Admin only");
    const { id } = req.params;
    const { status } = req.body; // approved | rejected | pending
    if (!['approved','rejected','pending'].includes(status)) throw new BadRequestError('Invalid status');
    const doc = await FeaturedPlacement.findByIdAndUpdate(
      id,
      { status, approvedBy: status === 'approved' ? req.user._id : null },
      { new: true }
    );
    if (!doc) throw new BadRequestError('Placement not found');
    res.json({ ok: true, placement: doc });
  } catch (e) { next(e); }
};

// Track an impression for a placement if within active window
exports.trackImpression = async (req, res, next) => {
  try {
    const { id } = req.params; // placement id
    const now = new Date();
    const placement = await FeaturedPlacement.findOne({
      _id: id,
      status: 'approved',
      startAt: { $lte: now },
      endAt: { $gte: now }
    });
    if (!placement) throw new BadRequestError('Invalid or inactive placement');
    await FeaturedPlacement.updateOne({ _id: id }, { $inc: { impressions: 1 } });
    res.json({ ok: true });
  } catch (e) { next(e); }
};

// Track a click for a placement (same guard)
exports.trackClick = async (req, res, next) => {
  try {
    const { id } = req.params;
    const now = new Date();
    const placement = await FeaturedPlacement.findOne({
      _id: id,
      status: 'approved',
      startAt: { $lte: now },
      endAt: { $gte: now }
    });
    if (!placement) throw new BadRequestError('Invalid or inactive placement');
    await FeaturedPlacement.updateOne({ _id: id }, { $inc: { clicks: 1 } });
    res.json({ ok: true });
  } catch (e) { next(e); }
};
