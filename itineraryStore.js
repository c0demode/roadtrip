// itineraryStore.js
//
// Schema (single document per trip, collection "itineraries"):
//
// itineraries/{tripId}
// {
//   title: string,
//   updatedAt: Timestamp,
//   stops: [
//     {
//       id: string,        // short random id, generated client-side
//       name: string,
//       day: number,       // 1-indexed day of the trip
//       position: number,  // order within that day, 0-indexed
//       time: string,      // rough time, e.g. "2:00 PM" or "morning"
//       address: string,
//       lat: number,
//       lng: number,
//       notes: string,
//       website: string,
//       mapsUrl: string
//     },
//     ...
//   ]
// }
//
// A single doc with a "stops" array (rather than a subcollection) is the right call at this
// scale: one real-time listener gets you the whole itinerary, drag-reorder is one write, and
// you're nowhere near Firestore's 1MB document limit with a few dozen stops.

import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase.js";

const TRIP_ID = "main"; // single-trip app for now — swap for a real id if you ever support multiple trips

function tripRef() {
  return doc(db, "itineraries", TRIP_ID);
}

function generateStopId() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Subscribes to real-time itinerary updates. This is what gives you the
 * "everyone's view updates live" behavior.
 * Returns an unsubscribe function — call it on component/page teardown.
 */
export function subscribeToItinerary(onChange) {
  return onSnapshot(tripRef(), (snap) => {
    if (!snap.exists()) {
      onChange({ title: "Our Road Trip", stops: [] });
      return;
    }
    onChange(snap.data());
  });
}

/**
 * Applies a single change to the itinerary. Shape matches the
 * apply_itinerary_change tool schema from the Claude reconciler, so the
 * reconciler's output can be passed straight into this function.
 *
 * change = {
 *   action: "add" | "move" | "remove" | "edit",
 *   stopId, name, day, position, time, address, lat, lng, notes
 * }
 */
export async function applyChange(change) {
  return applyChanges([change]);
}

/**
 * Applies multiple changes atomically — either all land or none do, so a
 * multi-stop confirmation ("let's do the Buc-ee's and skip the aquarium")
 * can't partially apply if something goes wrong mid-write.
 */
export async function applyChanges(changes) {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(tripRef());
    let stops = snap.exists() ? snap.data().stops || [] : [];

    for (const change of changes) {
      stops = applyOneChange(stops, change);
    }

    tx.set(
      tripRef(),
      { stops, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
}

function applyOneChange(stops, change) {
  switch (change.action) {
    case "add": {
      const newStop = {
        id: generateStopId(),
        name: change.name ?? "Untitled stop",
        day: change.day ?? 1,
        position: change.position ?? stops.length,
        time: change.time ?? "",
        address: change.address ?? "",
        lat: change.lat ?? null,
        lng: change.lng ?? null,
        notes: change.notes ?? "",
      };
      return [...stops, newStop];
    }

    case "move": {
      return stops.map((s) =>
        s.id === change.stopId
          ? { ...s, day: change.day ?? s.day, position: change.position ?? s.position }
          : s
      );
    }

    case "remove": {
      return stops.filter((s) => s.id !== change.stopId);
    }

    case "edit": {
      return stops.map((s) =>
        s.id === change.stopId
          ? {
              ...s,
              ...(change.name !== undefined && { name: change.name }),
              ...(change.time !== undefined && { time: change.time }),
              ...(change.address !== undefined && { address: change.address }),
              ...(change.lat !== undefined && { lat: change.lat }),
              ...(change.lng !== undefined && { lng: change.lng }),
              ...(change.notes !== undefined && { notes: change.notes }),
            }
          : s
      );
    }

    default:
      return stops;
  }
}

/** Direct drag-and-drop reorder from the planner UI (bypasses the reconciler entirely). */
export async function reorderStop(stopId, newDay, newPosition) {
  return applyChange({ action: "move", stopId, day: newDay, position: newPosition });
}
