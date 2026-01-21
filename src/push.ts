/**
 * Web Push Notifications
 *
 * Sends push notifications when agents complete or error.
 */

import webpush from "web-push";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const VAPID_PATH = join(homedir(), ".claude-code-hub-vapid.json");

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

let vapidKeys: VapidKeys;
const subscriptions: Set<string> = new Set(); // Store as JSON strings for dedup

function loadOrGenerateVapidKeys(): VapidKeys {
  if (existsSync(VAPID_PATH)) {
    return JSON.parse(readFileSync(VAPID_PATH, "utf-8"));
  }

  const keys = webpush.generateVAPIDKeys();
  const vapid: VapidKeys = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };

  writeFileSync(VAPID_PATH, JSON.stringify(vapid, null, 2));
  console.log(`Generated VAPID keys at ${VAPID_PATH}`);
  return vapid;
}

export function initPush() {
  vapidKeys = loadOrGenerateVapidKeys();
  webpush.setVapidDetails(
    "mailto:hub@localhost",
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
}

export function getPublicKey(): string {
  return vapidKeys.publicKey;
}

export function addSubscription(subscription: PushSubscription) {
  subscriptions.add(JSON.stringify(subscription));
}

export function removeSubscription(subscription: PushSubscription) {
  subscriptions.delete(JSON.stringify(subscription));
}

export async function sendNotification(title: string, body: string, tag?: string) {
  const payload = JSON.stringify({ title, body, tag });

  const failed: string[] = [];

  for (const subJson of subscriptions) {
    try {
      const subscription = JSON.parse(subJson) as PushSubscription;
      await webpush.sendNotification(subscription, payload);
    } catch (err: unknown) {
      // Remove invalid subscriptions (410 Gone, 404 Not Found)
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        failed.push(subJson);
      }
    }
  }

  // Clean up failed subscriptions
  for (const sub of failed) {
    subscriptions.delete(sub);
  }
}
