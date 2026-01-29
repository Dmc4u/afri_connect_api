const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;
const HUGGING_FACE_MODEL = process.env.HUGGING_FACE_MODEL || "mistralai/Mistral-7B-Instruct-v0.2";
const FALLBACK_URL = process.env.AI_SUPPORT_FALLBACK_URL || "https://afrionet.com/contact";

const { getClientFeatureFlags, getClientFaqJson } = require("./appContent");

const DEFAULT_AFRIONET_CONTEXT = `
You're a helpful support team member at AfriOnet, a platform connecting African talent, businesses, and entrepreneurs globally.

Be helpful, friendly, concise, and professional. Sound human and conversational.

If you are unsure about a detail, say so and suggest the user check our FAQ or contact support.
FAQ: https://afrionet.com/faq
Contact: ${FALLBACK_URL}
`;

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeText(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "the",
  "their",
  "they",
  "this",
  "to",
  "us",
  "we",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

function tokenize(text) {
  const tokens = normalizeText(text)
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !STOPWORDS.has(t));

  // Handle common concatenations/missing spaces for brand keywords.
  // Example: "isafrionet" -> include "afrionet" so retrieval can match.
  const expanded = new Set(tokens);
  for (const t of tokens) {
    if (t.includes("afrionet")) expanded.add("afrionet");
  }

  return Array.from(expanded);
}

let cachedFaqIndex = null;
let cachedFaqIndexMtimeMs = null;

function buildFaqIndexFromJson(faqSections) {
  const items = [];
  if (!Array.isArray(faqSections)) return items;

  for (const section of faqSections) {
    const category = safeString(section?.category);
    const questions = Array.isArray(section?.questions) ? section.questions : [];
    for (const qa of questions) {
      const q = safeString(qa?.q);
      const a = safeString(qa?.a);
      if (!q || !a) continue;

      const searchable = `${category} ${q} ${a}`;
      const tokens = tokenize(searchable);
      items.push({
        category,
        q,
        a,
        anchor: safeString(qa?.anchor),
        tokens,
      });
    }
  }

  return items;
}

function getFaqIndex() {
  const { faq, mtimeMs } = getClientFaqJson();
  if (!cachedFaqIndex || cachedFaqIndexMtimeMs !== mtimeMs) {
    cachedFaqIndex = buildFaqIndexFromJson(faq);
    cachedFaqIndexMtimeMs = mtimeMs;
  }
  return cachedFaqIndex;
}

function scoreFaqItem(queryTokens, item) {
  if (!queryTokens.length) return 0;
  const tokenSet = new Set(item.tokens);

  let score = 0;
  for (const t of queryTokens) {
    if (tokenSet.has(t)) score += 2;
  }

  // Phrase-ish boosts
  const qNorm = normalizeText(item.q);
  const joined = queryTokens.join(" ");
  if (joined && qNorm.includes(joined)) score += 3;

  // Small boosts for strong intent keywords
  if (queryTokens.includes("membership") && tokenSet.has("membership")) score += 2;
  if (queryTokens.includes("pricing") && tokenSet.has("pricing")) score += 2;
  if (queryTokens.includes("fees") && (tokenSet.has("fee") || tokenSet.has("fees"))) score += 2;
  if (queryTokens.includes("listing") && (tokenSet.has("listing") || tokenSet.has("listings")))
    score += 2;
  if (queryTokens.includes("verify") && (tokenSet.has("verify") || tokenSet.has("verified")))
    score += 2;

  return score;
}

function getRelevantFaqPairs(userMessage, { topK = 5, minScore = 2 } = {}) {
  const queryTokens = tokenize(userMessage);
  if (!queryTokens.length) return [];

  const index = getFaqIndex();

  const scored = index
    .map((item) => ({
      item,
      score: scoreFaqItem(queryTokens, item),
    }))
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map((x) => x.item);
}

function formatRelevantFaqForPrompt(relevantItems, { maxChars = 4500 } = {}) {
  if (!Array.isArray(relevantItems) || relevantItems.length === 0) return "";

  let out = "RELEVANT FAQ (authoritative excerpts)\n";
  for (const item of relevantItems) {
    if (out.length >= maxChars) break;
    const category = safeString(item?.category);
    if (category) out += `\n[${category}]\n`;
    out += `Q: ${safeString(item?.q)}\nA: ${safeString(item?.a)}\n`;
  }

  if (out.length > maxChars) out = out.slice(0, maxChars - 3) + "...";
  return out.trim();
}

