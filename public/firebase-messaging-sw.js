// Firebase Messaging Service Worker
// Required for web push notifications to work in the background
// This file MUST be at the root of your site (served from /firebase-messaging-sw.js)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDwBYOpY6YUQ25Kl31xn7DoJn7cz3J7cjo",
  authDomain: "movie-tracker-b7be2.firebaseapp.com",
  projectId: "movie-tracker-b7be2",
  storageBucket: "movie-tracker-b7be2.firebasestorage.app",
  messagingSenderId: "107801496324",
  appId: "1:107801496324:web:0e00f5f7929c3a17b2de51"
});

const messaging = firebase.messaging();

// Notification type → title mapping
const NOTIF_TITLES = {
  friend_request: '👋 New Friend Request',
  friend_accepted: '✅ Friend Request Accepted',
  friend_watching: '🍿 Friend is Watching',
  friend_recommended: '⭐ Movie Recommended',
  new_story: '📸 New Story',
  new_release: '🎬 New Release Available',
  general: '🎬 Share Movies'
};

// Handle background messages (when app is closed / in background)
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const notifType = payload.data?.type || 'general';
  const title = NOTIF_TITLES[notifType] || NOTIF_TITLES.general;
  const body = payload.notification?.body || payload.data?.text || 'You have a new notification!';

  const notificationOptions = {
    body,
    icon: '/icon.png',
    badge: '/icon.png',
    tag: notifType, // groups same-type notifications instead of stacking them
    renotify: true,
    data: {
      type: notifType,
      senderId: payload.data?.senderId || '',
      url: '/'
    },
    actions: [
      { action: 'open', title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  self.registration.showNotification(title, notificationOptions);
});

// Handle notification click — navigate to the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If app is already open, focus it
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
