const cfg = require("./config");

const baseUrl =
  cfg.PAYPAL_MODE === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

// Get OAuth2 Access Token
async function getAccessToken() {
  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(`${cfg.PAYPAL_CLIENT_ID}:${cfg.PAYPAL_CLIENT_SECRET}`).toString("base64"),
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("❌ PayPal Token Error:", data);
    throw new Error(data.error_description || "Failed to get PayPal token");
  }
  return data.access_token;
}

// Create PayPal Order
async function createOrder(amount, seatType, currency = "USD", userId = null, context = {}) {
  console.log(
    `🔵 Creating PayPal order: Amount=$${amount}, Type=${seatType}, Currency=${currency}`
  );

  const accessToken = await getAccessToken();

  const shouldStoreInVault = Boolean(
    context?.storeInVaultOnSuccess || context?.savePaymentMethod || context?.vault?.storeInVault
  );

  const body = {
    intent: "CAPTURE",
    purchase_units: [
      {
        description: `AfriOnet ${seatType}`,
        amount: {
          currency_code: currency,
          value: amount.toFixed(2),
        },
        // custom metadata → useful for DB reconciliation
        custom_id: JSON.stringify({ seatType, userId }),
      },
    ],
    application_context: {
      brand_name: "AfriOnet",
      user_action: "PAY_NOW",
      return_url: context.returnUrl || "http://localhost:3001/featured?paypal=approved",
      cancel_url: context.cancelUrl || "http://localhost:3001/featured?paypal=cancel",
    },
  };

  // If requested, ask PayPal to store the payment method in its vault on success.
  // We never store card details on our servers—only PayPal's vault token/id.
  if (shouldStoreInVault) {
    body.payment_source = {
      paypal: {
        attributes: {
          vault: {
            store_in_vault: "ON_SUCCESS",
          },
        },
      },
    };
  }

  const postOrder = async (payload) => {
    console.log("🔵 PayPal order body:", JSON.stringify(payload, null, 2));
    const response = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log("🔵 PayPal response status:", response.status);
    console.log("🔵 PayPal response data:", JSON.stringify(data, null, 2));
    return { response, data };
  };

  let { response, data } = await postOrder(body);

  // If vaulting isn't supported/allowed, fall back to normal checkout
  if (!response.ok && shouldStoreInVault) {
    console.warn(
      "⚠️ PayPal vaulting order creation failed; retrying without vaulting. Error:",
      data?.details?.[0]?.issue || data?.message || response.status
    );

    const bodyWithoutVault = { ...body };
    delete bodyWithoutVault.payment_source;
    ({ response, data } = await postOrder(bodyWithoutVault));
    if (response.ok && data && typeof data === "object") {
      data._vaultingFallback = true;
    }
  }

  if (!response.ok) {
    console.error("❌ PayPal Create Order Error:", data);
    throw new Error(data.details?.[0]?.issue || data.message || "Failed to create order");
  }

  return data; // contains { id, status, links }
}

// Capture PayPal Order
async function captureOrder(orderId) {
  console.log(`🔵 Attempting to capture PayPal order: ${orderId}`);
  const accessToken = await getAccessToken();

  const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();
  console.log(`📊 PayPal capture response status: ${response.status}`);
  console.log(`📊 PayPal capture response data:`, JSON.stringify(data, null, 2));

  if (!response.ok) {
    console.error("❌ PayPal Capture Error:", data);
    console.error(`❌ Error details:`, data.details);
    const errorMessage =
      data.details?.[0]?.issue ||
      data.details?.[0]?.description ||
      data.message ||
      "Failed to capture order";
    throw new Error(errorMessage);
  }

  console.log(`✅ PayPal order captured successfully. Status: ${data.status}`);
  return data; // contains capture details
}

// Retrieve PayPal Order details (for integrity checks before capture)
async function getOrder(orderId) {
  const accessToken = await getAccessToken();
  const response = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("❌ PayPal Get Order Error:", data);
    throw new Error(data.details?.[0]?.issue || data.message || "Failed to get order");
  }
  return data;
}

module.exports = { createOrder, captureOrder, getOrder };
