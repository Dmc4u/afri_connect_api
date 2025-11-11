const Message = require("../models/Message");
const Conversation = require("../models/Conversation");
const MessageNotification = require("../models/MessageNotification");
const User = require("../models/User");

// Store active user connections: userId -> socketId
const userSockets = new Map();

// Store typing status: conversationId -> Set of userId's typing
const typingStatus = new Map();

// Store io instance
let io_instance = null;

const initializeSocket = (io) => {
  io_instance = io;
  io.on("connection", (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    // User joins with authentication
    socket.on("join", (userId) => {
      try {
        socket.join(userId); // Join personal room for notifications
        userSockets.set(userId, socket.id);
        console.log(`👤 User ${userId} joined personal room`);

        // Broadcast user online status
        io.emit("user-online", { userId, timestamp: new Date() });
      } catch (error) {
        console.error("Error in join event:", error);
      }
    });

    // Join conversation room for real-time messages
    socket.on("join-conversation", (conversationId) => {
      try {
        socket.join(conversationId);
        console.log(`💬 User joined conversation: ${conversationId}`);
      } catch (error) {
        console.error("Error joining conversation:", error);
      }
    });

    // Leave conversation room
    socket.on("leave-conversation", (conversationId) => {
      try {
        socket.leave(conversationId);
        console.log(`👋 User left conversation: ${conversationId}`);
      } catch (error) {
        console.error("Error leaving conversation:", error);
      }
    });

    // Real-time message delivery
    socket.on("send-message", async (data) => {
      try {
        const { conversationId, userId, text } = data;

        // Verify message in database (it should be created via REST API first)
        const message = await Message.findOne({
          conversation: conversationId,
          sender: userId,
        })
          .sort({ createdAt: -1 })
          .limit(1)
          .populate("sender", "name profilePhoto");

        if (message) {
          // Emit to conversation room (all participants)
          io.to(conversationId).emit("message-received", {
            messageId: message._id,
            conversationId,
            sender: message.sender,
            text: message.text,
            createdAt: message.createdAt,
            readBy: message.readBy,
          });

          console.log(`📬 Message delivered in conversation: ${conversationId}`);
        }
      } catch (error) {
        console.error("Error in send-message event:", error);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    // Typing indicator
    socket.on("typing-start", ({ conversationId, userId, userName }) => {
      try {
        if (!typingStatus.has(conversationId)) {
          typingStatus.set(conversationId, new Set());
        }

        typingStatus.get(conversationId).add(userId);

        // Broadcast typing status to conversation (excluding sender)
        socket.to(conversationId).emit("user-typing", {
          userId,
          userName,
          conversationId,
          timestamp: new Date(),
        });

        console.log(`⌨️  ${userName} is typing in ${conversationId}`);
      } catch (error) {
        console.error("Error in typing-start event:", error);
      }
    });

    // Typing stop indicator
    socket.on("typing-stop", ({ conversationId, userId }) => {
      try {
        if (typingStatus.has(conversationId)) {
          typingStatus.get(conversationId).delete(userId);
        }

        socket.to(conversationId).emit("user-stopped-typing", {
          userId,
          conversationId,
        });

        console.log(`⏹️  User ${userId} stopped typing in ${conversationId}`);
      } catch (error) {
        console.error("Error in typing-stop event:", error);
      }
    });

    // Mark messages as read in real-time
    socket.on("mark-read", async ({ conversationId, userId, messageIds }) => {
      try {
        // Update in database
        await Message.updateMany(
          { _id: { $in: messageIds } },
          {
            $addToSet: {
              readBy: {
                user: userId,
                readAt: new Date(),
              },
            },
          }
        );

        // Broadcast read status to conversation
        io.to(conversationId).emit("messages-read", {
          messageIds,
          readBy: userId,
          timestamp: new Date(),
        });

        console.log(`✅ Messages marked as read by ${userId}`);
      } catch (error) {
        console.error("Error in mark-read event:", error);
      }
    });

    // Notification events
    socket.on("notification-read", async (notificationId) => {
      try {
        await MessageNotification.findByIdAndUpdate(notificationId, {
          isRead: true,
        });

        console.log(`📌 Notification ${notificationId} marked as read`);
      } catch (error) {
        console.error("Error marking notification as read:", error);
      }
    });

    // Disconnect handler
    socket.on("disconnect", () => {
      try {
        // Find and remove user from active connections
        for (const [userId, socketId] of userSockets.entries()) {
          if (socketId === socket.id) {
            userSockets.delete(userId);
            io.emit("user-offline", { userId, timestamp: new Date() });
            console.log(`❌ User ${userId} disconnected`);
            break;
          }
        }

        // Clean up typing status
        for (const [convId, typingUsers] of typingStatus.entries()) {
          if (typingUsers.size === 0) {
            typingStatus.delete(convId);
          }
        }
      } catch (error) {
        console.error("Error in disconnect event:", error);
      }
    });

    // Error handling
    socket.on("error", (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });
};

// Emit notification to specific user
const notifyUser = (io, userId, notification) => {
  io.to(userId).emit("notification", notification);
};

// Emit conversation update (new conversation created)
const notifyNewConversation = (io, userIds, conversationData) => {
  userIds.forEach((userId) => {
    io.to(userId).emit("conversation-created", conversationData);
  });
};

module.exports = {
  initializeSocket,
  notifyUser,
  notifyNewConversation,
  userSockets,
  getIO: () => io_instance,
};
