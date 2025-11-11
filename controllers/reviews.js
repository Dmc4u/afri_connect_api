const Review = require("../models/Review");
const Listing = require("../models/Listing");
const { BadRequestError, ForbiddenError } = require("../utils/errors");
const User = require("../models/User");
const notifications = require("../utils/notifications");

exports.createReview = async (req, res, next) => {
  try {
    const { listingId } = req.params;
    const { rating, text } = req.body;
    if (!rating || rating < 1 || rating > 5) throw new BadRequestError('Rating must be 1-5');

    const listing = await Listing.findById(listingId).select('owner');
    if (!listing) throw new BadRequestError('Listing not found');
    if (String(listing.owner) === String(req.user._id)) {
      throw new ForbiddenError('You cannot review your own listing');
    }

    const weight = req.user.verifiedBadge ? 1.5 : 1.0;
    const review = await Review.create({ listingId, reviewerId: req.user._id, rating, text: text || '', weight, status: 'pending' });

    // Notify listing owner of a new pending review (non-blocking)
    try {
      const ownerUser = await User.findById(listing.owner).select('email name');
      if (ownerUser) {
        notifications.sendNewReviewOnListing(ownerUser, { _id: listing._id, title: listing.title || 'Listing' }, review, { name: req.user.name || 'User' });
      }
    } catch (notifyErr) {
      console.warn('Failed to send new review notification:', notifyErr.message);
    }

    res.json({ ok: true, review });
  } catch (e) {
    // Handle duplicate key (already reviewed)
    if (e && e.code === 11000) {
      return next(new BadRequestError('You have already submitted a review for this listing'));
    }
    next(e);
  }
};

exports.getListingReviews = async (req, res, next) => {
  try {
    const { listingId } = req.params;

    // Always return approved reviews to everyone
    const approvedDocs = await Review.find({ listingId, status: 'approved' })
      .sort({ createdAt: -1 })
      .populate('reviewerId', 'name verifiedBadge tier');

    // Compute weighted average using approved only
    let totalWeight = 0; let sum = 0;
    for (const r of approvedDocs) { const w = r.weight || 1; totalWeight += w; sum += (r.rating || 0) * w; }
    const average = totalWeight > 0 ? (sum / totalWeight) : 0;

    // Start with approved reviews, mark as not pending
    const merged = approvedDocs.map(r => ({ ...r.toObject(), isPending: false }));

    // If there is a logged-in viewer, optionally include pending
    if (req.user) {
      // Include the viewer's own pending review, if any
      const minePending = await Review.find({ listingId, status: 'pending', reviewerId: req.user._id })
        .sort({ createdAt: -1 })
        .populate('reviewerId', 'name verifiedBadge tier');
      for (const r of minePending) {
        if (!merged.find(x => String(x._id) === String(r._id))) {
          merged.unshift({ ...r.toObject(), isPending: true, visibility: 'me' });
        }
      }

      // If viewer is the listing owner, also include all pending for visibility
      const listing = await Listing.findById(listingId).select('owner');
      const isOwner = listing && String(listing.owner) === String(req.user._id);
      if (isOwner) {
        const allPending = await Review.find({ listingId, status: 'pending' })
          .sort({ createdAt: -1 })
          .populate('reviewerId', 'name verifiedBadge tier');
        for (const r of allPending) {
          if (!merged.find(x => String(x._id) === String(r._id))) {
            merged.push({ ...r.toObject(), isPending: true, visibility: 'owner' });
          }
        }
      }
    }

    res.json({ ok: true, reviews: merged, average });
  } catch (e) { next(e); }
};

exports.adminListPending = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new ForbiddenError('Admin only');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const sortBy = ['createdAt','rating'].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
    const order = req.query.order === 'asc' ? 1 : -1;

    const filter = { status: 'pending' };
    const total = await Review.countDocuments(filter);
    const reviews = await Review.find(filter)
      .sort({ [sortBy]: order })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('listingId', 'title')
      .populate('reviewerId', 'name verifiedBadge');
    res.json({ ok: true, reviews, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { next(e); }
};

exports.adminSetStatus = async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') throw new ForbiddenError('Admin only');
    const { id } = req.params; const { status, reason } = req.body;
    if (!['approved','rejected','pending'].includes(status)) throw new BadRequestError('Invalid status');
    const update = { status };
    if (status !== 'pending') {
      update.moderationNote = reason || '';
      update.moderationBy = req.user._id;
      update.moderatedAt = new Date();
    }
    const doc = await Review.findByIdAndUpdate(id, update, { new: true });
    if (!doc) throw new BadRequestError('Review not found');
    // If approved, notify reviewer their review is live
    if (status === 'approved') {
      try {
        const reviewer = await User.findById(doc.reviewerId).select('email name');
        const listing = await Listing.findById(doc.listingId).select('title');
        if (reviewer && listing) {
          notifications.sendReviewApproved(reviewer, { _id: listing._id, title: listing.title }, doc);
        }
      } catch (e) { console.warn('Failed to send review approved email:', e.message); }
    }
    res.json({ ok: true, review: doc });
  } catch (e) { next(e); }
};
