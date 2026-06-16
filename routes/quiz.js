const express = require("express");
const {
  getQuizSession,
  getPublicQuizEvents,
  getQuizEvents,
  createQuizEvent,
  updateQuizEvent,
  activateQuizEvent,
  deleteQuizEvent,
  advanceExpiredQuizSession,
  getQuizQuestions,
  getQuizQuestionByNumber,
  submitQuizAnswer,
  getQuizContestants,
  updateQuizSessionSettings,
  executeQuizRaffle,
  restartQuizSession,
  endQuizSession,
  skipCurrentQuizContestant,
  deleteQuizContestant,
  contactQuizContestants,
  setQuizQuestion,
  registerContestant,
  getAllQuizQuestions,
} = require("../controllers/quiz");
const {
  validateQuizQuestionNumber,
  validateQuizSubmission,
  validateContestantRegistration,
} = require("../middlewares/validation");
const auth = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const { strictLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// Public routes
router.get("/session", getQuizSession);
router.get("/events", optionalAuth, getPublicQuizEvents);
router.post("/session/advance-expired", advanceExpiredQuizSession);
router.get("/questions", getQuizQuestions);
router.get(
  "/questions/:number",
  auth,
  strictLimiter,
  validateQuizQuestionNumber,
  getQuizQuestionByNumber
);
router.post("/submit", auth, strictLimiter, validateQuizSubmission, submitQuizAnswer);
router.post(
  "/contestants",
  auth,
  strictLimiter,
  validateContestantRegistration,
  registerContestant
);
router.get("/contestants", getQuizContestants);

// Admin-only routes
router.put("/admin/settings", auth, updateQuizSessionSettings);
router.get("/admin/events", auth, getQuizEvents);
router.post("/admin/events", auth, createQuizEvent);
router.put("/admin/events/:eventId", auth, updateQuizEvent);
router.post("/admin/events/:eventId/activate", auth, activateQuizEvent);
router.delete("/admin/events/:eventId", auth, deleteQuizEvent);
router.post("/admin/raffle", auth, strictLimiter, executeQuizRaffle);
router.post("/admin/restart", auth, restartQuizSession);
router.post("/admin/end", auth, endQuizSession);
router.post("/admin/skip-current", auth, skipCurrentQuizContestant);
router.delete("/admin/contestants/:contestantId", auth, deleteQuizContestant);
router.post("/admin/contestants/message", auth, contactQuizContestants);
router.post("/admin/questions", auth, setQuizQuestion);
router.get("/admin/questions", auth, getAllQuizQuestions);

module.exports = router;
