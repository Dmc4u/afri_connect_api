const express = require("express");
const auth = require("../middlewares/auth");
const { requireLeadGenerationAccess } = require("../middlewares/tierCheck");
const LeadGeneration = require("../models/LeadGeneration");
const { BadRequestError, NotFoundError, ForbiddenError } = require("../utils/errors");

const router = express.Router();

/**
 * POST /leads - Create a new lead (Pro only)
 */
router.post("/", auth, requireLeadGenerationAccess, (req, res, next) => {
  const { leadName, leadEmail, leadPhone, message, source, priority, tags } = req.body;

  if (!leadName || !leadEmail) {
    return next(new BadRequestError("Lead name and email are required"));
  }

  return LeadGeneration.create({
    userId: req.user._id,
    leadName,
    leadEmail,
    leadPhone: leadPhone || "",
    message: message || "",
    source: source || "app",
    priority: priority || "medium",
    tags: tags || [],
  })
    .then((lead) => {
      return res.status(201).send({
        lead: lead,
        message: "Lead created successfully (Pro feature)",
      });
    })
    .catch((err) => {
      if (err.name === "ValidationError") {
        return next(new BadRequestError("Validation failed"));
      }
      return next(err);
    });
});

/**
 * GET /leads - Get all leads for user (Pro only)
 */
router.get("/", auth, requireLeadGenerationAccess, (req, res, next) => {
  const { status, priority, skip = 0, limit = 20 } = req.query;

  const filter = { userId: req.user._id };
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  return LeadGeneration.find(filter)
    .sort({ createdAt: -1 })
    .skip(parseInt(skip))
    .limit(parseInt(limit))
    .then((leads) => {
      return res.send({
        leads,
        total: leads.length,
        message: "Leads retrieved successfully (Pro feature)",
      });
    })
    .catch((err) => next(err));
});

/**
 * PATCH /leads/:id - Update a lead (Pro only)
 */
router.patch("/:id", auth, requireLeadGenerationAccess, (req, res, next) => {
  const { status, priority, notes, tags, followUpDate } = req.body;

  return LeadGeneration.findById(req.params.id)
    .then((lead) => {
      if (!lead) {
        return next(new NotFoundError("Lead not found"));
      }

      if (lead.userId.toString() !== req.user._id.toString()) {
        return next(new ForbiddenError("You do not have permission to update this lead"));
      }

      if (status) lead.status = status;
      if (priority) lead.priority = priority;
      if (notes) lead.notes = notes;
      if (tags) lead.tags = tags;
      if (followUpDate) lead.followUpDate = followUpDate;

      return lead.save();
    })
    .then((lead) => {
      return res.send({
        lead,
        message: "Lead updated successfully (Pro feature)",
      });
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid lead ID"));
      }
      return next(err);
    });
});

/**
 * GET /leads/:id - Get specific lead details (Pro only)
 */
router.get("/:id", auth, requireLeadGenerationAccess, (req, res, next) => {
  return LeadGeneration.findById(req.params.id)
    .populate("userId", "name email")
    .then((lead) => {
      if (!lead) {
        return next(new NotFoundError("Lead not found"));
      }

      if (lead.userId._id.toString() !== req.user._id.toString()) {
        return next(new ForbiddenError("You do not have permission to view this lead"));
      }

      return res.send({
        lead,
        message: "Lead retrieved successfully (Pro feature)",
      });
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid lead ID"));
      }
      return next(err);
    });
});

/**
 * DELETE /leads/:id - Delete a lead (Pro only)
 */
router.delete("/:id", auth, requireLeadGenerationAccess, (req, res, next) => {
  return LeadGeneration.findById(req.params.id)
    .then((lead) => {
      if (!lead) {
        return next(new NotFoundError("Lead not found"));
      }

      if (lead.userId.toString() !== req.user._id.toString()) {
        return next(new ForbiddenError("You do not have permission to delete this lead"));
      }

      return lead.deleteOne();
    })
    .then(() => {
      return res.send({
        message: "Lead deleted successfully (Pro feature)",
      });
    })
    .catch((err) => {
      if (err.name === "CastError") {
        return next(new BadRequestError("Invalid lead ID"));
      }
      return next(err);
    });
});

/**
 * GET /leads/analytics/summary - Get lead analytics (Pro only)
 */
router.get("/analytics/summary", auth, requireLeadGenerationAccess, (req, res, next) => {
  return LeadGeneration.aggregate([
    {
      $match: { userId: require("mongoose").Types.ObjectId(req.user._id) },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ])
    .then((summary) => {
      const stats = {
        total: 0,
        new: 0,
        contacted: 0,
        qualified: 0,
        converted: 0,
        lost: 0,
      };

      summary.forEach((item) => {
        stats[item._id] = item.count;
        stats.total += item.count;
      });

      return res.send({
        analytics: stats,
        message: "Lead analytics retrieved successfully (Pro feature)",
      });
    })
    .catch((err) => next(err));
});

module.exports = router;
