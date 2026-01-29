const { getClientFaqJson } = require("../utils/appContent");

const getFaq = async (req, res, next) => {
  try {
    const { faq, mtimeMs } = getClientFaqJson();

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      source: {
        type: "client-faqData.json",
        mtimeMs,
      },
      faq,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFaq,
};
