const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

exports.sendPushNotification = onDocumentCreated(
  "users/{userId}/notifications/{notificationId}",
  async (event) => {
    const snap = event.data;
    if (!snap) {
      console.log("No data associated with the event");
      return null;
    }

    const notificationData = snap.data();
    const userId = event.params.userId;

    console.log(`New notification for user ${userId}:`, JSON.stringify(notificationData));

    // Get the target user's FCM token from their profile
    const db = getFirestore();
    const userProfileRef = db.doc(`users/${userId}/profile/data`);
    const docSnap = await userProfileRef.get();

    if (!docSnap.exists) {
      console.log("No profile found for user:", userId);
      return null;
    }

    const userData = docSnap.data();
    const fcmToken = userData.fcmToken;

    if (!fcmToken) {
      console.log("User has no FCM token registered:", userId);
      return null;
    }

    // Build the FCM message
    const message = {
      token: fcmToken,
      notification: {
        title: "Share Movies",
        body: notificationData.text || "You have a new notification!",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
      data: {
        type: notificationData.type || "general",
        senderId: notificationData.senderId || "",
      },
    };

    try {
      const messaging = getMessaging();
      const response = await messaging.send(message);
      console.log("Push sent successfully:", response);
      return response;
    } catch (error) {
      console.error("Error sending push:", error);
      // Clean up stale/invalid tokens
      if (
        error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered"
      ) {
        console.log("Removing stale FCM token for user:", userId);
        await userProfileRef.update({ fcmToken: FieldValue.delete() });
      }
      return null;
    }
  }
);
