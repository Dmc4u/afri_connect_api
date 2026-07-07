const express = require("express");
const auth = require("../middlewares/auth");
const adminAuth = require("../middlewares/adminAuth");
const {
  digitalServicesReadLimiter,
  digitalServicesPurchaseIpLimiter,
  digitalServicesPurchaseUserLimiter,
} = require("../middlewares/rateLimiter");
const {
  getWallet,
  listAirtimeCountries,
  listAirtimeOperators,
  sendAirtime,
  listDataBundles,
  purchaseData,
  listGiftCards,
  purchaseGiftCard,
  listTransactions,
  getServiceAgentDashboard,
  requestServiceAgentAccess,
  listPendingServiceAgentRequests,
  listAdminServiceAgents,
  listAdminTransactions,
  adminResolveTransaction,
  adminDeleteTransactionEntry,
  adminSetServiceAgent,
  adminAdjustServiceAgentWallet,
  adminCreditWallet,
  adminWithdrawRevenue,
} = require("../controllers/digitalServices");

const router = express.Router();
const purchaseLimiters = [
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
];

router.get("/digital-services/wallet", digitalServicesReadLimiter, auth, getWallet);

router.get("/airtime/countries", digitalServicesReadLimiter, listAirtimeCountries);
router.get("/airtime/operators/:country", digitalServicesReadLimiter, listAirtimeOperators);
router.post("/airtime/send", purchaseLimiters, sendAirtime);

router.get("/data/bundles", digitalServicesReadLimiter, listDataBundles);
router.post("/data/purchase", purchaseLimiters, purchaseData);

router.get("/gift-cards/products", digitalServicesReadLimiter, listGiftCards);
router.post("/gift-cards/purchase", purchaseLimiters, purchaseGiftCard);

router.get("/digital-services/transactions", digitalServicesReadLimiter, auth, listTransactions);
router.post(
  "/digital-services/agent/apply",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  requestServiceAgentAccess
);
router.get(
  "/digital-services/agent/dashboard",
  digitalServicesReadLimiter,
  auth,
  getServiceAgentDashboard
);
router.get(
  "/admin/digital-services/transactions",
  digitalServicesReadLimiter,
  auth,
  adminAuth,
  listAdminTransactions
);
router.get(
  "/admin/digital-services/agents/pending",
  digitalServicesReadLimiter,
  auth,
  adminAuth,
  listPendingServiceAgentRequests
);
router.get(
  "/admin/digital-services/agents",
  digitalServicesReadLimiter,
  auth,
  adminAuth,
  listAdminServiceAgents
);
router.post(
  "/admin/digital-services/transactions/:transactionId/resolve",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  adminAuth,
  adminResolveTransaction
);
router.delete(
  "/admin/digital-services/transactions/:entryType/:entryId",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  adminAuth,
  adminDeleteTransactionEntry
);
router.post(
  "/admin/digital-services/agents/role",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  adminAuth,
  adminSetServiceAgent
);
router.post(
  "/admin/digital-services/agents/wallet",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  adminAuth,
  adminAdjustServiceAgentWallet
);
router.post(
  "/admin/digital-services/wallet/credit",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  adminAuth,
  adminCreditWallet
);
router.post(
  "/admin/digital-services/revenue/withdraw",
  digitalServicesPurchaseIpLimiter,
  auth,
  digitalServicesPurchaseUserLimiter,
  adminAuth,
  adminWithdrawRevenue
);

module.exports = router;
