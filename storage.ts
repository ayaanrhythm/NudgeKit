// storage.ts  — minimal in-memory storage that works in Expo Go

// One raw night (as entered or imported)
export type Night = {
  date: string;        // "YYYY-MM-DD"
  sleep_start: string; // ISO string
  sleep_end: string;   // ISO string
};

// Raw + derived features the UI needs
export type DerivedNight = Night & {
  duration_min: number;        // minutes
  midsleep_min_epoch: number;  // minutes since Unix epoch
};

// ----------------------------------------------------------------------------------
// In-memory store (clears on reload). This avoids native modules so Expo Go works.
// ----------------------------------------------------------------------------------
let MEM: Night[] = [];

// Expose mode so the UI can show "Storage: memory"
export function storageMode(): "memory" {
  return "memory";
}

// Helpers
const toMin = (ms: number) => Math.round(ms / 60000);
const isoToMin = (iso: string) => toMin(new Date(iso).getTime());
const dateKey = (d: Date) =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;

// Convert a raw night into derived night
function derive(n: Night): DerivedNight {
  const startMin = isoToMin(n.sleep_start);
  const endMin = isoToMin(n.sleep_end);
  const durationMin = Math.max(1, endMin - startMin);
  const midsleepMin = startMin + Math.round(durationMin / 2);
  return { ...n, duration_min: durationMin, midsleep_min_epoch: midsleepMin };
}

// Public API used by App.tsx --------------------------------------------------------

export async function getDerivedNights(limit = 14): Promise<DerivedNight[]> {
  // newest first by date
  const sorted = [...MEM].sort((a: Night, b: Night) => (a.date < b.date ? 1 : -1));
  return sorted.slice(0, limit).map(derive);
}

export async function upsertNight(n: Night): Promise<void> {
  const i = MEM.findIndex(x => x.date === n.date);
  if (i >= 0) MEM[i] = n;
  else MEM.push(n);
}

export async function clearNights(): Promise<void> {
  MEM = [];
}

// Seed 7 demo nights with a slight late drift in the last few days
export async function seed7FakeNights(): Promise<void> {
  MEM = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const date = dateKey(d);

    // Baseline ~00:45–01:15 start, ~08:10–08:50 end
    let startH = 1, startM = 0, endH = 8, endM = 30;

    // Nudge a later trend on the last 3 nights (+20, +40, +60 minutes)
    const drift = Math.max(0, 3 - i) * 20;
    startM += drift;

    const startISO = new Date(`${date}T${`${startH}`.padStart(2, "0")}:${`${startM}`.padStart(2, "0")}:00`).toISOString();
    const endISO   = new Date(`${date}T${`${endH}`.padStart(2, "0")}:${`${endM}`.padStart(2, "0")}:00`).toISOString();

    MEM.push({ date, sleep_start: startISO, sleep_end: endISO });
  }
}
