const express = require("express");
const { readFellows } = require("../utils/talentFellowsStore");

const router = express.Router();

// Public: GET /talent-fellows
router.get("/", async (req, res) => {
  const activeOnly = String(req.query.activeOnly ?? "true").toLowerCase() !== "false";

  let fellows = await readFellows();
  if (activeOnly) fellows = fellows.filter((f) => f && f.isActive !== false);

  fellows.sort((a, b) => {
    const ao = Number(a?.sortOrder ?? 0);
    const bo = Number(b?.sortOrder ?? 0);
    if (ao !== bo) return ao - bo;
    return String(b?.createdAt || "").localeCompare(String(a?.createdAt || ""));
  });

  res.json({ success: true, fellows });
});

module.exports = router;
