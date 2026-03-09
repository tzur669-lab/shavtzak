// firebase.js - אתחול Firebase וכל פעולות CRUD

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue,
  off,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8MdAbGpDqkgpP1srh8Ep9Fc6LLDmjoP4",
  authDomain: "shavtzak-1f4f2.firebaseapp.com",
  databaseURL: "https://shavtzak-1f4f2-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "shavtzak-1f4f2",
  storageBucket: "shavtzak-1f4f2.firebasestorage.app",
  messagingSenderId: "336783245880",
  appId: "1:336783245880:web:8c1f68924bf172a10b9ccd",
  measurementId: "G-K0V0TP6LD1"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ─────────────────────────────────────────────
// כלים פנימיים
// ─────────────────────────────────────────────

function snapshotToArray(snapshot) {
  if (!snapshot.exists()) return [];
  const val = snapshot.val();
  if (typeof val !== 'object' || val === null) return [];
  return Object.entries(val).map(([id, data]) => ({ id, ...data }));
}

// ─────────────────────────────────────────────
// הגדרות (settings)
// ─────────────────────────────────────────────

export async function getSettings() {
  const snap = await get(ref(db, 'settings'));
  return snap.exists() ? snap.val() : { min_rest_minutes: 240 };
}

export async function saveSettings(settings) {
  await update(ref(db, 'settings'), settings);
}

// ─────────────────────────────────────────────
// קבוצות (groups)
// ─────────────────────────────────────────────

export async function getGroups() {
  const snap = await get(ref(db, 'groups'));
  return snapshotToArray(snap);
}

export async function addGroup(data) {
  return await push(ref(db, 'groups'), data);
}

export async function updateGroup(id, data) {
  await update(ref(db, `groups/${id}`), data);
}

export async function deleteGroup(id) {
  await remove(ref(db, `groups/${id}`));
}

// ─────────────────────────────────────────────
// תפקידים / פק"לים (roles)
// ─────────────────────────────────────────────

export async function getRoles() {
  const snap = await get(ref(db, 'roles'));
  return snapshotToArray(snap);
}

export async function addRole(data) {
  return await push(ref(db, 'roles'), data);
}

export async function updateRole(id, data) {
  await update(ref(db, `roles/${id}`), data);
}

export async function deleteRole(id) {
  await remove(ref(db, `roles/${id}`));
}

// ─────────────────────────────────────────────
// חיילים (soldiers)
// ─────────────────────────────────────────────

export async function getSoldiers() {
  const snap = await get(ref(db, 'soldiers'));
  return snapshotToArray(snap);
}

export async function getSoldier(id) {
  const snap = await get(ref(db, `soldiers/${id}`));
  return snap.exists() ? { id, ...snap.val() } : null;
}

export async function addSoldier(data) {
  return await push(ref(db, 'soldiers'), data);
}

export async function updateSoldier(id, data) {
  await update(ref(db, `soldiers/${id}`), data);
}

export async function deleteSoldier(id) {
  await remove(ref(db, `soldiers/${id}`));
}

export async function setSoldierActive(id, isActive, returnTime = null) {
  await update(ref(db, `soldiers/${id}`), {
    is_active: isActive,
    return_to_service_time: returnTime
  });
}

export async function bulkAddSoldiers(soldiersArray) {
  const existing = await getSoldiers();
  const bySerial = {};
  existing.forEach(s => { bySerial[s.serial_number] = s; });

  let added = 0, updated = 0;
  const errors = [];

  for (const soldier of soldiersArray) {
    try {
      if (bySerial[soldier.serial_number]) {
        await updateSoldier(bySerial[soldier.serial_number].id, soldier);
        updated++;
      } else {
        await addSoldier({ ...soldier, is_active: true, return_to_service_time: null, roles: [] });
        added++;
      }
    } catch (err) {
      errors.push({ soldier, error: err.message });
    }
  }

  return { added, updated, errors };
}

// ─────────────────────────────────────────────
// עמדות (posts)
// ─────────────────────────────────────────────

export async function getPosts() {
  const snap = await get(ref(db, 'posts'));
  return snapshotToArray(snap);
}

export async function getPost(id) {
  const snap = await get(ref(db, `posts/${id}`));
  return snap.exists() ? { id, ...snap.val() } : null;
}

export async function addPost(data) {
  return await push(ref(db, 'posts'), data);
}

export async function updatePost(id, data) {
  await update(ref(db, `posts/${id}`), data);
}

export async function deletePost(id) {
  await remove(ref(db, `posts/${id}`));
}

export async function addRequirement(postId, reqData) {
  return await push(ref(db, `posts/${postId}/requirements`), reqData);
}

export async function updateRequirement(postId, reqId, data) {
  await update(ref(db, `posts/${postId}/requirements/${reqId}`), data);
}

export async function deleteRequirement(postId, reqId) {
  await remove(ref(db, `posts/${postId}/requirements/${reqId}`));
}

// ─────────────────────────────────────────────
// משמרות (shifts)
// ─────────────────────────────────────────────

export async function getShifts() {
  const snap = await get(ref(db, 'shifts'));
  return snapshotToArray(snap);
}

export async function getShiftsInRange(startISO, endISO) {
  const all = await getShifts();
  return all.filter(s => s.start_time >= startISO && s.start_time < endISO);
}

export async function addShift(data) {
  return await push(ref(db, 'shifts'), data);
}

export async function updateShift(id, data) {
  await update(ref(db, `shifts/${id}`), data);
}

export async function deleteShift(id) {
  await remove(ref(db, `shifts/${id}`));
}

export async function deleteShiftsInRange(startISO, endISO) {
  const shifts = await getShiftsInRange(startISO, endISO);
  await Promise.all(shifts.map(s => deleteShift(s.id)));
  return shifts.length;
}

export async function clearSoldiersInRange(startISO, endISO) {
  const shifts = await getShiftsInRange(startISO, endISO);
  await Promise.all(shifts.map(s =>
    updateShift(s.id, {
      soldier_id: null,
      rest_before_minutes: null,
      is_forced: false,
      updated_at: new Date().toISOString()
    })
  ));
  return shifts.length;
}

export async function saveShiftsBatch(shifts) {
  const updates = {};
  shifts.forEach(shift => {
    const newKey = push(ref(db, 'shifts')).key;
    updates[`shifts/${newKey}`] = { ...shift, updated_at: new Date().toISOString() };
  });
  await update(ref(db, '/'), updates);
}

// ─────────────────────────────────────────────
// האזנה בזמן אמת
// ─────────────────────────────────────────────

export function subscribeToBoard(callback) {
  let shifts = [], soldiers = [], posts = [];
  let loaded = { shifts: false, soldiers: false, posts: false };

  const tryCallback = () => {
    if (loaded.shifts && loaded.soldiers && loaded.posts)
      callback({ shifts, soldiers, posts });
  };

  const shiftsRef   = ref(db, 'shifts');
  const soldiersRef = ref(db, 'soldiers');
  const postsRef    = ref(db, 'posts');

  onValue(shiftsRef,   snap => { shifts   = snapshotToArray(snap); loaded.shifts   = true; tryCallback(); });
  onValue(soldiersRef, snap => { soldiers = snapshotToArray(snap); loaded.soldiers = true; tryCallback(); });
  onValue(postsRef,    snap => { posts    = snapshotToArray(snap); loaded.posts    = true; tryCallback(); });

  return () => { off(shiftsRef); off(soldiersRef); off(postsRef); };
}
