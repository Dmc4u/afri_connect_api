const HUGGING_FACE_API_KEY = process.env.HUGGING_FACE_API_KEY;
const HUGGING_FACE_MODEL = process.env.HUGGING_FACE_MODEL || 'mistralai/Mistral-7B-Instruct-v0.2';
const FALLBACK_URL = process.env.AI_SUPPORT_FALLBACK_URL || 'https://afrionet.com/contact';

// AfriOnet knowledge base with comprehensive FAQ
const AFRIONET_CONTEXT = `
You're a helpful support team member at AfriOnet, a platform connecting African talent, businesses, and entrepreneurs globally. Answer questions naturally as a real person would.

ABOUT AFRIONET:
- Mission: Digital marketplace connecting African businesses, professionals, and service providers across the continent
- Platform: Showcase business, display talent through competitions and live events, build partnerships, grow visibility
- Free to use with premium upgrades available
- Accessible across all African countries and internationally

WHO CAN JOIN:
Anyone! Small business owners, freelancers, professionals, talented individuals based in Africa or serving African markets. List your business, participate in talent showcases, compete for prizes, and connect with opportunities.

PRICING PLANS:
1. FREE (Basic)
   - 1 listing
   - 1 media file upload
   - Basic visibility
   - Community support
   - Free 14-day trial of Premium plan (no credit card required)

2. STARTER ($9.99/month)
   - 3 listings
   - Up to 3 media files per listing (images, videos, audio)
   - Enhanced search visibility
   - Email support

3. PREMIUM ($19.99/month)
   - 10 listings
   - Up to 3 media files per listing
   - Priority placement
   - Featured badge
   - Analytics dashboard
   - Priority support

4. PRO ($49.99/month)
   - Unlimited listings
   - Up to 6 media files per listing
   - Top placement
   - Verified badge
   - Advanced analytics
   - API access
   - Dedicated support

PLAN CHANGES:
- Can upgrade or downgrade anytime
- Changes reflected in next billing cycle
- No long-term contracts
- Cancel anytime from account settings

PAYMENTS:
- Accept all major credit cards, debit cards
- Mobile money payments across Africa
- PayPal supported
- All transactions encrypted and secure
- Refunds handled case-by-case within 7 days of payment
- Privacy respected - no data sharing with third parties

BUSINESS LISTINGS:
How to create:
1. Sign up and login
2. Go to profile, click "Add Business Listing"
3. Fill in business details, category, location
4. Upload media (photos/videos/audio based on tier)
5. Submit for approval

Verification:
- Partners with VerifyMe and Smile Identity
- Confirms authenticity of businesses and professionals

TALENT CATEGORY:
- For showcasing individual skills and services
- Freelancers, consultants, artists, performers, skilled professionals
- Appears in "Talented Showcase" section on homepage
- Different from business categories (for companies)
- Can request featured placement in Talented Showcase
- Create profile → Add Talent listing → Go to Featured page to schedule time slot

TALENT SHOWCASES & LIVE EVENTS:
What are Talent Showcases:
- Competitive events for talented individuals across Africa
- Compete for prizes and recognition
- Showcase African talent to global audience
- Career advancement opportunities

How to Register:
1. Navigate to Talent Showcases page
2. Find upcoming event
3. Click "Register to Compete"
4. Provide performance details
5. Upload submission
6. Pay entry fee if applicable
7. Register before deadline

Raffle Selection System:
- Used when registrations exceed available spots (e.g., 50 registrations for 5 spots)
- Cryptographically fair using SHA-256 hashing
- Generates random numbers for each contestant
- Based on public seed - anyone can verify
- Click "Verify Raffle Integrity" button to independently verify results
- Ensures transparency and equal opportunity

Waitlist:
- Selected waitlist participants automatically promoted if contestant drops out
- Ranked based on raffle results
- Notified if spot becomes available

Live Events:
- Monthly talent showcases broadcast live on platform
- Best talents competing in real-time
- Live voting and audience interaction
- Check Live Event page for upcoming broadcasts

Voting:
- Vote during voting phase of showcase
- Multiple votes allowed per user
- Helps determine winners
- Click vote button on contestant card

Prizes:
- Prize amounts vary by showcase
- Displayed on each event page
- Winners selected based on votes and judge decisions
- All prize details clearly stated before registration

FEATURES:
- Talent Showcase: Live rotating showcase of talents on homepage
- Featured Listings: Premium placement for maximum visibility
- Messaging: Direct communication between users
- Reviews & Ratings: Build trust and credibility
- Multi-media Support: Photos, videos, audio portfolios
- Search & Discovery: Find talent by category, location
- Advertising: Promote business to targeted audiences
- Forum: Community discussions and networking
- Verification Services: Confirm authenticity
- Analytics Dashboard: Track views and engagement (Premium+)

HOW TO GET STARTED:
1. Sign up for free at AfriOnet
2. Create your profile/business listing
3. Add photos and description
4. Connect with opportunities
5. Upgrade for more visibility

SUPPORT & CONTACT:
- Email: support@afrionet.com
- Contact page: ${FALLBACK_URL}
- Multilingual support: English, French, Swahili (more coming soon)
- Response time: Within 24 hours
- Report fake listings: Click "Report Listing" or email directly

For complex issues or account-specific questions, direct users to: ${FALLBACK_URL}

Be helpful, friendly, concise, and professional. Sound human and conversational. If you don't know something, suggest they visit our FAQ page or contact page.
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

  // About AfriOnet
  if (message.includes('what is afrionet') || message.includes('about afrionet')) {
    return `AfriOnet is a digital marketplace connecting African businesses, professionals, and service providers across the continent. It helps you showcase your business, display talent through competitions and live events, build partnerships, and grow your visibility online. Anyone can join - from small business owners to freelancers and talented individuals!`;
  }

  // Who can join
  if (message.includes('who can join') || message.includes('can i join')) {
    return `Anyone can join AfriOnet! Whether you're a small business owner, freelancer, professional, or talented individual based in Africa or serving African markets, AfriOnet is built for you. You can list your business, participate in talent showcases, compete for prizes, and connect with opportunities.`;
  }

  // Pricing questions
  if (message.includes('price') || message.includes('cost') || message.includes('plan') || message.includes('free trial')) {
    return `AfriOnet offers 4 plans:\n\n✅ FREE: 1 listing, 1 media file (includes 14-day Premium trial!)\n💼 STARTER ($9.99/mo): 3 listings, 3 media files each\n⭐ PREMIUM ($19.99/mo): 10 listings, featured badge, analytics\n🚀 PRO ($49.99/mo): Unlimited listings, verified badge, API access\n\nYou can upgrade/downgrade anytime with no long-term contracts. Cancel anytime from account settings!`;
  }

  // Plan changes
  if (message.includes('change plan') || message.includes('upgrade') || message.includes('downgrade') || message.includes('cancel')) {
    return `Yes! You can upgrade or downgrade your plan at any time. Changes will be reflected in your next billing cycle. There are no long-term contracts, and you can cancel your subscription anytime from your account settings.`;
  }

  // How to create listing
  if (message.includes('create') || message.includes('add listing') || message.includes('post business')) {
    return `To list your business:\n\n1. Sign up and login to AfriOnet\n2. Go to your profile, click "Add Business Listing"\n3. Fill in business details, category, and location\n4. Upload media (photos/videos/audio based on your tier)\n5. Submit for approval\n\nFree users get 1 media file, Starter gets 3, Premium gets 3, Pro gets 6!`;
  }

  // Media/photos/uploads
  if (message.includes('upload') || message.includes('photo') || message.includes('video') || message.includes('media')) {
    return `Yes! You can upload images, videos, or audio files depending on your membership tier:\n\n📷 FREE: 1 file\n📸 STARTER: 3 files per listing\n🎬 PREMIUM: 3 files per listing\n🎥 PRO: 6 files per listing\n\nAll media is reviewed for quality and relevance.`;
  }

  // Verification
  if (message.includes('verif') || message.includes('authentic') || message.includes('trust')) {
    return `AfriOnet partners with VerifyMe and Smile Identity to confirm the authenticity of businesses and professionals on the platform. Verified accounts get a special badge and higher trust from customers!`;
  }

  // Talent category
  if (message.includes('talent category') || message.includes('talent listing') || (message.includes('talent') && message.includes('difference'))) {
    return `The Talent category is for showcasing individual skills and services like freelancers, consultants, artists, performers, and skilled professionals. Talent listings appear in the special "Talented Showcase" section on the homepage, giving talented individuals maximum visibility. It's different from business categories which are for companies.`;
  }

  // Talent Showcases
  if (message.includes('talent showcase') || message.includes('competition') || message.includes('compete')) {
    return `Talent Showcases are competitive events where talented individuals from across Africa compete for prizes and recognition! These events showcase African talent to a global audience and provide career advancement opportunities.\n\nTo register:\n1. Visit Talent Showcases page\n2. Find an upcoming event\n3. Click "Register to Compete"\n4. Provide details and upload submission\n5. Pay entry fee (if applicable)\n6. Register before deadline`;
  }

  // Raffle system
  if (message.includes('raffle') || message.includes('selection') || message.includes('fair') || message.includes('random')) {
    return `When a showcase receives more registrations than available spots, we use a cryptographically fair raffle system! It uses SHA-256 hashing to generate random numbers for each contestant based on a public seed that anyone can verify. This ensures transparency and equal opportunity for all participants. You can verify raffle results by clicking "Verify Raffle Integrity" on any completed raffle.`;
  }

  // Waitlist
  if (message.includes('waitlist') || message.includes('waiting list')) {
    return `If you're selected for the waitlist, you'll be automatically promoted to a contestant spot if any selected participant drops out before the event. Waitlist positions are ranked based on the raffle results, so you'll know your chances!`;
  }

  // Live events
  if (message.includes('live event') || message.includes('live broadcast') || message.includes('live showcase')) {
    return `Live Events are monthly talent showcases broadcast live on our platform! These events feature the best talents competing in real-time, with live voting and audience interaction. Check the Live Event page for upcoming broadcasts and participate in the excitement!`;
  }

  // Voting
  if (message.includes('vote') || message.includes('voting')) {
    return `During the voting phase of a showcase, you can cast votes for your favorite contestants! Each user can vote multiple times, and votes help determine the winners. Simply click the vote button on the contestant's card during the live event or voting period.`;
  }

  // Prizes
  if (message.includes('prize') || message.includes('win') || message.includes('reward')) {
    return `Prize amounts vary by showcase and are displayed on each event page. Winners are selected based on votes and judge decisions. All prize details, including amounts and distribution terms, are clearly stated before registration. Good luck! 🏆`;
  }

  // Featured/showcase questions
  if (message.includes('featured') || (message.includes('showcase') && !message.includes('talent')) || message.includes('visibility')) {
    return `Get more visibility:\n\n🌟 Featured Listings: Premium/Pro members get priority placement\n📺 Talent Showcase: Live rotating display on homepage for Talent category\n📊 Analytics: Track views and engagement (Premium+)\n\nTo feature your Talent listing: Create profile → Add Talent listing → Go to Featured page to schedule a time slot. Upgrade to Premium or Pro for maximum visibility!`;
  }

  // Payment questions
  if (message.includes('payment') || message.includes('pay') || message.includes('paypal') || message.includes('credit card')) {
    return `We accept:\n\n💳 All major credit and debit cards\n📱 Mobile money payments across Africa\n🌍 PayPal for international payments\n🔒 All transactions are encrypted and secure\n\nRefunds are handled case-by-case within 7 days of payment. Your privacy is respected - we never share your data with third parties!`;
  }

  // Refund questions
  if (message.includes('refund') || message.includes('money back')) {
    return `Refunds are handled on a case-by-case basis. Contact our support team within 7 days of payment if you believe you were charged incorrectly. We'll review your case and respond promptly!`;
  }

  // Privacy/data questions
  if (message.includes('privacy') || message.includes('data') || message.includes('personal information')) {
    return `We respect your privacy! AfriOnet does not sell or share personal data with third parties. All transactions are encrypted and secure. Please read our Privacy Policy for full details: ${FALLBACK_URL}`;
  }

  // Contact/support
  if (message.includes('contact') || message.includes('support') || message.includes('help') || message.includes('email')) {
    return `Need personalized help?\n\n📧 Email: support@afrionet.com\n🌐 Contact page: ${FALLBACK_URL}\n🗣️ Languages: English, French, Swahili (more coming!)\n⏱️ Response time: Within 24 hours\n\nFor FAQ, visit: https://afrionet.com/faq`;
  }

  // Report listing
  if (message.includes('report') || message.includes('fake') || message.includes('suspicious')) {
    return `To report a fake business or suspicious listing:\n\n1. Click "Report Listing" on the business page, OR\n2. Email us directly at support@afrionet.com with the business name and issue\n\nWe take reports seriously and investigate all claims promptly!`;
  }

  // Language support
  if (message.includes('language') || message.includes('multilingual') || message.includes('french') || message.includes('swahili')) {
    return `Yes! AfriOnet provides multilingual support across English, French, and Swahili, with more languages coming soon. Our platform is designed to serve all of Africa!`;
  }

  // Countries/availability
  if (message.includes('country') || message.includes('countries') || message.includes('available') || message.includes('region')) {
    return `AfriOnet is accessible across ALL African countries and internationally! You can list your business, showcase your talent, participate in competitions, connect with others, and collaborate without borders. 🌍`;
  }

  // Default response
  return `I'm here to help with AfriOnet questions!\n\n💡 Popular topics:\n• What is AfriOnet & who can join\n• Pricing plans & free trial\n• Creating listings & uploading media\n• Talent Showcases & competitions\n• Featured placement & visibility\n• Payment methods & refunds\n• Verification & security\n\n❓ Check our FAQ: https://afrionet.com/faq\n👇 Still need help? Click "Contact us" below or email support@afrionet.com`;
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
