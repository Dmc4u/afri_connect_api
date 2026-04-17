const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const agentAssignment = require("../controllers/agentAssignment");
const agentAdmin = require("../controllers/agentAdmin");

/**
 * Agent Assignment & Support Routes
 * Base path: /api/agents
 */

// ==================== USER/CUSTOMER ENDPOINTS ====================

/**
 * @route   POST /api/agents/request
 * @desc    Request agent support (assigns available agent or queues)
 * @access  Private
 * @body    { requestType, priority, tags, userMessage }
 */
router.post("/request", auth, agentAssignment.assignAgent);

/**
 * @route   POST /api/agents/conversation/:conversationId/rate
 * @desc    Rate agent conversation (customer satisfaction)
 * @access  Private
 * @body    { rating, feedback }
 */
router.post("/conversation/:conversationId/rate", auth, agentAssignment.rateConversation);

// ==================== AGENT ENDPOINTS ====================

/**
 * @route   GET /api/agents/dashboard
 * @desc    Get agent's personal dashboard metrics
 * @access  Private (Agents only)
 */
router.get("/dashboard", auth, agentAssignment.getAgentDashboard);

/**
 * @route   GET /api/agents/conversations
 * @desc    Get agent's assigned conversations
 * @access  Private (Agents only)
 * @query   { status, page, limit }
 */
router.get("/conversations", auth, agentAssignment.getAgentConversations);

/**
 * @route   GET /api/agents/queue
 * @desc    Get support queue (conversations waiting for agents)
 * @access  Private (Agents only)
 * @query   { priority, status }
 */
router.get("/queue", auth, agentAssignment.getQueue);

/**
 * @route   POST /api/agents/accept
 * @desc    Accept a queued conversation
 * @access  Private (Agents only)
 * @body    { conversationId }
 */
router.post("/accept", auth, agentAssignment.acceptQueuedChat);

/**
 * @route   POST /api/agents/transfer
 * @desc    Transfer conversation to another agent
 * @access  Private (Agents only)
 * @body    { conversationId, toAgentId, reason }
 */
router.post("/transfer", auth, agentAssignment.transferChat);

/**
 * @route   POST /api/agents/close
 * @desc    Close/resolve a conversation
 * @access  Private (Agents only)
 * @body    { conversationId, resolution }
 */
router.post("/close", auth, agentAssignment.closeConversation);

/**
 * @route   PATCH /api/agents/status
 * @desc    Update agent status (online, offline, busy, away)
 * @access  Private (Agents only)
 * @body    { status }
 */
router.patch("/status", auth, agentAssignment.updateAgentStatus);

// ==================== ADMIN/SUPERVISOR ENDPOINTS ====================

/**
 * @route   GET /api/agents/stats
 * @desc    Get system-wide agent statistics
 * @access  Private (Admin/Supervisor only)
 */
router.get("/stats", auth, agentAssignment.getSystemStats);

/**
 * @route   POST /api/agents/admin/create
 * @desc    Create a new agent
 * @access  Private (Admin only)
 * @body    { userId, role, department, languages, specializations, maxChats }
 */
router.post("/admin/create", auth, agentAdmin.createAgent);

/**
 * @route   GET /api/agents/admin/all
 * @desc    Get all agents with filters
 * @access  Private (Admin/Supervisor only)
 * @query   { status, role, department, page, limit }
 */
router.get("/admin/all", auth, agentAdmin.getAllAgents);

/**
 * @route   GET /api/agents/admin/:agentId
 * @desc    Get agent details by ID
 * @access  Private (Admin/Supervisor only)
 */
router.get("/admin/:agentId", auth, agentAdmin.getAgentById);

/**
 * @route   PATCH /api/agents/admin/:agentId
 * @desc    Update agent profile
 * @access  Private (Admin only)
 * @body    { role, department, maxChats, permissions, etc. }
 */
router.patch("/admin/:agentId", auth, agentAdmin.updateAgent);

/**
 * @route   DELETE /api/agents/admin/:agentId
 * @desc    Deactivate an agent
 * @access  Private (Admin only)
 */
router.delete("/admin/:agentId", auth, agentAdmin.deleteAgent);

/**
 * @route   GET /api/agents/admin/:agentId/performance
 * @desc    Get detailed agent performance report
 * @access  Private (Admin/Supervisor only)
 * @query   { startDate, endDate }
 */
router.get("/admin/:agentId/performance", auth, agentAdmin.getAgentPerformance);

/**
 * @route   PATCH /api/agents/admin/bulk-status
 * @desc    Bulk update agent status
 * @access  Private (Admin only)
 * @body    { agentIds: [], status }
 */
router.patch("/admin/bulk-status", auth, agentAdmin.bulkUpdateStatus);

/**
 * @route   GET /api/agents/admin/available-count
 * @desc    Get count of available agents
 * @access  Public
 * @query   { department, role }
 */
router.get("/admin/available-count", agentAdmin.getAvailableAgentsCount);

module.exports = router;
