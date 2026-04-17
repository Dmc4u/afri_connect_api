const Agent = require("../models/Agent");
const User = require("../models/User");
const NotFoundError = require("../utils/errors/NotFoundError");
const BadRequestError = require("../utils/errors/BadRequestError");
const ForbiddenError = require("../utils/errors/ForbiddenError");

/**
 * Create a new agent (Admin only)
 */
exports.createAgent = async (req, res, next) => {
  try {
    // Verify requester is admin
    if (req.user.role !== "admin") {
      throw new ForbiddenError("Only admins can create agents");
    }

    const { userId, role, department, languages, specializations, assignedCountries, maxChats } =
      req.body;

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    // Check if user is already an agent
    if (user.isAgent) {
      throw new BadRequestError("User is already an agent");
    }

    // Create agent profile
    const agent = await Agent.create({
      userId,
      role: role || "support",
      department: department || "customer_support",
      languages: languages || ["English"],
      specializations: specializations || [],
      assignedCountries: assignedCountries || [],
      maxChats: maxChats || 5,
      status: "offline",
      isActive: true,
    });

    // Update user to mark as agent
    user.isAgent = true;
    user.agentProfile = agent._id;
    await user.save();

    await agent.populate("userId", "name email profilePhoto");

    res.status(201).json({
      success: true,
      message: "Agent created successfully",
      data: agent,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all agents (Admin/Supervisor only)
 */
exports.getAllAgents = async (req, res, next) => {
  try {
    const { status, role, department, page = 1, limit = 20 } = req.query;

    const query = {};

    if (status) query.status = status;
    if (role) query.role = role;
    if (department) query.department = department;

    const skip = (page - 1) * limit;

    const agents = await Agent.find(query)
      .populate("userId", "name email profilePhoto country")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Agent.countDocuments(query);

    res.status(200).json({
      success: true,
      data: agents,
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
 * Get agent by ID
 */
exports.getAgentById = async (req, res, next) => {
  try {
    const { agentId } = req.params;

    const agent = await Agent.findById(agentId)
      .populate("userId", "name email profilePhoto country phone")
      .populate("supervisorId");

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    res.status(200).json({
      success: true,
      data: agent,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update agent profile
 */
exports.updateAgent = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const updates = req.body;

    // Fields that can be updated
    const allowedUpdates = [
      "role",
      "department",
      "languages",
      "specializations",
      "assignedCountries",
      "maxChats",
      "availability",
      "permissions",
      "autoResponses",
      "notes",
      "isActive",
      "supervisorId",
    ];

    // Filter out non-allowed fields
    const filteredUpdates = {};
    Object.keys(updates).forEach((key) => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    const agent = await Agent.findByIdAndUpdate(agentId, filteredUpdates, {
      new: true,
      runValidators: true,
    }).populate("userId", "name email profilePhoto");

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    res.status(200).json({
      success: true,
      message: "Agent updated successfully",
      data: agent,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete/deactivate agent
 */
exports.deleteAgent = async (req, res, next) => {
  try {
    const { agentId } = req.params;

    const agent = await Agent.findById(agentId);
    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    // Check if agent has active chats
    if (agent.activeChats > 0) {
      throw new BadRequestError(
        "Cannot deactivate agent with active conversations. Transfer or close them first."
      );
    }

    // Deactivate agent instead of deleting
    agent.isActive = false;
    agent.status = "offline";
    await agent.save();

    // Update user
    const user = await User.findById(agent.userId);
    if (user) {
      user.isAgent = false;
      user.agentProfile = null;
      await user.save();
    }

    res.status(200).json({
      success: true,
      message: "Agent deactivated successfully",
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get agent performance report
 */
exports.getAgentPerformance = async (req, res, next) => {
  try {
    const { agentId } = req.params;
    const { startDate, endDate } = req.query;

    const agent = await Agent.findById(agentId).populate("userId", "name email");

    if (!agent) {
      throw new NotFoundError("Agent not found");
    }

    const Conversation = require("../models/Conversation");

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const conversations = await Conversation.find({
      assignedAgent: agentId,
      ...(Object.keys(dateFilter).length > 0 && { createdAt: dateFilter }),
    });

    const performance = {
      agentInfo: {
        _id: agent._id,
        name: agent.userId.name,
        email: agent.userId.email,
        role: agent.role,
        department: agent.department,
      },
      period: {
        startDate: startDate || "All time",
        endDate: endDate || "Now",
      },
      metrics: {
        totalChats: conversations.length,
        resolvedChats: conversations.filter((c) => c.status === "closed").length,
        avgRating: agent.rating,
        totalRatings: agent.totalRatings,
        avgResponseTime: agent.avgResponseTime,
        avgResolutionTime: agent.avgResolutionTime,
        escalatedChats: agent.escalatedChats,
        activeChats: agent.activeChats,
        successRate: agent.successRate,
      },
      satisfactionBreakdown: {
        5: conversations.filter((c) => c.customerSatisfaction.rating === 5).length,
        4: conversations.filter((c) => c.customerSatisfaction.rating === 4).length,
        3: conversations.filter((c) => c.customerSatisfaction.rating === 3).length,
        2: conversations.filter((c) => c.customerSatisfaction.rating === 2).length,
        1: conversations.filter((c) => c.customerSatisfaction.rating === 1).length,
      },
      recentActivity: conversations
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10)
        .map((c) => ({
          conversationId: c._id,
          status: c.status,
          rating: c.customerSatisfaction.rating,
          createdAt: c.createdAt,
          resolvedAt: c.resolvedAt,
        })),
    };

    res.status(200).json({
      success: true,
      data: performance,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Bulk update agent status (e.g., end of shift)
 */
exports.bulkUpdateStatus = async (req, res, next) => {
  try {
    const { agentIds, status } = req.body;

    if (!["online", "offline", "busy", "away"].includes(status)) {
      throw new BadRequestError("Invalid status");
    }

    const result = await Agent.updateMany(
      { _id: { $in: agentIds } },
      {
        status,
        lastStatusChange: new Date(),
      }
    );

    res.status(200).json({
      success: true,
      message: `Updated ${result.modifiedCount} agents to ${status}`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get available agents count
 */
exports.getAvailableAgentsCount = async (req, res, next) => {
  try {
    const { department, role } = req.query;

    const query = {
      isActive: true,
      status: { $in: ["online", "away"] },
      $expr: { $lt: ["$activeChats", "$maxChats"] },
    };

    if (department) query.department = department;
    if (role) query.role = role;

    const count = await Agent.countDocuments(query);

    res.status(200).json({
      success: true,
      availableAgents: count,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
