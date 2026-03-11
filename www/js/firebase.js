// firebase.js - גרסה 3.0

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getDatabase, ref, get, set, push, update, remove,
  onValue, off
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyB8MdAbGpDqkgpP1srh8Ep9Fc6LLDmjoP4",
  authDomain: "shavtzak-1f4f2.firebaseapp.com",
  databaseURL: "https://shavtzak-1f4f2-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "shavtzak-1f4f2",
  storageBucket: "shavtzak-1f4f2.firebasestorage.app",
  messagingSenderId: "336783245880",
  appId: "1:336783245880:web:8c1f68924bf172a10b9ccd"
};

const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

function snapshotToArray(snap) {
  if (!snap.exists()) return [];
  const val = snap.val();
  if (typeof val !== 'object' || val === null) return [];
  return Object.entries(val).map(([id, data]) => ({ id, ...data }));
}

function nowISO() { return new Date().toISOString(); }

// ─────────────────────────────────────────────
// הגדרות
// ─────────────────────────────────────────────

export async function getSettings() {
  const snap = await get(ref(db, 'settings'));
  return snap.exists() ? snap.val() : { min_rest_minutes: 240 };
}

export async function saveSettings(data) {
  await update(ref(db, 'settings'), data);
}

// ─────────────────────────────────────────────
// עדכון מרחוק
// ─────────────────────────────────────────────

export async function checkForUpdate(currentVersion) {
  try {
    const snap = await get(ref(db, 'appVersion'));
    if (!snap.exists()) return null;
    const data = snap.val();
    return {
      hasUpdate: data.version !== currentVersion,
      version:   data.version || '',
      apkUrl:    data.apkUrl  || ''
    };
  } catch { return null; }
}

export function subscribeToVersion(callback) {
  const r = ref(db, 'appVersion');
  onValue(r, snap => { if (snap.exists()) callback(snap.val()); });
  return () => off(r);
}

// ─────────────────────────────────────────────
// גיבוי
// ─────────────────────────────────────────────

export async function saveBackup() {
  try {
    const [shifts, soldiers, posts, settings] = await Promise.all([
      getShifts(), getSoldiers(), getPosts(), getSettings()
    ]);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await set(ref(db, `backups/${ts}`), {
      created_at: nowISO(),
      shifts:   Object.fromEntries(shifts.map(s => [s.id, s])),
      soldiers: Object.fromEntries(soldiers.map(s => [s.id, s])),
      posts:    Object.fromEntries(posts.map(p => [p.id, p])),
      settings
    });
    return ts;
  } catch (err) {
    console.error('גיבוי נכשל:', err);
    return null;
  }
}

