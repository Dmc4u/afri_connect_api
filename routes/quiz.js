const express = require("express");
const {
  getQuizSession,
  advanceExpiredQuizSession,
  getQuizQuestions,
  getQuizQuestionByNumber,
  submitQuizAnswer,
  getQuizContestants,
  updateQuizSessionSettings,
  executeQuizRaffle,
  restartQuizSession,
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
const { strictLimiter } = require("../middlewares/rateLimiter");

const router = express.Router();

// Public routes
router.get("/session", getQuizSession);
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
router.post("/admin/raffle", auth, strictLimiter, executeQuizRaffle);
router.post("/admin/restart", auth, restartQuizSession);
router.delete("/admin/contestants/:contestantId", auth, deleteQuizContestant);
router.post("/admin/contestants/message", auth, contactQuizContestants);
router.post("/admin/questions", auth, setQuizQuestion);
router.get("/admin/questions", auth, getAllQuizQuestions);

module.exports = router;
