const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const {
  getConversations,
  getConversation,
  sendMessage,
  startConversation,
  markAsRead,
  deleteMessage,
  editMessage,
  toggleArchive,
  getUnreadCount,
  sendDirectMessage,
  sendContactMessage,
  getContactMessages,
  getSentContactMessages,
  markContactMessageAsRead,
  replyToContactMessage,
  getContactMessageReplies,
} = require("../controllers/messaging");

// Direct message send (for contact forms - no auth required)
router.post("/send", optionalAuth, sendDirectMessage);

// Contact form message (simplified - no auth required)
router.post("/contact", sendContactMessage);

// Check for replies on a contact message (no auth required - for contact senders)
router.get("/contact-messages/:messageId/replies", getContactMessageReplies);

// All other routes require authentication
router.use(auth);

// Conversations
router.get("/conversations", getConversations);
router.post("/conversations", startConversation);
router.get("/conversations/:conversationId", getConversation);
router.patch("/conversations/:conversationId/archive", toggleArchive);

// Messages
router.post("/conversations/:conversationId/messages", sendMessage);
router.patch("/messages/:messageId", editMessage);
router.delete("/messages/:messageId", deleteMessage);
router.patch("/conversations/:conversationId/read", markAsRead);

// Contact messages (authenticated - for business owners)
router.get("/contact-messages", getContactMessages);
router.get("/sent-contact-messages", getSentContactMessages);
router.patch("/contact-messages/:contactMessageId/read", markContactMessageAsRead);
router.post("/contact-messages/reply", replyToContactMessage);

// Unread count
router.get("/unread-count", getUnreadCount);

module.exports = router;