function buildAfrionetContext(userMessage = "") {
  try {
    const { flags } = getClientFeatureFlags();

    const membershipUiEnabled = Boolean(flags?.MEMBERSHIP_UI_ENABLED);
    const membershipRouteEnabled = Boolean(flags?.MEMBERSHIP_ROUTE_ENABLED);
    const forceProForAll = Boolean(flags?.FORCE_PRO_MEMBERSHIP_FOR_ALL);
    const talentShowcaseEntryFeesEnabled = Boolean(flags?.TALENT_SHOWCASE_ENTRY_FEES_ENABLED);

    const growthMode = !membershipUiEnabled && !membershipRouteEnabled;
    const freeEntryMode = !talentShowcaseEntryFeesEnabled;

    const statusLines = [
      "APP STATUS (authoritative from feature flags)",
      `- growthMode: ${growthMode ? "true" : "false"}`,
      `- freeEntryMode: ${freeEntryMode ? "true" : "false"}`,
      `- MEMBERSHIP_UI_ENABLED: ${membershipUiEnabled ? "true" : "false"}`,
      `- MEMBERSHIP_ROUTE_ENABLED: ${membershipRouteEnabled ? "true" : "false"}`,
      `- FORCE_PRO_MEMBERSHIP_FOR_ALL: ${forceProForAll ? "true" : "false"}`,
      `- TALENT_SHOWCASE_ENTRY_FEES_ENABLED: ${talentShowcaseEntryFeesEnabled ? "true" : "false"}`,
    ].join("\n");

    const relevant = getRelevantFaqPairs(userMessage, { topK: 5, minScore: 2 });
    const faqText = formatRelevantFaqForPrompt(relevant, { maxChars: 4500 });

    return `
You're a helpful support team member at AfriOnet.

Grounding rules:
- Use the APP STATUS and FAQ below as your source of truth.
- If a detail is not present in these sources, say you’re not sure and direct the user to the FAQ or contact page.
- Do not invent pricing/tier details if not provided.

Links:
- FAQ: https://afrionet.com/faq
- Contact: ${FALLBACK_URL}

${statusLines}

${faqText || "(No highly relevant FAQ matches found for this question.)"}
`.trim();
  } catch (error) {
    return DEFAULT_AFRIONET_CONTEXT;
  }
}

/**
 * Query Hugging Face AI model
 * @param {string} userMessage - User's question
 * @param {Array} conversationHistory - Previous messages for context
 * @returns {Promise<string>} AI response
 */
async function queryHuggingFace(userMessage, conversationHistory = []) {
  try {
    if (!HUGGING_FACE_API_KEY || HUGGING_FACE_API_KEY === "your_huggingface_token_here") {
      console.log("⚠️ Hugging Face API key not configured, using fallback");
      return getFallbackResponse(userMessage);
    }

    // Build conversation context
    let prompt = `${buildAfrionetContext(userMessage)}\n\n`;

    // Add conversation history (last 5 messages for context)
    const recentHistory = conversationHistory.slice(-5);
    recentHistory.forEach((msg) => {
      prompt += `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}\n`;
    });

    prompt += `User: ${userMessage}\nAssistant:`;

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HUGGING_FACE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            max_new_tokens: 300,
            temperature: 0.7,
            top_p: 0.95,
            return_full_text: false,
          },
        }),
      }
    );

    if (!response.ok) {
      console.error(`Hugging Face API error: ${response.status}`);
      return getFallbackResponse(userMessage);
    }

    const data = await response.json();

    if (data && data[0] && data[0].generated_text) {
      let aiResponse = data[0].generated_text.trim();

      // Clean up the response
      aiResponse = aiResponse.split("\n")[0]; // Take first paragraph
      aiResponse = aiResponse.replace(/User:|Assistant:/gi, "").trim();

      return aiResponse || getFallbackResponse(userMessage);
    }

    return getFallbackResponse(userMessage);
  } catch (error) {
    console.error("🔴 Hugging Face API Error:", error.message);

    // Handle specific errors
    if (error.response?.status === 503) {
      return "I'm currently loading the AI model. Please try again in a moment, or visit our contact page for immediate assistance.";
    }

    return getFallbackResponse(userMessage);
  }
}

