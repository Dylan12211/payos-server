const express = require("express");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

const CHECKSUM_KEY = "2231fe03bf9676c6287ded8d16b8f9c678611618c69abd721a956777b23d33cb";

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

    if (!userId) {
      console.error("❌ Missing userId in note");
      return res.status(400).send("Missing userId in note");
    }

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

app.listen(3000, () => console.log("🚀 Server running on http://localhost:3000"));
