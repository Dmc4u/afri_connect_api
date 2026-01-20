const express = require('express');
const { readLeaders } = require('../utils/businessLeadersStore');

const router = express.Router();

// Public: GET /business-leaders
router.get('/', async (req, res) => {
  const activeOnly = String(req.query.activeOnly ?? 'true').toLowerCase() !== 'false';

  let leaders = await readLeaders();
  if (activeOnly) leaders = leaders.filter((l) => l && l.isActive !== false);

  leaders.sort((a, b) => {
    const ao = Number(a?.sortOrder ?? 0);
    const bo = Number(b?.sortOrder ?? 0);
    if (ao !== bo) return ao - bo;
    return String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''));
  });

  res.json({ success: true, leaders });
});

module.exports = router;
