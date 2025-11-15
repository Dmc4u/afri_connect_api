const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const { celebrate, Joi } = require("celebrate");

const {
  createThread,
  getSentThreads,
  getReceivedThreads,
  getThread,
  addReply,
  editReply,
  deleteReply,
  markAsRead,
  getUnreadCount,
  deleteThread,
} = require("../controllers/contactThread");

// Validation schemas
const createThreadValidation = celebrate({
  body: Joi.object().keys({
    senderName: Joi.string().trim().min(2).max(100).required(),
    senderEmail: Joi.string().email().required(),
    message: Joi.string().trim().min(10).max(4000).required(),
    businessOwner: Joi.string().required(),
    listing: Joi.string().optional(),
  }),
});

const addReplyValidation = celebrate({
  body: Joi.object().keys({
    content: Joi.string().trim().min(1).max(4000).required(),
  }),
});

const threadIdValidation = celebrate({
  params: Joi.object().keys({
    threadId: Joi.string().required(),
  }),
});

const replyIdValidation = celebrate({
  // Accept replyId as string (allow non-ObjectId formats used during development)
  params: Joi.object().keys({
    threadId: Joi.string().required(),
    replyId: Joi.string().required(),
  }),
});

// ============================================
// PUBLIC ROUTES (Optional auth - captures user if logged in)
// ============================================

// Create new contact thread (like forum post, but for contacts)
router.post("/", optionalAuth, createThreadValidation, createThread);

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// Get threads sent by current user (status: new, read, replied, all)
router.get("/sent", auth, getSentThreads);

// Get threads received by current user (business owner)
router.get("/received", auth, getReceivedThreads);

// Get unread count for badge
router.get("/unread-count", auth, getUnreadCount);

// Get single thread details
router.get("/:threadId", auth, threadIdValidation, getThread);

// Add reply to thread (business owner only)
router.post("/:threadId/reply", auth, threadIdValidation, addReplyValidation, addReply);

// Edit a reply (validate both params in one pass to avoid param stripping)
router.patch("/:threadId/reply/:replyId", auth, replyIdValidation, addReplyValidation, editReply);

// Delete a reply
router.delete("/:threadId/reply/:replyId", auth, replyIdValidation, deleteReply);

// Mark thread as read
router.patch("/:threadId/read", auth, threadIdValidation, markAsRead);

// Delete thread
router.delete("/:threadId", auth, threadIdValidation, deleteThread);

module.exports = router;
