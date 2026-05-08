const FORUM_CATEGORIES = [
  {
    id: "general",
    name: "General Discussion",
    icon: "💬",
    description: "General topics and casual discussions",
  },
  {
    id: "business",
    name: "Business",
    icon: "💼",
    description: "Business strategies, growth, and opportunities",
  },
  {
    id: "technology",
    name: "Technology & IT",
    icon: "💻",
    description: "Tech trends, software, and innovations",
  },
  {
    id: "marketing",
    name: "Marketing",
    icon: "📈",
    description: "Marketing strategies and digital marketing",
  },
  {
    id: "networking",
    name: "Networking",
    icon: "🤝",
    description: "Professional networking and partnerships",
  },
  {
    id: "advice",
    name: "Advice & Tips",
    icon: "💡",
    description: "Seek and share advice with the community",
  },
  {
    id: "showcase",
    name: "Showcase",
    icon: "⭐",
    description: "Showcase your products, services, and achievements",
  },
  {
    id: "talent",
    name: "Talent",
    icon: "🎤",
    description: "Creative and professional talent highlights",
  },
  {
    id: "feedback",
    name: "Feedback",
    icon: "📝",
    description: "Share feedback and suggestions",
  },
  {
    id: "support",
    name: "Support",
    icon: "🆘",
    description: "Get help and technical support",
  },
  {
    id: "announcements",
    name: "Announcements",
    icon: "📣",
    description: "Important announcements and updates",
  },
];

const FORUM_CATEGORY_IDS = FORUM_CATEGORIES.map((category) => category.id);

module.exports = {
  FORUM_CATEGORIES,
  FORUM_CATEGORY_IDS,
};
