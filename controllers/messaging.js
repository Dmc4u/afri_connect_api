const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const MessageNotification = require("../models/MessageNotification");
const ContactMessage = require("../models/ContactMessage");
const User = require("../models/User");
const BadRequestError = require("../utils/errors/BadRequestError");
const NotFoundError = require("../utils/errors/NotFoundError");
const ForbiddenError = require("../utils/errors/ForbiddenError");

// ✅ Normalization helper - handles both old and new reply schemas
const normalizeReply = (reply) => {
  if (!reply) return null;
  return {
    author: reply.author || null,
    authorName: reply.authorName || reply.senderName || "Unknown",
    authorEmail: reply.authorEmail || reply.senderEmail || "unknown@example.com",
    content: reply.content || reply.replyText || "",
    createdAt: reply.createdAt || reply.sentAt || new Date(),
    _id: reply._id,
  };
};

// Get all conversations for a user
exports.getConversations = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, archived = false } = req.query;
    const skip = (page - 1) * limit;

    const conversations = await Conversation.find({
      participants: req.user.id,
      isArchived: archived === "true",
    })
      .populate("participants", "name profilePhoto")
      .populate("listing", "title")
      .populate("forumPost", "title")
      .populate("lastMessage.sender", "_id name profilePhoto")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Conversation.countDocuments({
      participants: req.user.id,
      isArchived: archived === "true",
    });

    // Add unread count for current user
    const conversationsWithUnread = conversations.map((conv) => ({
      ...conv.toObject(),
      unreadCount: conv.unreadCount.get(req.user.id) || 0,
    }));

    res.status(200).json({
      success: true,
      data: conversationsWithUnread,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get a single conversation with its messages
exports.getConversation = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;

    const conversation = await Conversation.findById(conversationId)
      .populate("participants", "name profilePhoto email")
      .populate("listing", "title category")
      .populate("forumPost", "title");

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Check if user is a participant
    if (!conversation.participants.some((p) => p._id.toString() === req.user.id)) {
      throw new ForbiddenError("You don't have access to this conversation");
    }

    // Get messages
    const messages = await Message.find({
      conversation: conversationId,
      isDeleted: false,
    })
      .populate("sender", "_id name profilePhoto")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalMessages = await Message.countDocuments({
      conversation: conversationId,
      isDeleted: false,
    });

    // Mark messages as read for current user
    await Message.updateMany(
      {
        conversation: conversationId,
        "readBy.user": { $ne: req.user.id },
      },
      {
        $push: {
          readBy: {
            user: req.user.id,
            readAt: new Date(),
          },
        },
      }
    );

    // Reset unread count for this conversation
    await Conversation.findByIdAndUpdate(conversationId, {
      $set: { [`unreadCount.${req.user.id}`]: 0 },
    });

    res.status(200).json({
      success: true,
      data: {
        conversation,
        messages: messages.reverse(),
        pagination: {
          total: totalMessages,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(totalMessages / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

// Create a new message in a conversation
exports.sendMessage = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { text, attachments = [] } = req.body;

    if (!text || text.trim() === "") {
      throw new BadRequestError("Message text is required");
    }

    if (text.length > 4000) {
      throw new BadRequestError("Message cannot exceed 4000 characters");
    }

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Verify user is participant
    if (!conversation.participants.some((p) => p.toString() === req.user.id)) {
      throw new ForbiddenError("You don't have access to this conversation");
    }

    // Check message limits based on tier
    await checkMessageLimit(req.user.id);

    // Create message
    const message = new Message({
      conversation: conversationId,
      sender: req.user.id,
      text: text.trim(),
      attachments,
      readBy: [{ user: req.user.id, readAt: new Date() }],
    });

    await message.save();
    await message.populate("sender", "_id name profilePhoto");

    // Update conversation last message
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: {
        text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
        sender: req.user.id,
        timestamp: new Date(),
      },
      updatedAt: new Date(),
    });

    // Create notifications for other participants
    const otherParticipants = conversation.participants.filter((p) => p.toString() !== req.user.id);

    for (const participant of otherParticipants) {
      // Increment unread count
      await Conversation.findByIdAndUpdate(
        conversationId,
        {
          $inc: { [`unreadCount.${participant}`]: 1 },
        },
        { upsert: true }
      );

      // Create notification
      const notification = new MessageNotification({
        user: participant,
        conversation: conversationId,
        message: message._id,
        sender: req.user.id,
        type: "new-message",
        title: `New message from ${req.user.name}`,
        body: text.substring(0, 100),
        deliveryChannels: {
          inApp: true,
          email: false, // Can be user-configurable
          push: false,
        },
      });

      await notification.save();
    }

    res.status(201).json({
      success: true,
      data: message,
    });
  } catch (error) {
    next(error);
  }
};

// Start a new conversation
exports.startConversation = async (req, res, next) => {
  try {
    const { type, recipientId, listingId, forumPostId, title } = req.body;

    if (!type || !["user-to-user", "user-to-listing", "forum"].includes(type)) {
      throw new BadRequestError("Invalid conversation type");
    }

    if (type === "user-to-user" && !recipientId) {
      throw new BadRequestError("recipientId is required for user-to-user conversations");
    }

    if (type === "user-to-listing" && !listingId) {
      throw new BadRequestError("listingId is required for user-to-listing conversations");
    }

    if (type === "forum" && !forumPostId) {
      throw new BadRequestError("forumPostId is required for forum conversations");
    }

    // Check if user is trying to message themselves
    if (type === "user-to-user" && recipientId === req.user.id) {
      throw new BadRequestError("You cannot message yourself");
    }

    // Verify recipient exists
    if (recipientId) {
      const recipient = await User.findById(recipientId);
      if (!recipient) {
        throw new NotFoundError("Recipient not found");
      }
    }

    // Check if conversation already exists
    let query = { type, participants: { $all: [] } };

    if (type === "user-to-user") {
      query.participants.$all = [req.user.id, recipientId];
    } else if (type === "user-to-listing") {
      query.listing = listingId;
      query.participants.$all = [req.user.id, recipientId];
    } else if (type === "forum") {
      query.forumPost = forumPostId;
    }

    let conversation = await Conversation.findOne(query);

    if (conversation) {
      // Unarchive if it was archived
      if (conversation.isArchived) {
        conversation.isArchived = false;
        await conversation.save();
      }

      return res.status(200).json({
        success: true,
        data: conversation,
        message: "Conversation already exists",
      });
    }

    // Create new conversation
    const participants = [req.user.id];
    if (recipientId && type === "user-to-user") {
      participants.push(recipientId);
    } else if (type === "user-to-listing") {
      participants.push(recipientId);
    }

    conversation = new Conversation({
      type,
      participants,
      listing: listingId || null,
      forumPost: forumPostId || null,
      title: title || "",
      unreadCount: new Map(),
    });

    await conversation.save();
    await conversation.populate("participants", "name profilePhoto");

    res.status(201).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    next(error);
  }
};

// Mark messages as read
exports.markAsRead = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { messageIds = [] } = req.body;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Update messages
    if (messageIds.length > 0) {
      await Message.updateMany(
        { _id: { $in: messageIds } },
        {
          $addToSet: {
            readBy: {
              user: req.user.id,
              readAt: new Date(),
            },
          },
        }
      );
    } else {
      // Mark all messages as read
      await Message.updateMany(
        { conversation: conversationId, "readBy.user": { $ne: req.user.id } },
        {
          $push: {
            readBy: {
              user: req.user.id,
              readAt: new Date(),
            },
          },
        }
      );
    }

    // Reset unread count
    await Conversation.findByIdAndUpdate(conversationId, {
      $set: { [`unreadCount.${req.user.id}`]: 0 },
    });

    res.status(200).json({
      success: true,
      message: "Messages marked as read",
    });
  } catch (error) {
    next(error);
  }
};

// Delete a message (soft delete)
exports.deleteMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId);

    if (!message) {
      throw new NotFoundError("Message not found");
    }

    // Only sender can delete
    if (message.sender.toString() !== req.user.id) {
      throw new ForbiddenError("You can only delete your own messages");
    }

    // Soft delete
    message.isDeleted = true;
    message.text = "[Message deleted]";
    await message.save();

    res.status(200).json({
      success: true,
      message: "Message deleted",
    });
  } catch (error) {
    next(error);
  }
};

