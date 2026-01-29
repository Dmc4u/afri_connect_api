const router = require("express").Router();
const { getFaq } = require("../controllers/faq");

// Public route - no authentication required
router.get("/", getFaq);

module.exports = router;
