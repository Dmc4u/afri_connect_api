const router = require("express").Router();
const { getAppStatus } = require("../controllers/appStatus");

// Public route - no authentication required
router.get("/", getAppStatus);

module.exports = router;
