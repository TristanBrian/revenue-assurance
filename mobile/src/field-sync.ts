import * as FileSystem from "expo-file-system/legacy";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { submitFieldVerification } from "./api";

export type VerificationDraft = {
  verification_id: string;
  beneficiary_id: string;
  pillar: "Scholarship" | "Plus" | "Vocational" | "Tech";
  participation_status: "verified" | "not_verified" | "needs_review";
  notes: string;
  latitude: number | null;
  longitude: number | null;
  captured_at: string;
  photo_uri: string | null;
  updated_at: string;
};

const taskName = "RECONOVA_VERIFICATION_SYNC";
const queueFile = `${FileSystem.documentDirectory ?? ""}reconova-verification-queue.json`;

async function readQueue(): Promise<VerificationDraft[]> {
  try {
    const info = await FileSystem.getInfoAsync(queueFile);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(queueFile);
    return JSON.parse(raw) as VerificationDraft[];
  } catch {
    return [];
  }
}

async function writeQueue(items: VerificationDraft[]) {
  await FileSystem.writeAsStringAsync(queueFile, JSON.stringify(items));
}

export async function queuedVerifications() {
  return readQueue();
}

export async function queueVerification(item: VerificationDraft) {
  const current = await readQueue();
  // Last-write-wins by verification ID keeps retries deterministic after conflicts.
  const next = [...current.filter((entry) => entry.verification_id !== item.verification_id), item];
  await writeQueue(next);
  return next;
}

export async function syncVerifications(submit: (item: VerificationDraft) => Promise<void>) {
  const current = await readQueue();
  const remaining: VerificationDraft[] = [];
  for (const item of current) {
    try { await submit(item); } catch { remaining.push(item); }
  }
  await writeQueue(remaining);
  return { sent: current.length - remaining.length, remaining: remaining.length };
}

TaskManager.defineTask(taskName, async () => {
  try {
    const result = await syncVerifications(submitFieldVerification);
    return result.sent > 0 ? BackgroundFetch.BackgroundFetchResult.NewData : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerVerificationSync() {
  const registered = await TaskManager.isTaskRegisteredAsync(taskName);
  if (!registered) {
    await BackgroundFetch.registerTaskAsync(taskName, {
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }
}
