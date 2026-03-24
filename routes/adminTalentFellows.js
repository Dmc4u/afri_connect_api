const express = require("express");
const { celebrate, Joi } = require("celebrate");
const auth = require("../middlewares/auth");
const { adminCheckMiddleware } = require("../utils/adminCheck");
const { readFellows, writeFellows, normalizeFellow } = require("../utils/talentFellowsStore");
const { NotFoundError } = require("../utils/errors");

const router = express.Router();

router.use(auth);
router.use(adminCheckMiddleware);

const fellowBody = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  talent: Joi.string().trim().max(120).allow(""),
  category: Joi.string().trim().max(120).allow(""),
  country: Joi.string().trim().max(80).allow(""),
  image: Joi.string().trim().max(2000).allow(""),
  description: Joi.string().trim().max(1200).allow(""),
  website: Joi.string().trim().max(2000).allow(""),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer().min(-9999).max(9999),
});

const fellowPatchBody = Joi.object({
  name: Joi.string().trim().min(2).max(80),
  talent: Joi.string().trim().max(120).allow(""),
  category: Joi.string().trim().max(120).allow(""),
  country: Joi.string().trim().max(80).allow(""),
  image: Joi.string().trim().max(2000).allow(""),
  description: Joi.string().trim().max(1200).allow(""),
  website: Joi.string().trim().max(2000).allow(""),
  isActive: Joi.boolean(),
  sortOrder: Joi.number().integer().min(-9999).max(9999),
}).min(1);

// Admin: list all fellows (including inactive)
router.get("/", async (req, res) => {
  const fellows = await readFellows();
  res.json({ success: true, fellows });
});

// Admin: create fellow
router.post("/", celebrate({ body: fellowBody }), async (req, res) => {
  const fellows = await readFellows();
  const fellow = normalizeFellow(req.body);
  fellows.push(fellow);
  await writeFellows(fellows);
  res.status(201).json({ success: true, fellow });
});

// Admin: update fellow
router.patch(
  "/:id",
  celebrate({
    params: Joi.object({ id: Joi.string().min(1).required() }),
    body: fellowPatchBody,
  }),
  async (req, res) => {
    const fellows = await readFellows();
    const idx = fellows.findIndex((f) => String(f?.id) === String(req.params.id));
    if (idx === -1) throw new NotFoundError("Fellow not found");

    const updated = normalizeFellow(
      { ...fellows[idx], ...req.body, id: fellows[idx].id, createdAt: fellows[idx].createdAt },
      { allowId: true }
    );
    fellows[idx] = updated;
    await writeFellows(fellows);

    res.json({ success: true, fellow: updated });
  }
);

// Admin: delete fellow
router.delete(
  "/:id",
  celebrate({ params: Joi.object({ id: Joi.string().min(1).required() }) }),
  async (req, res) => {
    const fellows = await readFellows();
    const next = fellows.filter((f) => String(f?.id) !== String(req.params.id));
    if (next.length === fellows.length) throw new NotFoundError("Fellow not found");

    await writeFellows(next);
    res.json({ success: true });
  }
);

module.exports = router;
