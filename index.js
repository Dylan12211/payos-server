const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");
const axios = require("axios");
require("dotenv").config();

const app = express();

// Parse JSON và lưu rawBody để verify signature PayOS
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Initialize Firebase Admin
const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// PAYOS CONFIG
const CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY;
const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID;
const PAYOS_API_KEY = process.env.PAYOS_API_KEY;

// ✅ Hàm sort key object
function sortObjByKey(obj) {
  return Object.keys(obj)
    .sort()
    .reduce((result, key) => {
      result[key] = obj[key];
      return result;
    }, {});
}

// ✅ Hàm convert object thành query string
function convertObjToQueryStr(obj) {
  return Object.keys(obj)
    .map(key => {
      let value = obj[key];
      if (value === null || value === undefined || value === "null" || value === "undefined") {
        value = "";
      }
      return `${key}=${value}`;
    })
    .join("&");
}

// ✅ Tạo đơn hàng
app.post("/create-order", async (req, res) => {
  try {
    const { userId, userName, userEmail } = req.body;

    if (!userId || !userName || !userEmail) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const orderCode = `ORDER_${userId}_${Date.now()}`;

    const response = await axios.post(
      "https://api.payos.io/v2/payment-requests",
      {
        orderCode: orderCode,
        amount: 20000, // 20,000 VND
        description: `Nâng cấp Premium cho ${userName}`,
        buyerName: userName,
        buyerEmail: userEmail,
        buyerPhone: "0123456789",
        cancelUrl: "https://google.com",
        returnUrl: "https://google.com"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-client-id": PAYOS_CLIENT_ID,
          "x-api-key": PAYOS_API_KEY,
        },
      }
    );

    const data = response.data;

    if (data.data && data.data.checkoutUrl) {
      console.log("✅ Created payment link:", data.data.checkoutUrl);
      res.json({ paymentUrl: data.data.checkoutUrl });
    } else {
      console.error("❌ Error from PayOS:", data);
      res.status(500).json({ error: "Failed to create payment link" });
    }
  } catch (error) {
    console.error("❌ Create order error:", error.response?.data || error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ✅ Nhận webhook PayOS
app.post("/payos-webhook", async (req, res) => {
  try {
    console.log("🔔 Nhận webhook PayOS");

    const parsedBody = JSON.parse(req.rawBody.toString());
    console.log("Parsed body:", parsedBody);

    const receivedSignature = parsedBody.signature;
    const data = parsedBody.data;

    const sortedData = sortObjByKey(data);
    const dataQueryStr = convertObjToQueryStr(sortedData);

    const calculatedSignature = crypto
      .createHmac("sha256", CHECKSUM_KEY)
      .update(dataQueryStr)
      .digest("hex");

    console.log("Data query string used for signature:", dataQueryStr);
    console.log("Received Signature:", receivedSignature);
    console.log("Calculated Signature:", calculatedSignature);

    if (receivedSignature !== calculatedSignature) {
      console.error("❌ Signature không khớp");
      return res.status(400).send("Signature mismatch");
    }

    console.log("✅ Signature hợp lệ, tiến hành xử lý...");

    const userId = data.note || "unknown_user";
    const amount = data.amount;

    const activatedAt = admin.firestore.Timestamp.now();
    const expiredAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    );

    await db.collection("users").doc(userId).set({
      is_premium: true,
      premium_activated_at: activatedAt,
      premium_expired_at: expiredAt,
      last_payment_amount: amount,
    }, { merge: true });

    console.log(`✅ User ${userId} upgraded to Premium`);
    res.status(200).send("OK");

  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).send("Server error");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