// Edit a message
exports.editMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;

    if (!text || text.trim() === "") {
      throw new BadRequestError("Message text is required");
    }

    if (text.length > 4000) {
      throw new BadRequestError("Message cannot exceed 4000 characters");
    }

    const message = await Message.findById(messageId);

    if (!message) {
      throw new NotFoundError("Message not found");
    }

    // Only sender can edit
    if (message.sender.toString() !== req.user.id) {
      throw new ForbiddenError("You can only edit your own messages");
    }

    // Add to edit history
    message.editHistory.push({
      text: message.text,
      editedAt: message.editedAt || message.createdAt,
    });

    message.text = text.trim();
    message.editedAt = new Date();
    await message.save();

    await message.populate("sender", "_id name profilePhoto");

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error) {
    next(error);
  }
};

// Archive/unarchive conversation
exports.toggleArchive = async (req, res, next) => {
  try {
    const { conversationId } = req.params;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    // Verify user is participant
    if (!conversation.participants.some((p) => p.toString() === req.user.id)) {
      throw new ForbiddenError("You don't have access to this conversation");
    }

    conversation.isArchived = !conversation.isArchived;
    await conversation.save();

    res.status(200).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    next(error);
  }
};

// Get unread message count
exports.getUnreadCount = async (req, res, next) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user.id,
    });

    console.log('🔔 [Backend] User:', req.user.id);
    console.log('🔔 [Backend] Total conversations:', conversations.length);

    let totalUnread = 0;
    const byConversation = conversations.map((c) => {
      const count = c.unreadCount.get(req.user.id) || 0;
      console.log('🔔 [Backend] Conversation:', c._id, 'unreadCount Map:', c.unreadCount, 'count for user:', count);
      totalUnread += count;
      return {
        conversationId: c._id,
        unreadCount: count,
      };
    });

    console.log('🔔 [Backend] Total unread:', totalUnread);

    res.status(200).json({
      success: true,
      data: {
        totalUnread,
        byConversation,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Helper function to check message limits by tier
async function checkMessageLimit(userId) {
  const user = await User.findById(userId);

  if (user.tier === "Free") {
    // Check if user sent 10 messages today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayCount = await Message.countDocuments({
      sender: userId,
      createdAt: { $gte: startOfDay },
    });

    if (todayCount >= 10) {
      throw new BadRequestError(
        "You've reached your daily message limit. Upgrade to Pro or Premium for unlimited messaging."
      );
    }
  } else if (user.tier === "Starter") {
    // 50 messages per day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayCount = await Message.countDocuments({
      sender: userId,
      createdAt: { $gte: startOfDay },
    });

    if (todayCount >= 50) {
      throw new BadRequestError("You've reached your daily message limit.");
    }
  }
  // Pro and Premium have unlimited messages
}

