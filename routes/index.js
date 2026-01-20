const express = require("express");
const userRouter = require("./user");
const listingRouter = require("./listing");
const membershipRouter = require("./membership");
const forumRouter = require("./forum");
const searchRouter = require("./search");
const apiRouter = require("./api");
const adminRouter = require("./admin");
const analyticsRouter = require("./analytics");
const migrationRouter = require("./migration");
const paypalRouter = require("./paypal");
const messagingRouter = require("./messaging");
const contactThreadRouter = require("./contactThread");
const contactRouter = require("./contact");
const advertisingRouter = require("./advertising");
const leadsRouter = require("./leads");
const verificationRouter = require("./verification");
const pricingRouter = require("./pricing");
const featuredRouter = require("./featured");
const reviewsRouter = require("./reviews");
const liveTalentEventRouter = require("./liveTalentEvent");
const adminLiveEventRouter = require("./adminLiveEvent");
const talentShowcaseRouter = require("./talentShowcase");
const proxyRouter = require("./proxy");
const aiSupportRouter = require("./aiSupport");
const businessLeadersRouter = require("./businessLeaders");
const adminBusinessLeadersRouter = require("./adminBusinessLeaders");
const { NotFoundError } = require("../utils/errors");

const router = express.Router();

// Public API routes (must come BEFORE /api to avoid auth middleware)
router.use("/api/live-talent-event", liveTalentEventRouter);
router.use("/api/admin/live-event", adminLiveEventRouter);
router.use("/api/ai-support", aiSupportRouter);

// Public content routes
router.use("/business-leaders", businessLeadersRouter);

router.use("/users", userRouter);
router.use("/listings", listingRouter);
router.use("/membership", membershipRouter);
router.use("/forum", forumRouter);
router.use("/search", searchRouter);
router.use("/api/proxy", proxyRouter);
router.use("/api", apiRouter);

// Admin sub-routes that must win over /admin router fallbacks
router.use("/admin/business-leaders", adminBusinessLeadersRouter);
router.use("/admin", adminRouter);
router.use("/analytics", analyticsRouter);
router.use("/migration", migrationRouter);
router.use("/paypal", paypalRouter);
router.use("/messages", messagingRouter);
router.use("/contact-threads", contactThreadRouter);
router.use("/contact", contactRouter);
router.use("/advertising", advertisingRouter);
router.use("/leads", leadsRouter);
router.use("/verification", verificationRouter);
router.use("/talent-showcase", talentShowcaseRouter);
router.use("/", pricingRouter);
router.use("/featured", featuredRouter);
router.use("/reviews", reviewsRouter);
router.use("/proxy", proxyRouter);

// Handle non-existent routes
router.use((req, res, next) => {
  next(new NotFoundError("Requested resource not found"));
});

module.exports = router;
