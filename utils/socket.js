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

    // ==================== AGENT-SPECIFIC EVENTS ====================

    // Agent status update (online, offline, busy, away)
    socket.on("agent:status-update", async ({ agentId, status }) => {
      try {
        const Agent = require("../models/Agent");
        const agent = await Agent.findById(agentId);

        if (agent) {
          await agent.updateStatus(status);

          // Broadcast status change to all supervisors and relevant users
          io.emit("agent:status-changed", {
            agentId,
            status,
            timestamp: new Date(),
          });

          console.log(`🔵 Agent ${agentId} status: ${status}`);
        }
      } catch (error) {
        console.error("Error updating agent status:", error);
      }
    });

    // Agent joins their agent room (for receiving assignments)
    socket.on("agent:join-room", (agentId) => {
      try {
        socket.join(`agent:${agentId}`);
        console.log(`👨‍💼 Agent ${agentId} joined agent room`);
      } catch (error) {
        console.error("Error joining agent room:", error);
      }
    });

    // New chat assignment notification to agent
    socket.on("agent:chat-assigned", async ({ agentId, conversationId }) => {
      try {
        // Notify specific agent about new assignment
        io.to(`agent:${agentId}`).emit("agent:new-chat", {
          conversationId,
          timestamp: new Date(),
        });

        console.log(`📬 New chat assigned to agent ${agentId}`);
      } catch (error) {
        console.error("Error in chat assignment:", error);
      }
    });

    // Agent accepts queued chat
    socket.on("agent:accept-chat", async ({ conversationId, agentId }) => {
      try {
        // Join conversation room
        socket.join(conversationId);

        // Notify customer that agent joined
        io.to(conversationId).emit("agent:joined", {
          agentId,
          conversationId,
          timestamp: new Date(),
        });

        console.log(`✅ Agent ${agentId} accepted chat ${conversationId}`);
      } catch (error) {
        console.error("Error accepting chat:", error);
      }
    });

    // Transfer chat to another agent
    socket.on("agent:transfer-chat", async ({ conversationId, fromAgentId, toAgentId, reason }) => {
      try {
        const Agent = require("../models/Agent");
        const toAgent = await Agent.findById(toAgentId).populate("userId", "name profilePhoto");

        // Notify new agent
        io.to(`agent:${toAgentId}`).emit("agent:chat-transferred-in", {
          conversationId,
          fromAgentId,
          reason,
          timestamp: new Date(),
        });

        // Notify customer in conversation
        io.to(conversationId).emit("agent:chat-transferred", {
          conversationId,
          newAgent: {
            _id: toAgent._id,
            name: toAgent.userId.name,
            profilePhoto: toAgent.userId.profilePhoto,
          },
          timestamp: new Date(),
        });

        // Remove old agent from conversation room
        const oldAgentSocket = userSockets.get(fromAgentId);
        if (oldAgentSocket) {
          io.sockets.sockets.get(oldAgentSocket)?.leave(conversationId);
        }

        console.log(`🔄 Chat ${conversationId} transferred from ${fromAgentId} to ${toAgentId}`);
      } catch (error) {
        console.error("Error transferring chat:", error);
      }
    });

    // Close/resolve conversation
    socket.on("agent:close-chat", async ({ conversationId, agentId, resolution }) => {
      try {
        // Notify all participants
        io.to(conversationId).emit("conversation:closed", {
          conversationId,
          closedBy: agentId,
          resolution,
          timestamp: new Date(),
        });

        console.log(`✅ Agent ${agentId} closed chat ${conversationId}`);
      } catch (error) {
        console.error("Error closing chat:", error);
      }
    });

    // Agent is typing in support chat
    socket.on("agent:typing", ({ conversationId, agentId }) => {
      try {
        socket.to(conversationId).emit("agent:typing-indicator", {
          conversationId,
          agentId,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("Error in agent typing:", error);
      }
    });

    // Agent stopped typing
    socket.on("agent:typing-stop", ({ conversationId, agentId }) => {
      try {
        socket.to(conversationId).emit("agent:typing-stopped", {
          conversationId,
          agentId,
        });
      } catch (error) {
        console.error("Error in agent typing stop:", error);
      }
    });

    // Queue position update for customers
    socket.on("queue:check-position", async ({ conversationId }) => {
      try {
        const conversation = await Conversation.findById(conversationId);

        if (conversation && conversation.status === "queued") {
          const position = await Conversation.countDocuments({
            type: "user-to-agent",
            status: "queued",
            createdAt: { $lt: conversation.createdAt },
          });

          socket.emit("queue:position-update", {
            conversationId,
            position: position + 1,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        console.error("Error checking queue position:", error);
      }
    });

    // Supervisor monitoring - join all agent rooms
    socket.on("supervisor:join-monitoring", async ({ supervisorId }) => {
      try {
        const Agent = require("../models/Agent");
        const agents = await Agent.find({ supervisorId, isActive: true });

        agents.forEach((agent) => {
          socket.join(`agent:${agent._id}`);
        });

        socket.join("supervisor:monitoring");

        console.log(`👁️ Supervisor ${supervisorId} joined monitoring`);
      } catch (error) {
        console.error("Error in supervisor monitoring:", error);
      }
    });

    // Broadcast queue update to all agents
    socket.on("queue:update", async () => {
      try {
        const queueCount = await Conversation.countDocuments({
          type: "user-to-agent",
          status: "queued",
        });

        io.emit("queue:count-update", {
          count: queueCount,
          timestamp: new Date(),
        });
      } catch (error) {
        console.error("Error updating queue:", error);
      }
    });

    // ==================== END AGENT EVENTS ====================

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

// Notify agent of new chat assignment
const notifyAgentAssignment = (io, agentId, conversationData) => {
  io.to(`agent:${agentId}`).emit("agent:new-chat", {
    conversation: conversationData,
    timestamp: new Date(),
  });
  console.log(`📬 Notified agent ${agentId} of new assignment`);
};

// Notify customer that agent joined
const notifyAgentJoined = (io, conversationId, agentData) => {
  io.to(conversationId).emit("agent:joined", {
    agent: agentData,
    timestamp: new Date(),
  });
  console.log(`✅ Notified conversation ${conversationId} that agent joined`);
};

// Broadcast queue update to all online agents
const broadcastQueueUpdate = async (io) => {
  try {
    const Conversation = require("../models/Conversation");
    const queueCount = await Conversation.countDocuments({
      type: "user-to-agent",
      status: "queued",
    });

    io.emit("queue:count-update", {
      count: queueCount,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error broadcasting queue update:", error);
  }
};

// Notify supervisor of agent activity
const notifySupervisor = (io, supervisorId, event, data) => {
  io.to(`supervisor:${supervisorId}`).emit("supervisor:event", {
    event,
    data,
    timestamp: new Date(),
  });
};

module.exports = {
  initializeSocket,
  notifyUser,
  notifyNewConversation,
  notifyAgentAssignment,
  notifyAgentJoined,
  broadcastQueueUpdate,
  notifySupervisor,
  userSockets,
  getIO: () => io_instance,
};