/**
 * Fallback responses when AI is unavailable
 */
function getFallbackResponse(userMessage) {
  const message = userMessage.toLowerCase();
  const compact = message.replace(/[^a-z0-9]+/g, "");

  const getGrowthModeBlurb = () => {
    try {
      const { flags } = getClientFeatureFlags();

      const membershipUiEnabled = Boolean(flags?.MEMBERSHIP_UI_ENABLED);
      const membershipRouteEnabled = Boolean(flags?.MEMBERSHIP_ROUTE_ENABLED);
      const forceProForAll = Boolean(flags?.FORCE_PRO_MEMBERSHIP_FOR_ALL);
      const talentShowcaseEntryFeesEnabled = Boolean(flags?.TALENT_SHOWCASE_ENTRY_FEES_ENABLED);

      const growthMode = !membershipUiEnabled && !membershipRouteEnabled;
      const freeEntryMode = !talentShowcaseEntryFeesEnabled;

      const parts = [];
      if (growthMode) {
        parts.push(
          "membership plans and upgrade prompts may be temporarily hidden",
          forceProForAll ? "Pro-like features may be temporarily unlocked for everyone" : null,
          "business listings are free for now"
        );
      } else {
        parts.push("membership may be enabled depending on your account/region");
      }

      if (freeEntryMode) parts.push("Talent Showcase entry fees are currently waived");

      return `AfriOnet status: ${parts.filter(Boolean).join(", ")}.`;
    } catch (e) {
      return "AfriOnet is currently running in a growth mode: membership plans and upgrade prompts may be temporarily hidden, Pro-like features may be temporarily unlocked for everyone, business listings are free for now, and Talent Showcase entry fees are currently waived.";
    }
  };

  const growthModeBlurb = getGrowthModeBlurb();

  // Growth mode / membership (current status)
  if (
    message.includes("growth mode") ||
    (message.includes("membership") && message.includes("right now")) ||
    (message.includes("membership") && message.includes("required")) ||
    message === "membership (growth mode)"
  ) {
    return `${growthModeBlurb}\n\nIf you need plan details, they’ll show in-app when membership is re-enabled.`;
  }

  // Listings free for now
  if (
    message.includes("business listings") &&
    (message.includes("free") || message.includes("free for now"))
  ) {
    return `Yes — business listings are free for now (growth mode).\n\n${growthModeBlurb}`;
  }

  // Showcase entry fees waived
  if (
    message.includes("entry fee") ||
    message.includes("entry fees") ||
    message.includes("free entry") ||
    message === "talent showcases (free entry for now)"
  ) {
    return `Talent Showcase entry fees are currently waived (free entry mode). If fees are re-enabled later, the event card/registration flow will show the fee and payment steps.`;
  }

  // About AfriOnet
  if (
    message.includes("what is afrionet") ||
    message.includes("about afrionet") ||
    compact.includes("whatisafrionet") ||
    compact.includes("aboutafrionet")
  ) {
    return `AfriOnet is a digital marketplace connecting African businesses, professionals, and service providers across the continent. It helps you showcase your business, display talent through competitions and live events, build partnerships, and grow your visibility online. Anyone can join - from small business owners to freelancers and talented individuals!`;
  }

  // Who can join
  if (message.includes("who can join") || message.includes("can i join")) {
    return `Anyone can join AfriOnet! Whether you're a small business owner, freelancer, professional, or talented individual based in Africa or serving African markets, AfriOnet is built for you. You can list your business, participate in talent showcases, compete for prizes, and connect with opportunities.`;
  }

  // Pricing questions
  if (
    message.includes("price") ||
    message.includes("cost") ||
    message.includes("plan") ||
    message.includes("free trial")
  ) {
    return `${growthModeBlurb}\n\nWhen membership is re-enabled, plan details will be shown in-app on the Membership page.`;
  }

  // Plan changes
  if (
    message.includes("change plan") ||
    message.includes("upgrade") ||
    message.includes("downgrade") ||
    message.includes("cancel")
  ) {
    return `${growthModeBlurb}\n\nWhen memberships are enabled, you can typically upgrade/downgrade from your account settings.`;
  }

  // How to create listing
  if (
    message.includes("create") ||
    message.includes("add listing") ||
    message.includes("post business")
  ) {
    return `To create a business listing:\n\n1. Sign up and login to AfriOnet\n2. Go to your profile and click "Add Business Listing"\n3. Fill in business details, category, and location\n4. Upload photos/videos/audio\n5. Submit for approval\n\n${growthModeBlurb}`;
  }

  // Media/photos/uploads
  if (
    message.includes("upload") ||
    message.includes("photo") ||
    message.includes("video") ||
    message.includes("media")
  ) {
    return `Yes. You can upload images, videos, or audio files to support your listing. Upload limits can vary when membership is enabled, but in growth mode premium-style features may be temporarily available to everyone.`;
  }

  // Verification
  if (message.includes("verif") || message.includes("authentic") || message.includes("trust")) {
    return `AfriOnet may use verification steps and trusted providers to confirm the authenticity of businesses and professionals. Verified accounts may receive a badge to help build trust.`;
  }

  // Talent category
  if (
    message.includes("talent category") ||
    message.includes("talent listing") ||
    (message.includes("talent") && message.includes("difference"))
  ) {
    return `The Talent category is for showcasing individual skills and services like freelancers, consultants, artists, performers, and skilled professionals. Talent listings appear in the special "Talented Showcase" section on the homepage, giving talented individuals maximum visibility. It's different from business categories which are for companies.`;
  }

  // Talent Showcases
  if (
    message.includes("talent showcase") ||
    message.includes("competition") ||
    message.includes("compete")
  ) {
    return `Talent Showcases are competitive events where talented individuals from across Africa compete for prizes and recognition!\n\nTo register:\n1. Visit the Talent Showcases page\n2. Find an upcoming event\n3. Click "Register to Compete"\n4. Provide details and upload your submission\n5. Entry fees are currently waived in free mode (if fees are re-enabled later, the event will show payment instructions)\n6. Register before the deadline`;
  }

  // Raffle system
  if (
    message.includes("raffle") ||
    message.includes("selection") ||
    message.includes("fair") ||
    message.includes("random")
  ) {
    return `When a showcase receives more registrations than available spots, we use a cryptographically fair raffle system! It uses SHA-256 hashing to generate random numbers for each contestant based on a public seed that anyone can verify. This ensures transparency and equal opportunity for all participants. You can verify raffle results by clicking "Verify Raffle Integrity" on any completed raffle.`;
  }

  // Waitlist
  if (message.includes("waitlist") || message.includes("waiting list")) {
    return `If you're selected for the waitlist, you'll be automatically promoted to a contestant spot if any selected participant drops out before the event. Waitlist positions are ranked based on the raffle results, so you'll know your chances!`;
  }

  // Live events
  if (
    message.includes("live event") ||
    message.includes("live broadcast") ||
    message.includes("live showcase")
  ) {
    return `Live Events are monthly talent showcases broadcast live on our platform! These events feature the best talents competing in real-time, with live voting and audience interaction. Check the Live Event page for upcoming broadcasts and participate in the excitement!`;
  }

  // Voting
  if (message.includes("vote") || message.includes("voting")) {
    return `During the voting phase of a showcase, you can cast votes for your favorite contestants! Each user can vote multiple times, and votes help determine the winners. Simply click the vote button on the contestant's card during the live event or voting period.`;
  }

  // Prizes
  if (message.includes("prize") || message.includes("win") || message.includes("reward")) {
    return `Prize amounts vary by showcase and are displayed on each event page. Winners are selected based on votes and judge decisions. All prize details, including amounts and distribution terms, are clearly stated before registration. Good luck! 🏆`;
  }

  // Featured/showcase questions
  if (
    message.includes("featured") ||
    (message.includes("showcase") && !message.includes("talent")) ||
    message.includes("visibility")
  ) {
    return `Get more visibility:\n\n• Featured placement can help your listing appear more prominently\n• Talent listings may appear in the Talented Showcase section\n• Some advanced features (like analytics/API access) may depend on membership when enabled\n\n${growthModeBlurb}`;
  }

  // Payment questions
  if (
    message.includes("payment") ||
    message.includes("pay") ||
    message.includes("paypal") ||
    message.includes("credit card")
  ) {
    return `${growthModeBlurb}\n\nWhen payments are enabled, common methods (such as cards and PayPal for some products) may be available depending on region. Transactions are processed securely.`;
  }

  // Refund questions
  if (message.includes("refund") || message.includes("money back")) {
    return `Refunds are handled on a case-by-case basis. If you believe you were charged incorrectly, contact support as soon as possible with the transaction details: ${FALLBACK_URL}`;
  }

  // Privacy/data questions
  if (
    message.includes("privacy") ||
    message.includes("data") ||
    message.includes("personal information")
  ) {
    return `We respect your privacy! AfriOnet does not sell or share personal data with third parties. All transactions are encrypted and secure. Please read our Privacy Policy for full details: ${FALLBACK_URL}`;
  }

  // Contact/support
  if (
    message.includes("contact") ||
    message.includes("support") ||
    message.includes("help") ||
    message.includes("email")
  ) {
    return `Need personalized help?\n\n📧 Email: support@afrionet.com\n🌐 Contact page: ${FALLBACK_URL}\n🗣️ Languages: English, French, Swahili (more coming!)\n⏱️ Response time: Within 24 hours\n\nFor FAQ, visit: https://afrionet.com/faq`;
  }

  // Report listing
  if (message.includes("report") || message.includes("fake") || message.includes("suspicious")) {
    return `To report a fake business or suspicious listing:\n\n1. Click "Report Listing" on the business page, OR\n2. Email us directly at support@afrionet.com with the business name and issue\n\nWe take reports seriously and investigate all claims promptly!`;
  }

  // Language support
  if (
    message.includes("language") ||
    message.includes("multilingual") ||
    message.includes("french") ||
    message.includes("swahili")
  ) {
    return `Yes! AfriOnet provides multilingual support across English, French, and Swahili, with more languages coming soon. Our platform is designed to serve all of Africa!`;
  }

  // Countries/availability
  if (
    message.includes("country") ||
    message.includes("countries") ||
    message.includes("available") ||
    message.includes("region")
  ) {
    return `AfriOnet is accessible across ALL African countries and internationally! You can list your business, showcase your talent, participate in competitions, connect with others, and collaborate without borders. 🌍`;
  }

  // FAQ-based fallback (auto-covers new FAQ sections like Forum)
  try {
    const matches = getRelevantFaqPairs(userMessage, { topK: 3, minScore: 2 });
    if (matches.length > 0) {
      const primary = matches[0];
      const related = matches.slice(1);

      const relatedBlock =
        related.length > 0 ? `\n\nRelated FAQ:\n- ${related.map((m) => m.q).join("\n- ")}` : "";

      return `${primary.a}${relatedBlock}`;
    }
  } catch (e) {
    // ignore and continue to default
  }

  // Default response
  return `I'm here to help with AfriOnet questions!\n\n💡 Popular topics:\n• Growth mode (membership hidden / listings free)\n• Creating listings & uploading media\n• Talent Showcases (free entry right now)\n• Verification & trust\n• Payments (when enabled) & refunds\n• Contacting support\n\n❓ Check our FAQ: https://afrionet.com/faq\n👇 Still need help? Click "Contact us" below or email support@afrionet.com`;
}

/**
 * Get quick action suggestions
 */
function getQuickSuggestions() {
  return [
    { text: "Membership (growth mode)", type: "membership" },
    { text: "Business listings (free for now)", type: "listings" },
    { text: "Talent Showcases (free entry for now)", type: "showcases" },
    { text: "How to create a business listing", type: "listing" },
    { text: "Contact support", type: "support" },
  ];
}

module.exports = {
  queryHuggingFace,
  getFallbackResponse,
  getQuickSuggestions,
  FALLBACK_URL,
  buildAfrionetContext,
};
