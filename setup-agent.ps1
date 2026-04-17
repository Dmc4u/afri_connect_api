# AfriConnect Agent System - Quick Setup Script (PowerShell)
# Run this with: powershell -ExecutionPolicy Bypass -File setup-agent.ps1

Write-Host "🚀 AfriConnect Agent System Setup" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

# Check if running from correct directory
if (-not (Test-Path "app.js")) {
    Write-Host "❌ Error: Please run this script from the afri_connect_api directory" -ForegroundColor Red
    exit 1
}

Write-Host "This script will help you:" -ForegroundColor Yellow
Write-Host "1. Create your first agent account"
Write-Host "2. Test the agent system"
Write-Host ""

# Get API URL
$API_URL = Read-Host "Enter your API URL (default: http://localhost:4000)"
if ([string]::IsNullOrWhiteSpace($API_URL)) {
    $API_URL = "http://localhost:4000"
}

Write-Host ""
Write-Host "📝 Step 1: Get Admin Token" -ForegroundColor Yellow
Write-Host "Please sign in as admin and copy your token"
$ADMIN_TOKEN = Read-Host "Enter your admin token"

Write-Host ""
Write-Host "📝 Step 2: Get User ID for Agent" -ForegroundColor Yellow
Write-Host "We need an existing user ID to convert into an agent"
$USER_ID = Read-Host "Enter the user ID to make an agent"

Write-Host ""
Write-Host "📝 Step 3: Agent Configuration" -ForegroundColor Yellow
$AGENT_ROLE = Read-Host "Agent role (support/sales/technical) [support]"
if ([string]::IsNullOrWhiteSpace($AGENT_ROLE)) {
    $AGENT_ROLE = "support"
}

$DEPARTMENT = Read-Host "Department (customer_support/sales/technical) [customer_support]"
if ([string]::IsNullOrWhiteSpace($DEPARTMENT)) {
    $DEPARTMENT = "customer_support"
}

$MAX_CHATS = Read-Host "Max concurrent chats [5]"
if ([string]::IsNullOrWhiteSpace($MAX_CHATS)) {
    $MAX_CHATS = 5
}

Write-Host ""
Write-Host "🔨 Creating agent..." -ForegroundColor Yellow

# Create request body
$body = @{
    userId = $USER_ID
    role = $AGENT_ROLE
    department = $DEPARTMENT
    languages = @("English")
    maxChats = [int]$MAX_CHATS
} | ConvertTo-Json

# Make API request
try {
    $response = Invoke-RestMethod -Uri "$API_URL/api/agents/admin/create" `
        -Method Post `
        -Headers @{
            "Authorization" = "Bearer $ADMIN_TOKEN"
            "Content-Type" = "application/json"
        } `
        -Body $body

    if ($response.success) {
        Write-Host "✅ Agent created successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Agent Details:" -ForegroundColor Cyan
        Write-Host ($response.data | ConvertTo-Json -Depth 3)

        Write-Host ""
        Write-Host "🎉 Setup Complete!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Yellow
        Write-Host "1. Sign in with the agent user credentials"
        Write-Host "2. Set agent status to online:"
        Write-Host "   PATCH $API_URL/api/agents/status" -ForegroundColor Gray
        Write-Host "   Body: { `"status`": `"online`" }" -ForegroundColor Gray
        Write-Host ""
        Write-Host "3. Test support request (as a different user):" -ForegroundColor Yellow
        Write-Host "   POST $API_URL/api/agents/request" -ForegroundColor Gray
        Write-Host "   Body: { `"requestType`": `"support`", `"userMessage`": `"I need help`" }" -ForegroundColor Gray
        Write-Host ""
        Write-Host "4. View agent dashboard:" -ForegroundColor Yellow
        Write-Host "   GET $API_URL/api/agents/dashboard" -ForegroundColor Gray
        Write-Host ""
        Write-Host "📖 For detailed documentation, see AGENT_SYSTEM_GUIDE.md" -ForegroundColor Cyan
    }
    else {
        Write-Host "❌ Failed to create agent" -ForegroundColor Red
        Write-Host "Response: $($response | ConvertTo-Json)" -ForegroundColor Red
    }
}
catch {
    Write-Host "❌ Failed to create agent" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common issues:" -ForegroundColor Yellow
    Write-Host "- Invalid admin token"
    Write-Host "- User ID doesn't exist"
    Write-Host "- User is already an agent"
    Write-Host "- API server not running"
}
