#!/bin/bash

# AfriConnect Agent System - Quick Setup Script
# This script helps you set up your first agent for testing

echo "🚀 AfriConnect Agent System Setup"
echo "=================================="
echo ""

# Check if running from correct directory
if [ ! -f "app.js" ]; then
    echo "❌ Error: Please run this script from the afri_connect_api directory"
    exit 1
fi

echo "This script will help you:"
echo "1. Create your first agent account"
echo "2. Test the agent system"
echo ""

# Get API URL
read -p "Enter your API URL (default: http://localhost:3000): " API_URL
API_URL=${API_URL:-http://localhost:3000}

echo ""
echo "📝 Step 1: Get Admin Token"
echo "Please sign in as admin and copy your token"
read -p "Enter your admin token: " ADMIN_TOKEN

echo ""
echo "📝 Step 2: Get User ID for Agent"
echo "We need an existing user ID to convert into an agent"
read -p "Enter the user ID to make an agent: " USER_ID

echo ""
echo "📝 Step 3: Agent Configuration"
read -p "Agent role (support/sales/technical) [support]: " AGENT_ROLE
AGENT_ROLE=${AGENT_ROLE:-support}

read -p "Department (customer_support/sales/technical) [customer_support]: " DEPARTMENT
DEPARTMENT=${DEPARTMENT:-customer_support}

read -p "Max concurrent chats [5]: " MAX_CHATS
MAX_CHATS=${MAX_CHATS:-5}

echo ""
echo "🔨 Creating agent..."

# Create agent
RESPONSE=$(curl -s -X POST "$API_URL/api/agents/admin/create" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"userId\": \"$USER_ID\",
    \"role\": \"$AGENT_ROLE\",
    \"department\": \"$DEPARTMENT\",
    \"languages\": [\"English\"],
    \"maxChats\": $MAX_CHATS
  }")

# Check if successful
if echo "$RESPONSE" | grep -q "\"success\":true"; then
    echo "✅ Agent created successfully!"
    echo ""
    echo "Agent Details:"
    echo "$RESPONSE" | jq '.data' 2>/dev/null || echo "$RESPONSE"

    # Extract agent ID
    AGENT_ID=$(echo "$RESPONSE" | jq -r '.data._id' 2>/dev/null)

    echo ""
    echo "🎉 Setup Complete!"
    echo ""
    echo "Next steps:"
    echo "1. Sign in with the agent user credentials"
    echo "2. Set agent status to online:"
    echo "   PATCH $API_URL/api/agents/status"
    echo "   Body: { \"status\": \"online\" }"
    echo ""
    echo "3. Test support request (as a different user):"
    echo "   POST $API_URL/api/agents/request"
    echo "   Body: { \"requestType\": \"support\", \"userMessage\": \"I need help\" }"
    echo ""
    echo "4. View agent dashboard:"
    echo "   GET $API_URL/api/agents/dashboard"
    echo ""
    echo "📖 For detailed documentation, see AGENT_SYSTEM_GUIDE.md"
else
    echo "❌ Failed to create agent"
    echo "Response: $RESPONSE"
    echo ""
    echo "Common issues:"
    echo "- Invalid admin token"
    echo "- User ID doesn't exist"
    echo "- User is already an agent"
fi
