#!/usr/bin/env node
/**
 * AfriConnect Agent System - Quick Setup Script
 * Run with: node setup-agent.js
 */

const readline = require("readline");
const https = require("https");
const http = require("http");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

console.log("\n🚀 AfriConnect Agent System Setup");
console.log("==================================\n");

const questions = {
  apiUrl: "Enter your API URL (default: http://localhost:4000): ",
  adminToken: "Enter your admin token: ",
  userId: "Enter the user ID to make an agent: ",
  role: "Agent role (support/sales/technical) [support]: ",
  department: "Department (customer_support/sales/technical) [customer_support]: ",
  maxChats: "Max concurrent chats [5]: ",
};

const answers = {};

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function makeRequest(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname,
      method: method,
      headers: headers,
    };

    const req = protocol.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function main() {
  try {
    // Get inputs
    console.log("This script will help you:");
    console.log("1. Create your first agent account");
    console.log("2. Test the agent system\n");

    answers.apiUrl = (await ask(questions.apiUrl)) || "http://localhost:4000";
    console.log("\n📝 Step 1: Get Admin Token");
    console.log("Please sign in as admin and copy your token");
    answers.adminToken = await ask(questions.adminToken);

    console.log("\n📝 Step 2: Get User ID for Agent");
    console.log("We need an existing user ID to convert into an agent");
    answers.userId = await ask(questions.userId);

    console.log("\n📝 Step 3: Agent Configuration");
    answers.role = (await ask(questions.role)) || "support";
    answers.department = (await ask(questions.department)) || "customer_support";
    answers.maxChats = (await ask(questions.maxChats)) || "5";

    console.log("\n🔨 Creating agent...\n");

    // Make API request
    const response = await makeRequest(
      `${answers.apiUrl}/api/agents/admin/create`,
      "POST",
      {
        Authorization: `Bearer ${answers.adminToken}`,
        "Content-Type": "application/json",
      },
      {
        userId: answers.userId,
        role: answers.role,
        department: answers.department,
        languages: ["English"],
        maxChats: parseInt(answers.maxChats),
      }
    );

    if (response.success) {
      console.log("✅ Agent created successfully!\n");
      console.log("Agent Details:");
      console.log(JSON.stringify(response.data, null, 2));

      console.log("\n🎉 Setup Complete!\n");
      console.log("Next steps:");
      console.log("1. Sign in with the agent user credentials");
      console.log("2. Set agent status to online:");
      console.log(`   PATCH ${answers.apiUrl}/api/agents/status`);
      console.log('   Body: { "status": "online" }\n');
      console.log("3. Test support request (as a different user):");
      console.log(`   POST ${answers.apiUrl}/api/agents/request`);
      console.log('   Body: { "requestType": "support", "userMessage": "I need help" }\n');
      console.log("4. View agent dashboard:");
      console.log(`   GET ${answers.apiUrl}/api/agents/dashboard\n`);
      console.log("📖 For detailed documentation, see AGENT_SYSTEM_GUIDE.md");
    } else {
      console.log("❌ Failed to create agent");
      console.log("Response:", JSON.stringify(response, null, 2));
      console.log("\nCommon issues:");
      console.log("- Invalid admin token");
      console.log("- User ID doesn't exist");
      console.log("- User is already an agent");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.log("\nCommon issues:");
    console.log("- API server not running");
    console.log("- Invalid admin token");
    console.log("- Network connection issues");
  } finally {
    rl.close();
  }
}

main();
