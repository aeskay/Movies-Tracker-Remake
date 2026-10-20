const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineString } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

// TMDB API key — set this by adding TMDB_API_KEY to .env in the functions folder
// or via: firebase functions:secrets:set TMDB_API_KEY (interactive prompt)
const TMDB_API_KEY_PARAM = defineString("TMDB_API_KEY", { default: "" });


// ─── Notification Type → Title Mapping ───────────────────────────────────────
const NOTIF_TITLES = {
  friend_request:     "👋 New Friend Request",
  friend_accepted:    "✅ Friend Request Accepted",
  friend_watching:    "🍿 Friend is Watching",
  friend_recommended: "⭐ Movie Recommended",
  new_story:          "📸 New Story from a Friend",
  new_release:        "🎬 New Release Available",
  general:            "🎬 Share Movies"
};

// ─── sendPushNotification ─────────────────────────────────────────────────────
// Triggered whenever a new notification document is created in:
//   users/{userId}/notifications/{notificationId}
// Reads the target user's FCM token from their profile, then sends the push.
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

    const db = getFirestore();
    const userProfileRef = db.doc(`users/${userId}/profile/data`);
    const docSnap = await userProfileRef.get();

    if (!docSnap.exists) {
      console.log("No profile found for user:", userId);
      return null;
    }

    const userData = docSnap.data();

    // ── Check notification preferences ────────────────────────────────────────
    // If the user has disabled this notification type, skip the push.
    const prefs = userData.notificationPrefs || {};
    const typeToPrefsKey = {
      friend_request:     "notify_friend_requests",
      friend_accepted:    "notify_friend_requests",
      friend_watching:    "notify_watching",
      friend_recommended: "notify_recommended",
      new_story:          "notify_new_story",
      new_release:        "notify_release_watching",
    };
    const prefKey = typeToPrefsKey[notificationData.type];
    if (prefKey && prefs[prefKey] === false) {
      console.log(`User ${userId} has disabled ${prefKey} notifications. Skipping push.`);
      return null;
    }

    const fcmToken = userData.fcmToken;
    if (!fcmToken) {
      console.log("User has no FCM token registered:", userId);
      return null;
    }

    // ── Build the FCM message ─────────────────────────────────────────────────
    const notifType = notificationData.type || "general";
    const title = NOTIF_TITLES[notifType] || NOTIF_TITLES.general;
    const body = notificationData.text || "You have a new notification!";

    const message = {
      token: fcmToken,
      notification: { title, body },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "movies_tracker_default",
          icon: "ic_notification",
          color: "#6366f1",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
            "mutable-content": 1,
          },
        },
      },
      // data payload so the client app can navigate on tap
      data: {
        type: notifType,
        senderId: notificationData.senderId || "",
        text: body,
      },
    };

    try {
      const messaging = getMessaging();
      const response = await messaging.send(message);
      console.log("Push sent successfully:", response);
      return response;
    } catch (error) {
      console.error("Error sending push:", error);
      // Clean up stale/invalid tokens so future sends don't waste a round-trip
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

// ─── checkNewReleases (Daily Scheduler) ──────────────────────────────────────
// Runs every day at 10:00 AM UTC.
// Checks all users' "watching" and "favorite" TV shows against TMDB for new
// seasons/episodes, then sends a notification if a new release is found.
exports.checkNewReleases = onSchedule(
  {
    schedule: "0 10 * * *", // every day at 10:00 AM UTC
    timeZone: "UTC",
  },
  async () => {
    const db = getFirestore();
    const messaging = getMessaging();
    const TMDB_API_KEY = TMDB_API_KEY_PARAM.value();

    if (!TMDB_API_KEY) {
      console.error("TMDB_API_KEY not set in Firebase Functions config.");
      return;
    }

    // Fetch all users
    const usersSnap = await db.collection("users").listDocuments();

    for (const userRef of usersSnap) {
      try {
        const profileSnap = await db.doc(`${userRef.path}/profile/data`).get();
        if (!profileSnap.exists) continue;

        const profile = profileSnap.data();
        const prefs = profile.notificationPrefs || {};
        const fcmToken = profile.fcmToken;

        if (!fcmToken) continue;

        // Fetch user's vault
        const moviesSnap = await db.collection(`${userRef.path}/movies`).get();
        const tvShows = moviesSnap.docs
          .map((d) => d.data())
          .filter((m) => m.media_type === "tv" && m.tmdb_id &&
            (m.status === "watching" || m.status === "favorite")
          );

        for (const show of tvShows) {
          // Check if user wants these notification types
          const isWatching = show.status === "watching";
          const prefKey = isWatching ? "notify_release_watching" : "notify_release_favorites";
          if (prefs[prefKey] === false) continue;

          // Query TMDB for latest season info
          const res = await fetch(
            `https://api.themoviedb.org/3/tv/${show.tmdb_id}?api_key=${TMDB_API_KEY}`
          );
          if (!res.ok) continue;
          const tmdbData = await res.json();

          const latestSeason = tmdbData.seasons?.slice(-1)[0];
          if (!latestSeason) continue;

          // Check if air_date is within the past 48 hours
          const airDate = latestSeason.air_date ? new Date(latestSeason.air_date) : null;
          if (!airDate) continue;
          const hoursAgo = (Date.now() - airDate.getTime()) / (1000 * 60 * 60);
          if (hoursAgo > 48) continue; // Not a new release in the last 48h

          const seasonNum = latestSeason.season_number;
          const notifText = `${show.title} — Season ${seasonNum} is now available!`;

          // Write notification doc (this also triggers sendPushNotification)
          const notifId = `release_${show.tmdb_id}_s${seasonNum}`;
          
          const existingDoc = await db.doc(`${userRef.path}/notifications/${notifId}`).get();
          if (existingDoc.exists) continue;

          await db.doc(`${userRef.path}/notifications/${notifId}`).set({
            type: "new_release",
            text: notifText,
            time: new Date().toISOString(),
            read: false,
            tmdb_id: show.tmdb_id,
            seasonNumber: seasonNum,
            title: show.title,
          });

          console.log(`Release notification sent to ${userRef.id} for ${show.title} S${seasonNum}`);

          // Small delay between users to avoid TMDB rate limits
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (err) {
        console.error(`Error processing user ${userRef.id}:`, err);
      }
    }

    console.log("checkNewReleases completed.");
  }
);
