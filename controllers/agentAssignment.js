const Agent = require("../models/Agent");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const NotFoundError = require("../utils/errors/NotFoundError");
const BadRequestError = require("../utils/errors/BadRequestError");
const ForbiddenError = require("../utils/errors/ForbiddenError");

/**
 * Assign an available agent to a user's request
 * Routes to the best available agent based on criteria
 */
exports.assignAgent = async (req, res, next) => {
  try {
    const { requestType, priority, tags, userMessage } = req.body;
    const userId = req.user.id;

    // Find best available agent
    const criteria = {
      department: requestType || "customer_support",
    };

    // Add user's country for geo-routing
    const user = await User.findById(userId);
    if (user && user.country) {
      criteria.country = user.country;
    }

    const agent = await Agent.findAvailableAgent(criteria);

    if (!agent) {
      // No agents available - create queued conversation
      const conversation = await Conversation.create({
        type: "user-to-agent",
        participants: [userId],
        status: "queued",
        priority: priority || "normal",
        tags: tags || [requestType || "general"],
        title: userMessage ? userMessage.substring(0, 100) : "Support Request",
      });

      return res.status(200).json({
        success: true,
        status: "queued",
        message: "All agents are currently busy. You've been added to the queue.",
        conversation: conversation._id,
        estimatedWaitTime: await getEstimatedWaitTime(),
      });
    }

    // Agent available - assign and create conversation
    await agent.acceptChat();

    const conversation = await Conversation.create({
      type: "user-to-agent",
      participants: [userId, agent.userId],
      assignedAgent: agent._id,
      agentJoinedAt: new Date(),
      status: "active",
      priority: priority || "normal",
      tags: tags || [requestType || "general"],
      title: userMessage ? userMessage.substring(0, 100) : "Support Request",
    });

    // Populate agent user info
    await conversation.populate("assignedAgent");
    await conversation.populate("participants", "name profilePhoto");

    res.status(200).json({
      success: true,
      status: "assigned",
      message: "You've been connected to an agent",
      conversation,
      agent: {
        _id: agent._id,
        name: agent.userId.name,
        role: agent.role,
        department: agent.department,
        profilePhoto: agent.userId.profilePhoto,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all conversations in the support queue
 */
exports.getQueue = async (req, res, next) => {
  try {
    const { priority, status = "queued" } = req.query;

    const query = {
      type: "user-to-agent",
      status,
    };

    if (priority) {
      query.priority = priority;
    }

    const queue = await Conversation.find(query)
      .populate("participants", "name profilePhoto email country")
      .sort({ priority: -1, createdAt: 1 })
      .limit(50);

    res.status(200).json({
      success: true,
      count: queue.length,
      queue,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Agent accepts a queued conversation
 */
exports.acceptQueuedChat = async (req, res, next) => {
  try {
    const { conversationId } = req.body;
    const agentUserId = req.user.id;

    // Get agent profile
    const user = await User.findById(agentUserId);
    if (!user.isAgent || !user.agentProfile) {
      throw new ForbiddenError("Only agents can accept queued chats");
    }

    const agent = await Agent.findById(user.agentProfile);
    if (!agent.isAvailable) {
      throw new BadRequestError("You have reached your maximum chat capacity");
    }

    // Get conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    if (conversation.status !== "queued") {
      throw new BadRequestError("This conversation is not in the queue");
    }

    // Assign agent
    conversation.assignedAgent = agent._id;
    conversation.agentJoinedAt = new Date();
    conversation.status = "active";
    conversation.participants.push(agentUserId);
    await conversation.save();

    // Update agent
    await agent.acceptChat();

    await conversation.populate("participants", "name profilePhoto");

    // Emit socket event to notify customer that agent joined
    try {
      const io = require("../utils/socket").getIO();
      if (io) {
        io.to(conversationId).emit("agent:joined", {
          agentId: agent._id,
          conversationId,
          timestamp: new Date(),
        });
        console.log(`✅ Emitted agent:joined for conversation ${conversationId}`);
      }
    } catch (socketError) {
      console.error("Error emitting socket event:", socketError);
      // Continue even if socket fails
    }

    res.status(200).json({
      success: true,
      message: "Chat accepted successfully",
      conversation,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Transfer conversation to another agent
 */
exports.transferChat = async (req, res, next) => {
  try {
    const { conversationId, toAgentId, reason } = req.body;
    const agentUserId = req.user.id;

    // Verify current agent
    const user = await User.findById(agentUserId);
    if (!user.isAgent || !user.agentProfile) {
      throw new ForbiddenError("Only agents can transfer chats");
    }

    const currentAgent = await Agent.findById(user.agentProfile);
    if (!currentAgent.permissions.canTransferChats) {
      throw new ForbiddenError("You don't have permission to transfer chats");
    }

    // Get conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    if (conversation.assignedAgent.toString() !== currentAgent._id.toString()) {
      throw new ForbiddenError("You are not assigned to this conversation");
    }

    // Get target agent
    const toAgent = await Agent.findById(toAgentId);
    if (!toAgent || !toAgent.isAvailable) {
      throw new BadRequestError("Target agent is not available");
    }

    // Update conversation
    conversation.transferHistory.push({
      fromAgent: currentAgent._id,
      toAgent: toAgent._id,
      reason: reason || "No reason provided",
    });

    conversation.assignedAgent = toAgent._id;

    // Update participants - replace current agent with new agent
    const agentIndex = conversation.participants.findIndex(
      (p) => p.toString() === agentUserId.toString()
    );
    if (agentIndex !== -1) {
      conversation.participants[agentIndex] = toAgent.userId;
    }

    await conversation.save();

    // Update agent stats
    await currentAgent.completeChat(false);
    await toAgent.acceptChat();

    res.status(200).json({
      success: true,
      message: "Chat transferred successfully",
      conversation,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Close/resolve a conversation
 */
exports.closeConversation = async (req, res, next) => {
  try {
    const { conversationId, resolution } = req.body;
    const agentUserId = req.user.id;

    // Verify agent
    const user = await User.findById(agentUserId);
    if (!user.isAgent || !user.agentProfile) {
      throw new ForbiddenError("Only agents can close conversations");
    }

    const agent = await Agent.findById(user.agentProfile);
    if (!agent.permissions.canCloseChats) {
      throw new ForbiddenError("You don't have permission to close chats");
    }

    // Get conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    if (conversation.assignedAgent?.toString() !== agent._id.toString()) {
      throw new ForbiddenError("You are not assigned to this conversation");
    }

    // Close conversation
    conversation.status = "closed";
    conversation.resolvedAt = new Date();
    conversation.closedBy = agentUserId;
    await conversation.save();

    // Update agent stats
    await agent.completeChat(true);

    res.status(200).json({
      success: true,
      message: "Conversation closed successfully",
      conversation,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Rate conversation (customer satisfaction)
 */
exports.rateConversation = async (req, res, next) => {
  try {
    const { conversationId, rating, feedback } = req.body;
    const userId = req.user.id;

    if (!rating || rating < 1 || rating > 5) {
      throw new BadRequestError("Rating must be between 1 and 5");
    }

    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new NotFoundError("Conversation not found");
    }

    if (!conversation.participants.includes(userId)) {
      throw new ForbiddenError("You are not part of this conversation");
    }

    if (conversation.customerSatisfaction.rating) {
      throw new BadRequestError("This conversation has already been rated");
    }

    // Update conversation rating
    conversation.customerSatisfaction.rating = rating;
    conversation.customerSatisfaction.feedback = feedback || null;
    conversation.customerSatisfaction.ratedAt = new Date();
    await conversation.save();

    // Update agent rating
    if (conversation.assignedAgent) {
      const agent = await Agent.findById(conversation.assignedAgent);
      if (agent) {
        await agent.addRating(rating);
      }
    }

    res.status(200).json({
      success: true,
      message: "Thank you for your feedback",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get agent's active conversations
 */
exports.getAgentConversations = async (req, res, next) => {
  try {
    const { status = "active", page = 1, limit = 20 } = req.query;
    const agentUserId = req.user.id;

    const user = await User.findById(agentUserId);
    if (!user.isAgent || !user.agentProfile) {
      throw new ForbiddenError("Only agents can access this endpoint");
    }

    const agent = await Agent.findById(user.agentProfile);

    const query = {
      type: "user-to-agent",
      assignedAgent: agent._id,
    };

    if (status !== "all") {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const conversations = await Conversation.find(query)
      .populate("participants", "name profilePhoto email")
      .populate("assignedAgent")
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Conversation.countDocuments(query);

    res.status(200).json({
      success: true,
      data: conversations,
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

/**
 * Update agent status (online, offline, busy, away)
 */
exports.updateAgentStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const agentUserId = req.user.id;

    if (!["online", "offline", "busy", "away"].includes(status)) {
      throw new BadRequestError("Invalid status");
    }

    const user = await User.findById(agentUserId);
    if (!user.isAgent || !user.agentProfile) {
      throw new ForbiddenError("Only agents can update status");
    }

    const agent = await Agent.findById(user.agentProfile);
    await agent.updateStatus(status);

    res.status(200).json({
      success: true,
      message: `Status updated to ${status}`,
      agent: {
        status: agent.status,
        lastStatusChange: agent.lastStatusChange,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get agent dashboard metrics
 */
exports.getAgentDashboard = async (req, res, next) => {
  try {
    const agentUserId = req.user.id;

    const user = await User.findById(agentUserId);
    if (!user.isAgent || !user.agentProfile) {
      throw new ForbiddenError("Only agents can access dashboard");
    }

    const metrics = await Agent.getAgentMetrics(user.agentProfile);

    res.status(200).json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get system-wide agent stats (admin/supervisor only)
 */
exports.getSystemStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);

    // Check if user is admin or supervisor
    if (user.role !== "admin") {
      if (!user.isAgent || !user.agentProfile) {
        throw new ForbiddenError("Access denied");
      }

      const agent = await Agent.findById(user.agentProfile);
      if (agent.role !== "supervisor") {
        throw new ForbiddenError("Only supervisors and admins can access system stats");
      }
    }

    const stats = await Agent.getDashboardStats();

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Helper: Calculate estimated wait time
 */
async function getEstimatedWaitTime() {
  const queueLength = await Conversation.countDocuments({
    type: "user-to-agent",
    status: "queued",
  });

  const availableAgents = await Agent.countDocuments({
    isActive: true,
    status: { $in: ["online", "away"] },
    $expr: { $lt: ["$activeChats", "$maxChats"] },
  });

  if (availableAgents === 0) {
    return "15-20 minutes"; // Default estimate when no agents available
  }

  const avgTime = Math.ceil((queueLength / Math.max(availableAgents, 1)) * 5);
  return `${avgTime}-${avgTime + 5} minutes`;
}

module.exports = exports;
