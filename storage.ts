// storage.ts
// Simple memory-backed store so Expo Go works without native modules.

export type Night = {
  date: string;          // YYYY-MM-DD
  sleep_start: string;   // ISO 8601
  sleep_end: string;     // ISO 8601
  id?: string;
  source?: "csv" | "seed" | "manual_late" | "manual_on_time";
};

export type DerivedNight = Night & {
  duration_min: number;
  midsleep_min_epoch: number; // minutes since epoch
};

// In-memory state
let _mem: Night[] = [];

// Read all raw nights
export async function readRaw(): Promise<Night[]> {
  return _mem;
}

// Overwrite all nights
export async function writeRaw(nights: Night[]): Promise<void> {
  _mem = [...nights];
}

// Clear everything
export async function clearAll(): Promise<void> {
  _mem = [];
}

// For the status label in the UI
export function storageKind(): string {
  return "memory";
}
