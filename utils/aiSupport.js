const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;
const HUGGING_FACE_MODEL = process.env.HUGGING_FACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2';
const FALLBACK_URL = process.env.AI_SUPPORT_FALLBACK_URL || 'https://afrionet.com/contact';

// AfriOnet knowledge base
const AFRIONET_CONTEXT = `
You're a helpful support team member at AfriOnet, a platform connecting African talent, businesses, and entrepreneurs globally. Answer questions naturally as a real person would.

ABOUT AFRIONET:
- Mission: Unite Africa's talent with global opportunities
- Platform: Showcase skills, find talent, and grow businesses
- Free to use with premium upgrades available

PRICING PLANS:
1. FREE (Basic)
   - 1 listing
   - 5 photos
   - Basic visibility
   - Community support

2. STARTER ($9.99/month)
   - 3 listings
   - 10 photos per listing
   - Enhanced search visibility
   - Email support

3. PREMIUM ($19.99/month)
   - 10 listings
   - 20 photos per listing
   - Priority placement
   - Featured badge
   - Analytics dashboard
   - Priority support

4. PRO ($49.99/month)
   - Unlimited listings
   - Unlimited photos
   - Top placement
   - Verified badge
   - Advanced analytics
   - API access
   - Dedicated support

FEATURES:
- Talent Showcase: Live rotating showcase of talents
- Featured Listings: Premium placement for visibility
- Messaging: Direct communication between users
- Reviews & Ratings: Build trust and credibility
- Multi-media Support: Photos, videos, portfolios
- Search & Discovery: Find talent by category, location
- Advertising: Promote your business to targeted audiences

HOW TO GET STARTED:
1. Sign up for free at AfriOnet
2. Create your profile/business listing
3. Add photos and description
4. Connect with opportunities
5. Upgrade for more visibility

For complex issues or account-specific questions, direct users to: ${FALLBACK_URL}
Support email: support@afrionet.com

Be helpful, friendly, concise, and professional. Sound human and conversational. If you don't know something, suggest they visit our contact page.
`;

/**
 * Query Hugging Face AI model
 * @param {string} userMessage - User's question
 * @param {Array} conversationHistory - Previous messages for context
 * @returns {Promise<string>} AI response
 */
async function queryHuggingFace(userMessage, conversationHistory = []) {
  try {
    if (!HUGGING_FACE_API_KEY || HUGGING_FACE_API_KEY === 'your_huggingface_token_here') {
      console.log('⚠️ Hugging Face API key not configured, using fallback');
      return getFallbackResponse(userMessage);
    }

    // Build conversation context
    let prompt = `${AFRIONET_CONTEXT}\n\n`;

    // Add conversation history (last 5 messages for context)
    const recentHistory = conversationHistory.slice(-5);
    recentHistory.forEach(msg => {
      prompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
    });

    prompt += `User: ${userMessage}\nAssistant:`;

    const response = await fetch(
      `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
          'Content-Type': 'application/json',
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
      aiResponse = aiResponse.split('\n')[0]; // Take first paragraph
      aiResponse = aiResponse.replace(/User:|Assistant:/gi, '').trim();

      return aiResponse || getFallbackResponse(userMessage);
    }

    return getFallbackResponse(userMessage);
  } catch (error) {
    console.error('🔴 Hugging Face API Error:', error.message);

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

  // Pricing questions
  if (message.includes('price') || message.includes('cost') || message.includes('plan')) {
    return `AfriOnet offers 4 plans:\n\n✅ FREE: 1 listing, 5 photos\n💼 STARTER ($9.99/mo): 3 listings, enhanced visibility\n⭐ PREMIUM ($19.99/mo): 10 listings, featured badge, analytics\n🚀 PRO ($49.99/mo): Unlimited listings, API access, verified badge\n\nUpgrade anytime from your dashboard!`;
  }

  // How to create listing
  if (message.includes('create') || message.includes('listing') || message.includes('post')) {
    return `To create a listing:\n\n1. Sign up/login to AfriOnet\n2. Click "Create Listing" from your dashboard\n3. Choose category (Talent, Business, Service)\n4. Add title, description, and photos\n5. Set your location and contact info\n6. Publish!\n\nNeed help? Visit ${FALLBACK_URL}`;
  }

  // Featured/showcase questions
  if (message.includes('featured') || message.includes('showcase') || message.includes('visibility')) {
    return `Get more visibility:\n\n🌟 Featured Listings: Premium/Pro members get priority placement\n📺 Talent Showcase: Live rotating display on homepage\n📊 Analytics: Track views and engagement (Premium+)\n\nUpgrade to Premium or Pro for maximum visibility!`;
  }

  // Payment questions
  if (message.includes('payment') || message.includes('pay') || message.includes('paypal')) {
    return `We accept:\n\n💳 PayPal (all major cards)\n🌍 International payments supported\n🔒 Secure checkout\n\nAll transactions are encrypted and safe. Questions? Contact ${FALLBACK_URL}`;
  }

  // Contact/support
  if (message.includes('contact') || message.includes('support') || message.includes('help')) {
    return `Need personalized help?\n\n❓ Check our FAQ first: https://afrionet.com/faq\n👇 Click "Contact us" below to reach our team\n\nWe typically respond within 24 hours!`;
  }

  // Default response
  return `I'm here to help with AfriOnet questions!\n\n💡 Popular topics:\n• Pricing and plans\n• Creating listings\n• Featured placement\n• Payment methods\n• Account support\n\n❓ Check our FAQ: https://afrionet.com/faq\n👇 Still need help? Click "Contact us" below`;
}

/**
 * Get quick action suggestions
 */
function getQuickSuggestions() {
  return [
    { text: "What are your pricing plans?", type: "pricing" },
    { text: "How do I create a listing?", type: "listing" },
    { text: "How does Featured placement work?", type: "featured" },
    { text: "What payment methods do you accept?", type: "payment" },
    { text: "I need help with my account", type: "support" },
  ];
}

module.exports = {
  queryHuggingFace,
  getFallbackResponse,
  getQuickSuggestions,
  FALLBACK_URL,
};