export async function getBackups() {
  const snap = await get(ref(db, 'backups'));
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

export async function autoBackupIfNeeded(intervalHours = 6) {
  try {
    const backups = await getBackups();
    if (backups.length > 0) {
      const last = new Date(backups[0].created_at);
      const hoursSince = (Date.now() - last.getTime()) / 3600000;
      if (hoursSince < intervalHours) return false;
    }
    await saveBackup();
    return true;
  } catch { return false; }
}

// ─────────────────────────────────────────────
// מחלקות
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
// תפקידים / פק"לים
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
// חיילים
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
 * מספר חייל הבא — מקסימום קיים + 1
 */
export async function getNextSoldierNumber() {
  const soldiers = await getSoldiers();
  if (soldiers.length === 0) return 1;
  const nums = soldiers
    .map(s => parseInt(s.soldier_number))
    .filter(n => !isNaN(n));
  return nums.length > 0 ? Math.max(...nums) + 1 : soldiers.length + 1;
}

export async function bulkAddSoldiers(soldiersArray) {
  // קבל את המספר הבא לפני הלולאה
  let nextNum = await getNextSoldierNumber();
  const existing = await getSoldiers();
  const byId = {};
  existing.forEach(s => { byId[s.soldier_id_custom || s.id] = s; });

  let added = 0, updated = 0;
  const errors = [];

  for (const soldier of soldiersArray) {
    try {
      // מספר חייל אוטומטי
      const soldierData = {
        ...soldier,
        soldier_number:        nextNum,
        is_active:             true,
        return_to_service_time: null,
        absence_reason:        null,
        roles:                 [],
        min_rest_minutes:      null
      };
      await addSoldier(soldierData);
      nextNum++;
      added++;
    } catch (err) {
      errors.push({ soldier, error: err.message });
    }
  }

  return { added, updated, errors };
}

// ─────────────────────────────────────────────
// עמדות
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

/**
 * מחיקת עמדה — מרוקנת חיילים מכל משמרות העמדה ואז מוחקת
 */
export async function deletePost(id) {
  // מצא את כל המשמרות של העמדה
  const allShifts = await getShifts();
  const postShifts = allShifts.filter(s => s.post_id === id && s.soldier_id);

  // רוקן חיילים
  if (postShifts.length > 0) {
    const updates = {};
    postShifts.forEach(s => {
      updates[`shifts/${s.id}/soldier_id`]          = null;
      updates[`shifts/${s.id}/rest_before_minutes`]  = null;
      updates[`shifts/${s.id}/is_forced`]            = false;
      updates[`shifts/${s.id}/updated_at`]           = nowISO();
    });
    await update(ref(db, '/'), updates);
  }

  // מחק העמדה עצמה
  await remove(ref(db, `posts/${id}`));
  return postShifts.length; // מחזיר כמה משמרות רוקנו
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
// משמרות
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
  const toUpdate = shifts.filter(s => !s.is_locked);
  if (toUpdate.length === 0) return 0;
  const updates = {};
  toUpdate.forEach(s => {
    updates[`shifts/${s.id}/soldier_id`]          = null;
    updates[`shifts/${s.id}/rest_before_minutes`]  = null;
    updates[`shifts/${s.id}/is_forced`]            = false;
    updates[`shifts/${s.id}/updated_at`]           = nowISO();
  });
  await update(ref(db, '/'), updates);
  return toUpdate.length;
}

export async function saveShiftsBatch(shifts) {
  const updates = {};
  shifts.forEach(shift => {
    const newKey = push(ref(db, 'shifts')).key;
    updates[`shifts/${newKey}`] = { ...shift, updated_at: nowISO() };
  });
  await update(ref(db, '/'), updates);
}

export async function toggleShiftLock(id, locked) {
  await updateShift(id, { is_locked: locked, updated_at: nowISO() });
}

export async function swapShiftSoldiers(idA, idB) {
  const [snapA, snapB] = await Promise.all([
    get(ref(db, `shifts/${idA}`)),
    get(ref(db, `shifts/${idB}`))
  ]);
  if (!snapA.exists() || !snapB.exists()) throw new Error('משמרת לא נמצאה');
  const a = snapA.val(), b = snapB.val();
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
// מחיקת נתונים — ניהול ענן
// ─────────────────────────────────────────────

export async function deleteAllSoldiers() {
  await remove(ref(db, 'soldiers'));
}

export async function deleteAllPosts() {
  // גם מרוקן משמרות
  const shifts = await getShifts();
  const updates = {};
  shifts.forEach(s => {
    updates[`shifts/${s.id}/soldier_id`]          = null;
    updates[`shifts/${s.id}/rest_before_minutes`]  = null;
    updates[`shifts/${s.id}/is_forced`]            = false;
    updates[`shifts/${s.id}/updated_at`]           = nowISO();
  });
  if (Object.keys(updates).length > 0) await update(ref(db, '/'), updates);
  await remove(ref(db, 'posts'));
}

export async function deleteAllShifts() {
  await remove(ref(db, 'shifts'));
}

export async function deleteAllGroups() {
  await remove(ref(db, 'groups'));
}

export async function deleteAllRoles() {
  await remove(ref(db, 'roles'));
}

export async function deleteAllBackups() {
  await remove(ref(db, 'backups'));
}

export async function deleteEverything() {
  await Promise.all([
    remove(ref(db, 'soldiers')),
    remove(ref(db, 'posts')),
    remove(ref(db, 'shifts')),
    remove(ref(db, 'groups')),
    remove(ref(db, 'roles')),
    remove(ref(db, 'backups')),
    remove(ref(db, 'logs')),
  ]);
  // שמור הגדרות בסיס
  await set(ref(db, 'settings'), { min_rest_minutes: 240 });
}

// ─────────────────────────────────────────────
// לוג פעולות
// ─────────────────────────────────────────────

export async function logAction(action, details = {}) {
  try {
    await push(ref(db, 'logs'), { action, details, timestamp: nowISO() });
  } catch { /* לא קריטי */ }
}
