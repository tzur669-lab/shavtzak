// firebase.js - אתחול Firebase וכל פעולות CRUD
// גרסה 2.0 — כולל עדכון מרחוק, גיבוי אוטומטי, נעילת משמרת

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getDatabase, ref, get, set, push, update, remove,
  onValue, off, serverTimestamp
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
const db  = getDatabase(app);

// ─────────────────────────────────────────────
// כלים פנימיים
// ─────────────────────────────────────────────

function snapshotToArray(snapshot) {
  if (!snapshot.exists()) return [];
  const val = snapshot.val();
  if (typeof val !== 'object' || val === null) return [];
  return Object.entries(val).map(([id, data]) => ({ id, ...data }));
}

function nowISO() { return new Date().toISOString(); }

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
// עדכון מרחוק
// ─────────────────────────────────────────────

/**
 * בדיקה אם יש גרסה חדשה
 * Firebase node: /appVersion { version: "1.5", apkUrl: "https://..." }
 * @param {string} currentVersion - גרסה נוכחית מהקוד
 * @returns {Promise<{ hasUpdate: boolean, version: string, apkUrl: string } | null>}
 */
export async function checkForUpdate(currentVersion) {
  try {
    const snap = await get(ref(db, 'appVersion'));
    if (!snap.exists()) return null;
    const data = snap.val();
    const hasUpdate = data.version !== currentVersion;
    return { hasUpdate, version: data.version || '', apkUrl: data.apkUrl || '' };
  } catch {
    return null;
  }
}

/**
 * האזנה לשינויי גרסה בזמן אמת
 */
export function subscribeToVersion(callback) {
  const r = ref(db, 'appVersion');
  onValue(r, snap => {
    if (snap.exists()) callback(snap.val());
  });
  return () => off(r);
}

// ─────────────────────────────────────────────
// גיבוי אוטומטי
// ─────────────────────────────────────────────

/**
 * שמירת snapshot של הלוח הנוכחי תחת /backups/TIMESTAMP
 */
export async function saveBackup() {
  try {
    const [shifts, soldiers, posts, settings] = await Promise.all([
      getShifts(), getSoldiers(), getPosts(), getSettings()
    ]);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await set(ref(db, `backups/${ts}`), {
      created_at: nowISO(),
      shifts:     Object.fromEntries(shifts.map(s => [s.id, s])),
      soldiers:   Object.fromEntries(soldiers.map(s => [s.id, s])),
      posts:      Object.fromEntries(posts.map(p => [p.id, p])),
      settings
    });
    return ts;
  } catch (err) {
    console.error('גיבוי נכשל:', err);
    return null;
  }
}

/**
 * שמירת גיבוי אם עברו יותר מ-X שעות מהגיבוי האחרון
 */
export async function autoBackupIfNeeded(intervalHours = 6) {
  try {
    const snap = await get(ref(db, 'backups'));
    if (snap.exists()) {
      const keys = Object.keys(snap.val()).sort();
      const lastKey = keys[keys.length - 1];
      const lastBackup = new Date(lastKey.replace(/-/g, (m, i) => i > 7 ? (i > 10 ? '.' : ':') : '-'));
      const hoursSince = (Date.now() - lastBackup.getTime()) / 3600000;
      if (hoursSince < intervalHours) return false;
    }
    await saveBackup();
    return true;
  } catch {
    return false;
  }
}

/**
 * רשימת גיבויים
 */
export async function getBackups() {
  const snap = await get(ref(db, 'backups'));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.created_at?.localeCompare(a.created_at));
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

/**
 * קבלת מספר חייל הבא (לפי הגדול קיים + 1)
 */
export async function getNextSoldierNumber() {
  const soldiers = await getSoldiers();
  if (soldiers.length === 0) return 1;
  const nums = soldiers
    .map(s => parseInt(s.soldier_number) || 0)
    .filter(n => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : soldiers.length + 1;
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
        const nextNum = await getNextSoldierNumber();
        await addSoldier({
          ...soldier,
          soldier_number: nextNum,
          is_active: true,
          return_to_service_time: null,
          absence_reason: null,
          roles: []
        });
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
      is_locked: false,
      updated_at: nowISO()
    })
  ));
  return shifts.length;
}

export async function saveShiftsBatch(shifts) {
  const updates = {};
  shifts.forEach(shift => {
    const newKey = push(ref(db, 'shifts')).key;
    updates[`shifts/${newKey}`] = { ...shift, updated_at: nowISO() };
  });
  await update(ref(db, '/'), updates);
}

/**
 * נעילת/שחרור משמרת
 */
export async function toggleShiftLock(id, locked) {
  await updateShift(id, { is_locked: locked, updated_at: nowISO() });
}

/**
 * החלפת חיילים בין שתי משמרות
 */
export async function swapShiftSoldiers(idA, idB) {
  const [snapA, snapB] = await Promise.all([
    get(ref(db, `shifts/${idA}`)),
    get(ref(db, `shifts/${idB}`))
  ]);
  if (!snapA.exists() || !snapB.exists()) throw new Error('משמרת לא נמצאה');
  const a = snapA.val();
  const b = snapB.val();

  await Promise.all([
    updateShift(idA, {
      soldier_id: b.soldier_id || null,
      rest_before_minutes: b.rest_before_minutes || null,
      is_forced: b.is_forced || false,
      updated_at: nowISO()
    }),
    updateShift(idB, {
      soldier_id: a.soldier_id || null,
      rest_before_minutes: a.rest_before_minutes || null,
      is_forced: a.is_forced || false,
      updated_at: nowISO()
    })
  ]);
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

// ─────────────────────────────────────────────
// לוג פעולות
// ─────────────────────────────────────────────

export async function logAction(action, details = {}) {
  try {
    await push(ref(db, 'logs'), {
      action,
      details,
      timestamp: nowISO()
    });
  } catch { /* לא קריטי */ }
}
