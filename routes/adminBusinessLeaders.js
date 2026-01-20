const express = require('express');
const { celebrate, Joi } = require('celebrate');
const auth = require('../middlewares/auth');
const { adminCheckMiddleware } = require('../utils/adminCheck');
const { readLeaders, writeLeaders, normalizeLeader } = require('../utils/businessLeadersStore');
const { NotFoundError } = require('../utils/errors');

const router = express.Router();

router.use(auth);
router.use(adminCheckMiddleware);

const leaderBody = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  company: Joi.string().trim().max(120).allow(''),
  industry: Joi.string().trim().max(120).allow(''),
  country: Joi.string().trim().max(80).allow(''),
  image: Joi.string().trim().max(2000).allow(''),
  description: Joi.string().trim().max(1200).allow(''),
  website: Joi.string().trim().max(2000).allow(''),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer().min(-9999).max(9999),
});

const leaderPatchBody = Joi.object({
  name: Joi.string().trim().min(2).max(80),
  company: Joi.string().trim().max(120).allow(''),
  industry: Joi.string().trim().max(120).allow(''),
  country: Joi.string().trim().max(80).allow(''),
  image: Joi.string().trim().max(2000).allow(''),
  description: Joi.string().trim().max(1200).allow(''),
  website: Joi.string().trim().max(2000).allow(''),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer().min(-9999).max(9999),
}).min(1);

// Admin: list all leaders (including inactive)
router.get('/', async (req, res) => {
  const leaders = await readLeaders();
  res.json({ success: true, leaders });
});

// Admin: create leader
router.post('/', celebrate({ body: leaderBody }), async (req, res) => {
  const leaders = await readLeaders();
  const leader = normalizeLeader(req.body);
  leaders.push(leader);
  await writeLeaders(leaders);
  res.status(201).json({ success: true, leader });
});

// Admin: update leader
router.patch(
  '/:id',
  celebrate({
    params: Joi.object({ id: Joi.string().min(1).required() }),
    body: leaderPatchBody,
  }),
  async (req, res) => {
    const leaders = await readLeaders();
    const idx = leaders.findIndex((l) => String(l?.id) === String(req.params.id));
    if (idx === -1) throw new NotFoundError('Leader not found');

    const updated = normalizeLeader({ ...leaders[idx], ...req.body, id: leaders[idx].id, createdAt: leaders[idx].createdAt }, { allowId: true });
    leaders[idx] = updated;
    await writeLeaders(leaders);

    res.json({ success: true, leader: updated });
  }
);

// Admin: delete leader
router.delete(
  '/:id',
  celebrate({ params: Joi.object({ id: Joi.string().min(1).required() }) }),
  async (req, res) => {
    const leaders = await readLeaders();
    const next = leaders.filter((l) => String(l?.id) !== String(req.params.id));
    if (next.length === leaders.length) throw new NotFoundError('Leader not found');

    await writeLeaders(next);
    res.json({ success: true });
  }
);

module.exports = router;
