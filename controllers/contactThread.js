const ContactMessage = require("../models/ContactMessage");
const User = require("../models/User");
const Listing = require("../models/Listing");
const BadRequestError = require("../utils/errors/BadRequestError");
const NotFoundError = require("../utils/errors/NotFoundError");
const ForbiddenError = require("../utils/errors/ForbiddenError");

/**
 * ============================================
 * CONTACT MESSAGE THREADS - Like Forum Posts
 * ============================================
 *
 * Uses same threading pattern as Forum but for:
 * - Initial message (like a post)
 * - Replies from business owner
 * - Both sender and receiver can view
 *
 * Pattern:
 * Contact Form Submission → Create Thread
 *   ↓
 * Business Owner Reply → Add Reply to Thread
 *   ↓
 * Sender Sees Reply → Auto-marked as 'replied'
 */

// ✅ Helper: Normalize reply (handles both old and new schemas)
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

// Create new contact message thread (like forum post)
const createThread = async (req, res, next) => {
  try {
    const { senderName, senderEmail, message, businessOwner, listing } = req.body;

    // Validate required fields
    if (!senderName || !senderEmail || !message || !businessOwner) {
      throw new BadRequestError("Missing required fields");
    }

    if (message.length < 10) {
      throw new BadRequestError("Message must be at least 10 characters");
    }

    // Verify business owner exists
    const owner = await User.findById(businessOwner);
    if (!owner) {
      throw new NotFoundError("Business owner not found");
    }

    // Prevent sending a contact message to yourself
    if (req.user && owner._id.toString() === req.user._id.toString()) {
      throw new BadRequestError("You cannot send a contact message to your own listing");
    }

    // Create thread (like forum post)
    const thread = await ContactMessage.create({
      senderName,
      senderEmail,
      message,
      businessOwner,
      listing: listing || null,
      sender: req.user ? req.user._id : null, // If logged in
      status: "new",
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    // Increment contacts counter on the associated listing (if provided)
    if (listing) {
      try {
        await Listing.findByIdAndUpdate(listing, { $inc: { contacts: 1 } }).exec();
      } catch (incErr) {
        console.warn("⚠️  Failed to increment listing contacts:", incErr.message);
      }
    }

    // Populate and return
    await thread.populate("businessOwner", "name email avatar");
    await thread.populate("listing", "title location");

    res.status(201).json({
      success: true,
      message: "Thread created successfully",
      thread,
    });
  } catch (error) {
    next(error);
  }
};

// Get contact threads sent by current user
const getSentThreads = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;
    const skip = (page - 1) * limit;

    // Match by either sender ID (new messages) or senderEmail (old messages from same email)
    const query = {
      $or: [{ sender: req.user._id }, { senderEmail: req.user.email }],
    };

    if (status && status !== "all") {
      query.status = status;
    }

    let threads = await ContactMessage.find(query)
      .populate("businessOwner", "name email avatar tier")
      .populate("listing", "title location status owner")
      .populate("replies.author", "name email avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Normalize replies
    threads = threads.map((thread) => {
      const obj = thread.toObject ? thread.toObject() : thread;
      if (obj.replies && obj.replies.length > 0) {
        obj.replies = obj.replies.map(normalizeReply);
      }
      return obj;
    });

    const total = await ContactMessage.countDocuments(query);

    res.json({
      success: true,
      data: threads,
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

// Get contact threads received by current user (business owner)
const getReceivedThreads = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status = "all" } = req.query;
    const skip = (page - 1) * limit;

    const query = { businessOwner: req.user._id };
    if (status && status !== "all") {
      query.status = status;
    }

    let threads = await ContactMessage.find(query)
      .populate("listing", "title location status owner")
      .populate("replies.author", "name email avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Normalize replies
    threads = threads.map((thread) => {
      const obj = thread.toObject ? thread.toObject() : thread;
      if (obj.replies && obj.replies.length > 0) {
        obj.replies = obj.replies.map(normalizeReply);
      }
      return obj;
    });

    const total = await ContactMessage.countDocuments(query);

    res.json({
      success: true,
      data: threads,
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

// Get single thread details (like forum post detail)
const getThread = async (req, res, next) => {
  try {
    const { threadId } = req.params;

    const thread = await ContactMessage.findById(threadId)
      .populate("businessOwner", "name email avatar tier")
      .populate("listing", "title location category status owner")
      .populate("replies.author", "name email avatar");

    if (!thread) {
      throw new NotFoundError("Thread not found");
    }

    // Check access: sender or receiver
    // Allow if: user is the sender (by ID or email) OR user is the business owner (receiver)
    const isSender =
      (thread.sender && thread.sender.toString() === req.user._id.toString()) ||
      (thread.senderEmail && thread.senderEmail === req.user.email);
    const isReceiver =
      thread.businessOwner &&
      thread.businessOwner._id &&
      thread.businessOwner._id.toString() === req.user._id.toString();

    // Allow ONLY if user is sender or receiver
    if (!isSender && !isReceiver) {
      throw new ForbiddenError("Not authorized to view this thread");
    }

    // Mark as read if not already
    if (thread.status === "new" && isReceiver) {
      thread.status = "read";
      await thread.save();
    }

    // Normalize replies
    if (thread.replies && thread.replies.length > 0) {
      thread.replies = thread.replies.map(normalizeReply);
    }

    res.json({
      success: true,
      thread,
    });
  } catch (error) {
    next(error);
  }
};

// Add reply to thread (like forum reply)
const addReply = async (req, res, next) => {
  try {
    const { threadId } = req.params;
    const { content } = req.body;

    if (!content || content.length < 1) {
      throw new BadRequestError("Reply content is required");
    }

    if (content.length > 4000) {
      throw new BadRequestError("Reply cannot exceed 4000 characters");
    }

    const thread = await ContactMessage.findById(threadId);
    if (!thread) {
      throw new NotFoundError("Thread not found");
    }

    // Allow both sender and business owner to reply
    const isSender = thread.sender && thread.sender.toString() === req.user._id.toString();
    const isSenderByEmail = thread.senderEmail === req.user.email;
    const isBusinessOwner =
      thread.businessOwner && thread.businessOwner.toString() === req.user._id.toString();

    // Allow if user is either the sender or the business owner
    if (!isSender && !isSenderByEmail && !isBusinessOwner) {
      throw new ForbiddenError("Only message participants can reply");
    }

    const user = await User.findById(req.user._id);

    // Add reply (like forum)
    thread.replies.push({
      author: req.user._id,
      authorName: user.name || "Unknown",
      authorEmail: user.email || "unknown@example.com",
      content,
      read: false, // Mark as unread by default
      createdAt: new Date(),
    });

    // Update status to 'replied'
    thread.status = "replied";
    thread.updatedAt = new Date();

    await thread.save();
    await thread.populate("businessOwner", "name email avatar");
    await thread.populate("replies.author", "name email avatar");

    res.json({
      success: true,
      message: "Reply added successfully",
      thread,
    });
  } catch (error) {
    next(error);
  }
};

// Edit a reply in a thread (only reply author can edit)
const editReply = async (req, res, next) => {
  try {
    const { threadId, replyId } = req.params;
    const { content } = req.body;

    if (!content || content.length < 1) {
      throw new BadRequestError("Reply content is required");
    }

    const thread = await ContactMessage.findById(threadId);
    if (!thread) throw new NotFoundError("Thread not found");

    // Find reply
    const reply = thread.replies.id(replyId);
    if (!reply) throw new NotFoundError("Reply not found");

    // Only author of reply can edit
    if (!reply.author || reply.author.toString() !== req.user._id.toString()) {
      throw new ForbiddenError("Not authorized to edit this reply");
    }

    reply.content = content;
    thread.updatedAt = new Date();

    await thread.save(); // persist subdocument change
    await thread.populate("replies.author", "name email avatar");

    res.json({ success: true, message: "Reply updated", thread });
  } catch (error) {
    next(error);
  }
};

// Delete a reply in a thread (only reply author can delete)
const deleteReply = async (req, res, next) => {
  try {
    const { threadId, replyId } = req.params;

    const thread = await ContactMessage.findById(threadId);
    if (!thread) throw new NotFoundError("Thread not found");

    const reply = thread.replies.id(replyId);
    if (!reply) throw new NotFoundError("Reply not found");

    // Only author of reply can delete
    if (!reply.author || reply.author.toString() !== req.user._id.toString()) {
      throw new ForbiddenError("Not authorized to delete this reply");
    }

    // Remove reply safely for Mongoose v6/7
    reply.deleteOne();
    thread.updatedAt = new Date();
    await thread.save();

    res.json({ success: true, message: "Reply deleted", thread });
  } catch (error) {
    next(error);
  }
};

// Mark thread as read
const markAsRead = async (req, res, next) => {
  try {
    const { threadId } = req.params;

    const thread = await ContactMessage.findById(threadId);
    if (!thread) {
      throw new NotFoundError("Thread not found");
    }

    // Verify access
    const isSender = thread.sender && thread.sender.toString() === req.user._id.toString();
    const isReceiver = thread.businessOwner.toString() === req.user._id.toString();

    if (!isSender && !isReceiver) {
      throw new ForbiddenError("Not authorized");
    }

    // Mark thread as read if it's new
    if (thread.status === "new") {
      thread.status = "read";
    }

    // Mark all replies as read (that were NOT authored by current user)
    thread.replies.forEach((reply) => {
      if (reply.author.toString() !== req.user._id.toString()) {
        reply.read = true;
      }
    });

    await thread.save();

    res.json({
      success: true,
      message: "Thread marked as read",
      thread,
    });
  } catch (error) {
    next(error);
  }
};

// Get thread count for badge
const getUnreadCount = async (req, res, next) => {
  try {
    // Count unread received messages (threads with status "new")
    const unreadThreads = await ContactMessage.countDocuments({
      businessOwner: req.user._id,
      status: "new",
    });

    // Count unread replies in threads where current user is NOT the reply author
    const threadsWithReplies = await ContactMessage.find({
      $or: [
        { businessOwner: req.user._id }, // Threads I received
        { sender: req.user._id },        // Threads I sent
      ],
      "replies.0": { $exists: true }, // Has at least one reply
    });

    let unreadReplies = 0;
    threadsWithReplies.forEach((thread) => {
      thread.replies.forEach((reply) => {
        // Count as unread if:
        // 1. Reply is marked as unread (read: false or undefined)
        // 2. Reply author is NOT the current user
        if (!reply.read && reply.author.toString() !== req.user._id.toString()) {
          unreadReplies++;
        }
      });
    });

    const totalUnread = unreadThreads + unreadReplies;

    res.json({
      success: true,
      unreadCount: totalUnread,
      unreadThreads,
      unreadReplies,
    });
  } catch (error) {
    next(error);
  }
};

// Delete thread (only sender or business owner can delete)
const deleteThread = async (req, res, next) => {
  try {
    const { threadId } = req.params;

    const thread = await ContactMessage.findById(threadId);
    if (!thread) {
      throw new NotFoundError("Thread not found");
    }

    // Allow deletion by sender or business owner
    const isSender = thread.sender && thread.sender.toString() === req.user._id.toString();
    const isSenderByEmail = thread.senderEmail === req.user.email;
    const isBusinessOwner =
      thread.businessOwner && thread.businessOwner.toString() === req.user._id.toString();

    if (!isSender && !isSenderByEmail && !isBusinessOwner) {
      throw new ForbiddenError("Only message participants can delete this thread");
    }

    await ContactMessage.findByIdAndDelete(threadId);

    res.json({
      success: true,
      message: "Thread deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