/**
 * Send a direct message from contact form
 * Used by ContactBusiness and general contact forms
 * Does not require authentication
 */
exports.sendDirectMessage = async (req, res, next) => {
  try {
    const { senderName, senderEmail, message, recipientId, listingId } = req.body;

    console.log("[sendDirectMessage] Request received:", {
      senderName,
      senderEmail,
      recipientId,
      listingId,
    });

    // Validation
    if (!senderName || !senderEmail || !message || !recipientId) {
      throw new BadRequestError("Sender name, email, message, and recipient ID are required");
    }

    if (message.trim().length < 10) {
      throw new BadRequestError("Message must be at least 10 characters long");
    }

    // Verify recipient exists
    let recipient;
    try {
      console.log("[sendDirectMessage] Looking for user with ID:", recipientId);
      console.log("[sendDirectMessage] User model:", User.collection.name);
      recipient = await User.findById(recipientId);
      console.log("[sendDirectMessage] User found:", recipient ? recipient._id : "NOT FOUND");
    } catch (err) {
      console.error("[sendDirectMessage] Error finding user:", err);
      throw new BadRequestError("Invalid recipient ID format");
    }
    if (!recipient) {
      throw new NotFoundError("Business owner not found");
    }

    // Find or create a conversation (contact form messages)
    try {
      console.log("[sendDirectMessage] Looking for existing conversation");
      let conversation = await Conversation.findOne({
        type: "user-to-listing",
        participants: recipientId,
        listing: listingId || null,
        title: "contact-form",
      });

      if (!conversation) {
        console.log("[sendDirectMessage] Creating new conversation");
        conversation = new Conversation({
          type: "user-to-listing",
          participants: [recipientId],
          listing: listingId || null,
          title: "contact-form",
        });
        await conversation.save();
        console.log("[sendDirectMessage] Conversation created:", conversation._id);
      } else {
        console.log("[sendDirectMessage] Using existing conversation:", conversation._id);
      }

      // Create message
      console.log("[sendDirectMessage] Creating message");
      const newMessage = await Message.create({
        conversation: conversation._id,
        sender: null, // Guest message - no authenticated sender
        text: message,
        senderName,
        senderEmail,
        readBy: [],
      });
      console.log("[sendDirectMessage] Message created:", newMessage._id);

      // Create notification
      console.log("[sendDirectMessage] Creating notification");
      await MessageNotification.create({
        user: recipientId,
        conversation: conversation._id,
        message: newMessage._id,
        sender: null, // Guest message
        type: "contact-form",
      });
      console.log("[sendDirectMessage] Notification created");

      // Update conversation's last message and unread count
      console.log("[sendDirectMessage] Updating conversation");

      // Update lastMessage and unread count for the recipient
      conversation.lastMessage = {
        text: message.substring(0, 100),
        sender: recipientId,
        timestamp: new Date(),
      };

      // Update unread count
      const currentUnread = conversation.unreadCount?.get(recipientId.toString()) || 0;
      conversation.unreadCount.set(recipientId.toString(), currentUnread + 1);

      // Save the updated conversation
      const updatedConv = await conversation.save();
      console.log("[sendDirectMessage] Conversation updated:", updatedConv._id);

      // Emit Socket.io event
      const io = require("../utils/socket").getIO();
      if (io) {
        io.to(recipientId.toString()).emit("new-message", {
          from: senderName,
          email: senderEmail,
          text: message,
          type: "contact-form",
          conversationId: conversation._id,
        });
      }

      res.status(201).json({
        success: true,
        message: "Message sent successfully. The business owner will contact you soon.",
        data: {
          messageId: newMessage._id,
          conversationId: conversation._id,
          senderName,
          senderEmail,
        },
      });
    } catch (innerError) {
      console.error("[sendDirectMessage] Inner error:", {
        name: innerError.name,
        message: innerError.message,
        stack: innerError.stack,
      });
      throw innerError;
    }
  } catch (error) {
    console.error("[sendDirectMessage] Outer error caught:", {
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

// Send contact form message (simplified - no conversation/map complexity)
exports.sendContactMessage = async (req, res, next) => {
  try {
    const { senderName, senderEmail, message, businessOwner, listing } = req.body;

    console.log("📬 Sending contact message:", { senderName, senderEmail, businessOwner });

    // Validate required fields
    if (!senderName || !senderEmail || !message || !businessOwner) {
      throw new BadRequestError(
        "Missing required fields: senderName, senderEmail, message, businessOwner"
      );
    }

    if (message.length < 10) {
      throw new BadRequestError("Message must be at least 10 characters long");
    }

    // Verify business owner exists
    const owner = await User.findById(businessOwner);
    if (!owner) {
      throw new NotFoundError("Business owner not found");
    }

    console.log("✅ Owner verified:", owner.name);

    // Create the contact message (no conversation needed)
    // Capture sender ID if user is logged in
    const contactMessage = await ContactMessage.create({
      senderName,
      senderEmail,
      message,
      businessOwner,
      listing: listing || null,
      sender: req.user ? req.user._id : null, // Capture user ID if logged in
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    console.log("✅ Contact message created:", contactMessage._id);

    // Create notification for business owner
    const notification = await MessageNotification.create({
      user: businessOwner,
      conversation: null, // Contact form doesn't use conversations
      message: contactMessage._id,
      sender: req.user ? req.user._id : null, // Capture sender if logged in
      type: "contact-form",
      title: `New contact from ${senderName}`,
      body: message.substring(0, 100),
      isRead: false,
    });

    console.log("✅ Notification created:", notification._id);

    res.status(201).json({
      success: true,
      message: "Contact message sent successfully",
      data: {
        messageId: contactMessage._id,
        notificationId: notification._id,
      },
    });
  } catch (error) {
    console.error("❌ Error sending contact message:", error.message);
    next(error);
  }
};

// Get all contact messages for a business owner
exports.getContactMessages = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;
    const skip = (page - 1) * limit;

    const query = { businessOwner: req.user._id };

    // Filter by status if provided
    if (status && status !== "all") {
      query.status = status;
    }

    // Get contact messages with populated replies.author
    let messages = await ContactMessage.find(query)
      .populate("listing", "title location owner")
      .populate("replies.author", "_id name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Normalize replies to handle both old and new schemas
    messages = messages.map((msg) => {
      const msgObj = msg.toObject ? msg.toObject() : msg;
      if (msgObj.replies && msgObj.replies.length > 0) {
        msgObj.replies = msgObj.replies.map(normalizeReply);
      }
      return msgObj;
    });

    const total = await ContactMessage.countDocuments(query);

    res.json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get contact messages SENT BY the current user (replies they received)
exports.getSentContactMessages = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;
    const skip = (page - 1) * limit;

    // Only get messages where current user is the sender
    const query = { sender: req.user._id };

    // Filter by status if provided
    if (status && status !== "all") {
      query.status = status;
    }

    // Get contact messages sent by user
    let messages = await ContactMessage.find(query)
      .populate("listing", "title location owner")
      .populate("businessOwner", "name email")
      .populate("replies.author", "_id name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Normalize replies to handle both old and new schemas
    messages = messages.map((msg) => {
      const msgObj = msg.toObject ? msg.toObject() : msg;
      if (msgObj.replies && msgObj.replies.length > 0) {
        msgObj.replies = msgObj.replies.map(normalizeReply);
      }
      return msgObj;
    });

    const total = await ContactMessage.countDocuments(query);

    res.json({
      success: true,
      data: messages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Mark contact message as read
exports.markContactMessageAsRead = async (req, res, next) => {
  try {
    const { contactMessageId } = req.params;

    const message = await ContactMessage.findById(contactMessageId);
    if (!message) {
      throw new NotFoundError("Contact message not found");
    }

    // Check authorization
    if (message.businessOwner.toString() !== req.user._id.toString() && req.user.role !== "admin") {
      throw new ForbiddenError("Not authorized to access this message");
    }

    // Update message status to read
    message.status = "read";
    await message.save();

    // Also mark notification as read
    await MessageNotification.updateMany(
      { message: contactMessageId, type: "contact-form" },
      { isRead: true }
    );

    res.json({
      success: true,
      message: "Contact message marked as read",
      data: message,
    });
  } catch (error) {
    next(error);
  }
};

// Reply to a contact message
exports.replyToContactMessage = async (req, res, next) => {
  try {
    const { messageId, content, recipientEmail, sendEmail = false } = req.body;

    // Validate input - only messageId and content are required
    if (!messageId || !content) {
      console.error("❌ Missing fields:", { messageId, content });
      throw new BadRequestError("Missing required fields: messageId, content");
    }

    console.log("📤 Processing reply to contact message:", {
      messageId,
      userId: req.user._id.toString(),
      recipientEmail,
      sendEmail,
    });

    // Find the contact message
    const contactMessage = await ContactMessage.findById(messageId);
    if (!contactMessage) {
      console.error("❌ Message not found:", messageId);
      throw new NotFoundError("Contact message not found");
    }

    console.log("✅ Message found:", {
      id: contactMessage._id,
      businessOwner: contactMessage.businessOwner?.toString(),
      sender: contactMessage.sender?.toString(),
    });

    // Check authorization - only the business owner or admin can reply
    const isBusinessOwner = contactMessage.businessOwner?.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";
    console.log("🔐 Authorization check:", { isBusinessOwner, isAdmin, userRole: req.user.role });

    if (!isBusinessOwner && !isAdmin) {
      console.error("❌ Not authorized:", {
        userRole: req.user.role,
        businessOwnerId: contactMessage.businessOwner?.toString(),
        userId: req.user._id.toString(),
      });
      throw new ForbiddenError("Not authorized to reply to this message");
    }

    // Get sender user info
    const sender = await User.findById(req.user._id);
    console.log("✅ Sender verified:", sender.name);

    // Create reply following Forum pattern
    const newReply = {
      author: req.user._id,
      authorName: sender.name || "Business Owner",
      authorEmail: sender.email,
      content: content,
      createdAt: new Date(),
    };

    // Add reply to replies array
    console.log("📝 Before push - replies count:", contactMessage.replies?.length || 0);
    contactMessage.replies.push(newReply);
    console.log("📝 After push - replies count:", contactMessage.replies?.length || 0);

    // Mark message as replied since business owner has responded
    contactMessage.status = "replied";
    await contactMessage.save();
    console.log("✅ Reply saved to database");
    console.log("📝 Saved replies:", contactMessage.replies?.length || 0, contactMessage.replies);

    await contactMessage.populate("replies.author", "_id name email");
    console.log(
      "✅ Contact message updated with reply:",
      contactMessage._id,
      "Total replies:",
      contactMessage.replies.length
    );
    console.log("📝 Populated replies:", JSON.stringify(contactMessage.replies));

    // Send email notification ONLY if explicitly requested and email is provided
    let emailSent = false;
    if (sendEmail && recipientEmail) {
      try {
        const nodemailer = require("nodemailer");

        // Create transporter (using environment variables for email config)
        const transporter = nodemailer.createTransport({
          service: process.env.EMAIL_SERVICE || "gmail",
          auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASSWORD,
          },
        });

        // Prepare email content
        const emailContent = `
          <h2>Reply to Your Message</h2>
          <p>Hi ${contactMessage.senderName},</p>
          <p>${sender.name} has replied to your message:</p>
          <hr>
          <h3>Their Reply:</h3>
          <p>${content.replace(/\n/g, "<br>")}</p>
          <hr>
          <p><strong>Contact Details:</strong><br>
          Email: ${sender.email}</p>
          <p>
            <a href="${process.env.FRONTEND_URL || "http://localhost:3000"}/check-reply?messageId=${contactMessage._id}&email=${encodeURIComponent(recipientEmail)}" style="background: #0066cc; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View Full Conversation
            </a>
          </p>
          <p>Best regards,<br>AfriOnet Team</p>
        `;

        // Send email
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: recipientEmail,
          subject: `Reply from ${sender.name} - AfriOnet`,
          html: emailContent,
        });

        console.log("✅ Email notification sent to:", recipientEmail);
        emailSent = true;
      } catch (emailError) {
        console.error("⚠️ Failed to send email notification:", emailError.message);
        // Don't throw error - reply is still saved, just email failed
      }
    }

    res.status(201).json({
      success: true,
      message: "Reply saved successfully" + (emailSent ? " and email sent" : ""),
      data: {
        contactMessageId: messageId,
        reply: newReply,
        message: contactMessage,
        emailSent: emailSent,
      },
    });
    console.log("✅ Response sent with replies:", contactMessage.replies.length);
  } catch (error) {
    console.error("❌ Error replying to contact message:", error.message);
    next(error);
  }
};

// Get reply status for a contact message (public endpoint for contact senders)
exports.getContactMessageReplies = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { senderEmail } = req.query;

    console.log("🔍 Checking replies for message:", { messageId, senderEmail });

    // Find the contact message and populate author info
    let contactMessage = await ContactMessage.findById(messageId).populate(
      "replies.author",
      "name email"
    );

    if (!contactMessage) {
      throw new NotFoundError("Message not found");
    }

    // Verify the email matches the sender (security check)
    if (contactMessage.senderEmail.toLowerCase() !== senderEmail.toLowerCase()) {
      throw new ForbiddenError("Email does not match message sender");
    }

    console.log("✅ Message found, status:", contactMessage.status);
    console.log(
      "✅ Number of replies:",
      contactMessage.replies ? contactMessage.replies.length : 0
    );

    // Normalize replies to handle both old and new schemas
    const normalizedReplies = (contactMessage.replies || []).map(normalizeReply);

    res.json({
      success: true,
      data: {
        messageId: contactMessage._id,
        status: contactMessage.status, // 'new', 'read', or 'replied'
        replies: normalizedReplies,
        message: contactMessage.message,
        senderName: contactMessage.senderName,
      },
    });
  } catch (error) {
    console.error("❌ Error getting contact message replies:", error.message);
    next(error);
  }
};
