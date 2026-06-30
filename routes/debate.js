const express = require("express");
const auth = require("../middlewares/auth");
const optionalAuth = require("../middlewares/optionalAuth");
const {
  getDebateEvent,
  getDebateEvents,
  createDebateEvent,
  updateDebateEvent,
  updateDebateEventById,
  activateDebateEvent,
  deleteDebateEvent,
  controlDebateEvent,
  registerForDebate,
  voteInDebate,
  markDebateParticipantReady,
  scoreDebateParticipant,
  executeDebateRaffle,
  deleteDebateParticipant,
  getDebateParticipantWhatsAppLink,
  contactDebateParticipants,
  transferDebateSlot,
} = require("../controllers/debate");

const router = express.Router();

router.get("/event", optionalAuth, getDebateEvent);
router.post("/register", auth, registerForDebate);
router.post("/vote", auth, voteInDebate);
router.post("/ready", auth, markDebateParticipantReady);
router.get("/admin/events", auth, getDebateEvents);
router.post("/admin/event", auth, createDebateEvent);
router.put("/admin/event", auth, updateDebateEvent);
router.put("/admin/events/:eventId", auth, updateDebateEventById);
router.post("/admin/events/:eventId/activate", auth, activateDebateEvent);
router.delete("/admin/events/:eventId", auth, deleteDebateEvent);
router.post("/admin/control", auth, controlDebateEvent);
router.post("/admin/raffle", auth, executeDebateRaffle);
router.delete("/admin/participants/:participantId", auth, deleteDebateParticipant);
router.get("/admin/participants/:participantId/whatsapp", auth, getDebateParticipantWhatsAppLink);
router.post("/admin/participants/message", auth, contactDebateParticipants);
router.post("/admin/participants/:participantId/transfer-slot", auth, transferDebateSlot);
router.put("/admin/participants/:participantId/score", auth, scoreDebateParticipant);

module.exports = router;
