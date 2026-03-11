// logic.js - גרסה 4.0
// שיטות דירוג: הכי ישן / יחס עומס
// לוגיקת החלפת פק"ל: העבר מומחה ומלא מחדש

import {
  getSettings, getPosts, getSoldiers, getShifts,
  getShiftsInRange, deleteShiftsInRange, clearSoldiersInRange,
  saveShiftsBatch, updateShift, logAction
} from './firebase.js';

// ─────────────────────────────────────────────
// קבועים
// ─────────────────────────────────────────────

const MIN_SHIFT_MINUTES = 30;

// ─────────────────────────────────────────────
// כלי זמן
// ─────────────────────────────────────────────

function diffMinutes(isoA, isoB) {
  return (new Date(isoB) - new Date(isoA)) / 60000;
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

function nowISO() { return new Date().toISOString(); }

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

// ─────────────────────────────────────────────
// מנוחה מינימלית לחייל — אישי דורס גלובלי
// ─────────────────────────────────────────────

function getMinRest(soldier, globalMinRest) {
  if (soldier.min_rest_minutes !== null &&
      soldier.min_rest_minutes !== undefined &&
      soldier.min_rest_minutes > 0) {
    return soldier.min_rest_minutes;
  }
  return globalMinRest;
}

// ─────────────────────────────────────────────
// האם חייל תפוס בטווח זמן (לפי רשימת משמרות)
// ─────────────────────────────────────────────

function isBusy(soldierId, start, end, allShifts) {
  return allShifts.some(s =>
    s.soldier_id === soldierId &&
    overlaps(s.start_time, s.end_time, start, end)
  );
}

// ─────────────────────────────────────────────
// משמרת אחרונה של חייל לפני זמן נתון
// ─────────────────────────────────────────────

function getLastShiftBefore(soldierId, beforeISO, allShifts) {
  const mine = allShifts.filter(s =>
    s.soldier_id === soldierId && s.end_time <= beforeISO
  );
  if (mine.length === 0) return null;
  return mine.reduce((latest, s) =>
    s.end_time > latest.end_time ? s : latest
  );
}

// ─────────────────────────────────────────────
// ציון "הכי ישן"
// גבוה = לא שמר הרבה זמן = עדיפות גבוהה
// ─────────────────────────────────────────────

function scoreOldest(soldierId, shiftStart, allShifts) {
  const last = getLastShiftBefore(soldierId, shiftStart, allShifts);
  if (!last) return Number.MAX_SAFE_INTEGER;
  return diffMinutes(last.end_time, shiftStart);
}

// ─────────────────────────────────────────────
// ציון "יחס עומס"
// גבוה = יחס שמירה/מנוחה נמוך = פחות עמוס = עדיפות גבוהה
// ─────────────────────────────────────────────

function scoreLoadRatio(soldierId, shiftStart, allShifts) {
  const myShifts = allShifts.filter(s =>
    s.soldier_id === soldierId && s.end_time <= shiftStart
  );
  if (myShifts.length === 0) return Number.MAX_SAFE_INTEGER;

  const totalShiftMins = myShifts.reduce((sum, s) =>
    sum + diffMinutes(s.start_time, s.end_time), 0
  );
  if (totalShiftMins === 0) return Number.MAX_SAFE_INTEGER;

  const firstShift = myShifts.reduce((earliest, s) =>
    s.start_time < earliest.start_time ? s : earliest
  );
  const totalSpanMins = diffMinutes(firstShift.start_time, shiftStart);
  const restMins = Math.max(totalSpanMins - totalShiftMins, 1);

  return 1 / (totalShiftMins / restMins);
}

// ─────────────────────────────────────────────
// בניית משבצות ריקות
// ─────────────────────────────────────────────

function buildEmptyShifts(posts, startISO, endISO) {
  const result = [];
  for (const post of posts) {
    const reqs = post.requirements
      ? Object.entries(post.requirements).map(([id, d]) => ({ id, ...d }))
      : [];
    if (reqs.length === 0) continue;

    const durMins = Math.max(post.duration_minutes || 60, MIN_SHIFT_MINUTES);
    let cursor = startISO;

    while (cursor < endISO) {
      const rawEnd    = addMinutes(cursor, durMins);
      const actualEnd = rawEnd > endISO ? endISO : rawEnd;
      if (diffMinutes(cursor, actualEnd) < MIN_SHIFT_MINUTES) break;

      for (const req of reqs) {
        result.push({
          post_id:             post.id,
          requirement_id:      req.id,
          soldier_id:          null,
          start_time:          cursor,
          end_time:            actualEnd,
          rest_before_minutes: null,
          is_forced:           false,
          is_locked:           false
        });
      }
      cursor = actualEnd;
      if (cursor >= endISO) break;
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// בחירת חייל מתאים למשמרת
// מחזיר: { soldierId, restMins, isForced } או null
// ─────────────────────────────────────────────

function pickSoldier(shift, soldiers, posts, allShifts, options) {
  const { rankMode, shortageAction, globalMinRest } = options;
  const post = posts.find(p => p.id === shift.post_id);
  const req  = post?.requirements?.[shift.requirement_id];

  // ── 1. מועמדים בסיסיים ───────────────────
  const candidates = soldiers.filter(s => {
    if (!s.is_active) return false;
    if (s.return_to_service_time &&
        new Date(s.return_to_service_time) > new Date(shift.start_time)) return false;
    if (isBusy(s.id, shift.start_time, shift.end_time, allShifts)) return false;
    if (req?.required_role_id && !s.roles?.includes(req.required_role_id)) return false;
    return true;
  });

  if (candidates.length === 0) return null;

  // ── 2. ציון + מנוחה ──────────────────────
  const scored = candidates.map(s => {
    const last     = getLastShiftBefore(s.id, shift.start_time, allShifts);
    const restMins = last ? Math.round(diffMinutes(last.end_time, shift.start_time)) : null;
    const minRest  = getMinRest(s, globalMinRest);
    const score    = rankMode === 'oldest'
      ? scoreOldest(s.id, shift.start_time, allShifts)
      : scoreLoadRatio(s.id, shift.start_time, allShifts);
    return { soldier: s, score, restMins, minRest, isLegal: restMins === null || restMins >= minRest };
  });

  scored.sort((a, b) => b.score - a.score);

  // ── 3. עדיפות לחוקיים ────────────────────
  const legal = scored.filter(c => c.isLegal);
  if (legal.length > 0) {
    const best = legal[0];
    return { soldierId: best.soldier.id, restMins: best.restMins, isForced: false };
  }

  // ── 4. כפייה אם מוגדר ────────────────────
  if (shortageAction === 'force' && scored.length > 0) {
    const best = scored[0];
    return { soldierId: best.soldier.id, restMins: best.restMins, isForced: true };
  }

  return null;
}

// ─────────────────────────────────────────────
// לוגיקת החלפת פק"ל
//
// כשעמדה דורשת פק"ל ואין בעל פק"ל זמין:
//   1. מחפש בעל פק"ל שמשובץ כרגע למשמרת *רגילה* (לא-פק"ל) חופפת
//   2. בודק שהעברתו לא תיצור פער מנוחה קיצוני (לא יותר מ-MAX_REST_RATIO פי הממוצע)
//   3. מעביר אותו לעמדת הפק"ל
//   4. מנסה למלא את המשמרת הרגילה שהתפנתה עם חייל אחר
//   5. מחזיר אוסף פעולות לביצוע
// ─────────────────────────────────────────────

const MAX_REST_RATIO = 2.5; // מקסימום פי 2.5 מהממוצע

function trySpecialistSwap(emptyShift, soldiers, posts, allShifts, options) {
  const { globalMinRest, rankMode } = options;
  const post = posts.find(p => p.id === emptyShift.post_id);
  const req  = post?.requirements?.[emptyShift.requirement_id];
  if (!req?.required_role_id) return null;

  const roleId = req.required_role_id;

  // ── מצא בעלי פק"ל שמשובצים לעמדות רגילות חופפות ──
  const specialists = soldiers.filter(s =>
    s.is_active &&
    s.roles?.includes(roleId) &&
    !(s.return_to_service_time && new Date(s.return_to_service_time) > new Date(emptyShift.start_time))
  );

  // חשב ממוצע מנוחה נוכחי בין כל החיילים הפעילים
  const restValues = soldiers
    .filter(s => s.is_active)
    .map(s => {
      const last = getLastShiftBefore(s.id, emptyShift.start_time, allShifts);
      return last ? diffMinutes(last.end_time, emptyShift.start_time) : null;
    })
    .filter(v => v !== null);
  const avgRest = restValues.length > 0
    ? restValues.reduce((a, b) => a + b, 0) / restValues.length
    : globalMinRest * 2;

  for (const specialist of specialists) {
    // מצא משמרת רגילה (לא פק"ל) שהמומחה משובץ אליה ואורחת עם המשמרת הריקה
    const occupiedShift = allShifts.find(s =>
      s.soldier_id === specialist.id &&
      overlaps(s.start_time, s.end_time, emptyShift.start_time, emptyShift.end_time)
    );
    if (!occupiedShift) continue;

    // ודא שהמשמרת הנוכחית אינה עמדת פק"ל (אחרת לא כדאי להחליף)
    const occupiedPost = posts.find(p => p.id === occupiedShift.post_id);
    const occupiedReq  = occupiedPost?.requirements?.[occupiedShift.requirement_id];
    if (occupiedReq?.required_role_id) continue; // כבר בעמדת פק"ל — לא מחליפים

    // בדוק שהעברה לא תיצור פער מנוחה קיצוני
    const lastRest = getLastShiftBefore(specialist.id, emptyShift.start_time, allShifts);
    const restBeforeNew = lastRest
      ? diffMinutes(lastRest.end_time, emptyShift.start_time)
      : null;

    // אם מנוחתו הנוכחית כבר גבוהה מ-MAX_REST_RATIO * ממוצע — לא נוגעים
    if (restBeforeNew !== null && restBeforeNew > avgRest * MAX_REST_RATIO) continue;

    // בדוק שיש מנוחה מינימלית גם לעמדת הפק"ל החדשה
    const minRest = getMinRest(specialist, globalMinRest);
    if (restBeforeNew !== null && restBeforeNew < minRest) {
      // אין מספיק מנוחה — בדוק כפייה
      if (options.shortageAction !== 'force') continue;
    }

    // ── מצא ממלא למשמרת הרגילה שתתפנה ──
    // בנה עותק זמני של allShifts בלי המשמרת של המומחה
    const tempShifts = allShifts.filter(s => s.id !== occupiedShift.id);
    const replacement = pickSoldier(
      occupiedShift,
      soldiers.filter(s => s.id !== specialist.id),
      posts,
      tempShifts,
      options
    );

    return {
      specialistId:    specialist.id,
      specialistShift: emptyShift,      // העמדה שהמומחה עובר אליה
      vacatedShift:    occupiedShift,   // המשמרת שהתפנתה
      replacement,                      // מי ממלא (או null)
      restBeforeNew
    };
  }

  return null; // לא נמצא פתרון
}

// ─────────────────────────────────────────────
// פונקציה ראשית — generateShifts
// ─────────────────────────────────────────────

export async function generateShifts(
  startISO,
  endISO,
  shortageAction   = 'empty',
  rankMode         = 'oldest',
  resetHistory     = false,
  runMode          = 'new',
  globalMinRest    = null,
  progressCallback = null
) {
  const progress = (pct, msg) => progressCallback?.(pct, msg);

  progress(0, 'טוען נתונים...');

  const [settings, posts, soldiers, allShiftsRaw] = await Promise.all([
    getSettings(), getPosts(), getSoldiers(), getShifts()
  ]);

  const effectiveGlobalMinRest = globalMinRest ?? settings.min_rest_minutes ?? 240;
  const options = { rankMode, shortageAction, globalMinRest: effectiveGlobalMinRest };

  progress(10, 'מכין משמרות...');

  let shiftsToAssign = [];

  if (runMode === 'new') {
    progress(15, 'מוחק משמרות קיימות...');
    await deleteShiftsInRange(startISO, endISO);
    const empty = buildEmptyShifts(posts, startISO, endISO);
    progress(25, `נוצרו ${empty.length} משמרות. שומר...`);
    await saveShiftsBatch(empty);
    shiftsToAssign = await getShiftsInRange(startISO, endISO);
  } else if (runMode === 'reassign') {
    progress(15, 'מרוקן שיבוצים...');
    await clearSoldiersInRange(startISO, endISO);
    shiftsToAssign = await getShiftsInRange(startISO, endISO);
  } else if (runMode === 'holes') {
    const inRange  = await getShiftsInRange(startISO, endISO);
    shiftsToAssign = inRange.filter(s => !s.soldier_id && !s.is_locked);
  }

  progress(30, `משבץ ${shiftsToAssign.length} משמרות...`);

  shiftsToAssign.sort((a, b) => a.start_time.localeCompare(b.start_time));

  const baseShifts = resetHistory
    ? allShiftsRaw.filter(s => s.start_time < startISO)
    : allShiftsRaw;

  // workingShifts מתעדכן בכל שיבוץ
  const workingShifts = [...baseShifts];

  let assigned = 0, forced = 0, empty = 0, specialistSwaps = 0;

  // מפה מהירה: shift.id → אינדקס ב-workingShifts
  const shiftIndex = {};
  workingShifts.forEach((s, i) => { shiftIndex[s.id] = i; });

  for (let i = 0; i < shiftsToAssign.length; i++) {
    const shift = shiftsToAssign[i];

    if (i % 5 === 0) {
      progress(
        30 + Math.floor((i / shiftsToAssign.length) * 60),
        `משבץ ${i + 1} מתוך ${shiftsToAssign.length}...`
      );
    }

    // דלג על נעולים עם חייל
    if (shift.is_locked && shift.soldier_id) {
      const last = getLastShiftBefore(shift.soldier_id, shift.start_time, workingShifts);
      const restMins = last ? Math.round(diffMinutes(last.end_time, shift.start_time)) : null;
      workingShifts.push({ ...shift, rest_before_minutes: restMins });
      assigned++;
      continue;
    }

    // ── נסה שיבוץ רגיל ───────────────────────
    const result = pickSoldier(shift, soldiers, posts, workingShifts, options);

    if (result) {
      // שיבוץ רגיל הצליח
      const upd = {
        soldier_id:          result.soldierId,
        rest_before_minutes: result.restMins,
        is_forced:           result.isForced,
        updated_at:          nowISO()
      };
      await updateShift(shift.id, upd);
      workingShifts.push({ ...shift, ...upd });
      result.isForced ? forced++ : assigned++;
      continue;
    }

    // ── שיבוץ רגיל נכשל — בדוק אם צריך פק"ל ──
    const post = posts.find(p => p.id === shift.post_id);
    const req  = post?.requirements?.[shift.requirement_id];

    if (req?.required_role_id) {
      // נסה החלפת מומחה
      const swap = trySpecialistSwap(shift, soldiers, posts, workingShifts, options);

      if (swap) {
        const isForced = swap.restBeforeNew !== null &&
          swap.restBeforeNew < getMinRest(
            soldiers.find(s => s.id === swap.specialistId),
            effectiveGlobalMinRest
          );

        // ── העבר מומחה לעמדת הפק"ל ──────────
        const updSpecialist = {
          soldier_id:          swap.specialistId,
          rest_before_minutes: swap.restBeforeNew !== null ? Math.round(swap.restBeforeNew) : null,
          is_forced:           isForced,
          updated_at:          nowISO()
        };
        await updateShift(shift.id, updSpecialist);
        workingShifts.push({ ...shift, ...updSpecialist });

        // ── רוקן את המשמרת הרגילה שהתפנתה ────
        const vacated = { ...swap.vacatedShift, soldier_id: null, rest_before_minutes: null, is_forced: false };
        await updateShift(swap.vacatedShift.id, {
          soldier_id: null, rest_before_minutes: null, is_forced: false, updated_at: nowISO()
        });
        // עדכן workingShifts
        const wIdx = workingShifts.findIndex(s => s.id === swap.vacatedShift.id);
        if (wIdx >= 0) workingShifts[wIdx] = vacated;

        // ── נסה למלא את המשמרת שהתפנתה ──────
        if (swap.replacement) {
          const updReplacement = {
            soldier_id:          swap.replacement.soldierId,
            rest_before_minutes: swap.replacement.restMins,
            is_forced:           swap.replacement.isForced,
            updated_at:          nowISO()
          };
          await updateShift(swap.vacatedShift.id, updReplacement);
          if (wIdx >= 0) workingShifts[wIdx] = { ...vacated, ...updReplacement };
          swap.replacement.isForced ? forced++ : assigned++;
        } else {
          empty++; // המשמרת הרגילה נשארה ריקה
        }

        isForced ? forced++ : assigned++;
        specialistSwaps++;
        continue;
      }
    }

    // ── לא נמצא שום פתרון — ריק ──────────────
    empty++;
    workingShifts.push({ ...shift, soldier_id: null });
  }

  progress(100, 'שיבוץ הושלם!');

  await logAction('generateShifts', {
    runMode, rankMode, assigned, forced, empty, specialistSwaps, startISO, endISO
  });

  return { assigned, forced, empty, specialistSwaps, total: shiftsToAssign.length };
}

// ─────────────────────────────────────────────
// חירום — מי זמין עכשיו
// ─────────────────────────────────────────────

export async function findEmergencySoldier(postId, requirementId) {
  const [soldiers, posts, allShifts, settings] = await Promise.all([
    getSoldiers(), getPosts(), getShifts(), getSettings()
  ]);

  const now  = nowISO();
  const end1 = addMinutes(now, 1);
  const post = posts.find(p => p.id === postId);
  const req  = post?.requirements?.[requirementId];
  const globalMinRest = settings.min_rest_minutes ?? 240;

  const candidates = soldiers.filter(s => {
    if (!s.is_active) return false;
    if (s.return_to_service_time &&
        new Date(s.return_to_service_time) > new Date()) return false;
    if (req?.required_role_id && !s.roles?.includes(req.required_role_id)) return false;
    return !isBusy(s.id, now, end1, allShifts);
  });

  return candidates.map(s => {
    const last     = getLastShiftBefore(s.id, now, allShifts);
    const restMins = last ? Math.round(diffMinutes(last.end_time, now)) : 999999;
    const minRest  = getMinRest(s, globalMinRest);
    return { ...s, restMins, isLegal: restMins >= minRest };
  }).sort((a, b) => b.restMins - a.restMins);
}

// ─────────────────────────────────────────────
// בדיקת עומס
// ─────────────────────────────────────────────

export async function checkWorkload(startISO, endISO) {
  const [soldiers, shifts] = await Promise.all([
    getSoldiers(),
    getShiftsInRange(startISO, endISO)
  ]);

  const counts = {};
  soldiers.forEach(s => {
    counts[s.id] = { soldier: s, count: 0, forcedCount: 0, totalMins: 0 };
  });

  shifts.forEach(sh => {
    if (sh.soldier_id && counts[sh.soldier_id]) {
      counts[sh.soldier_id].count++;
      if (sh.is_forced) counts[sh.soldier_id].forcedCount++;
      counts[sh.soldier_id].totalMins +=
        diffMinutes(sh.start_time, sh.end_time);
    }
  });

  const results = Object.values(counts).filter(c => c.count > 0);
  const avg = results.length > 0
    ? results.reduce((s, c) => s + c.count, 0) / results.length
    : 0;

  results.forEach(c => {
    c.isOverloaded = avg > 0 && c.count > avg * 1.5;
  });

  return {
    results: results.sort((a, b) => b.count - a.count),
    avg
  };
}
