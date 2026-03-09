# שבצ"ק - מערכת ניהול שמירות צבאיות

אפליקציית Android (APK) לניהול שמירות עבור מפקד בלבד.

## מבנה הפרויקט

```
shavtzak/
├── .github/workflows/build-apk.yml   # CI/CD אוטומטי
├── www/                               # ממשק המשתמש
│   ├── index.html         # לוח שבצ"ק ראשי
│   ├── shifts.html        # ניהול ושיבוץ
│   ├── soldiers.html      # ניהול חיילים
│   ├── posts.html         # ניהול עמדות
│   ├── bulk_add.html      # הוספה המונית
│   ├── admin_check.html   # דוח בקרת מנוחה
│   ├── settings.html      # הגדרות מפקד
│   └── js/
│       ├── firebase.js    # Firebase CRUD
│       ├── logic.js       # אלגוריתם שיבוץ
│       └── ui.js          # פונקציות ממשק
├── capacitor.config.json
├── package.json
└── README.md
```

## הגדרה ראשונית

### 1. Firebase
1. צור פרויקט ב-[Firebase Console](https://console.firebase.google.com)
2. הפעל **Realtime Database**
3. הגדר חוקי אבטחה:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
4. העתק את הקונפיגורציה לתוך `www/js/firebase.js`

### 2. GitHub Secrets
הגדר ב-Settings → Secrets and variables → Actions:

| Secret | תיאור |
|--------|-------|
| `SIGNING_KEY` | קובץ keystore מקודד ב-Base64 |
| `KEY_ALIAS` | שם ה-alias |
| `KEY_STORE_PASSWORD` | סיסמת ה-keystore |
| `KEY_PASSWORD` | סיסמת המפתח |

### 3. יצירת keystore
```bash
keytool -genkey -v -keystore shavtzak.keystore \
  -alias shavtzak -keyalg RSA -keysize 2048 -validity 10000

# קידוד ל-Base64:
base64 -w 0 shavtzak.keystore
```

## שימוש

### הרצה לפיתוח
```bash
npm install
npx cap sync android
```

### בניית APK
```bash
git push origin main
# GitHub Actions בונה אוטומטית
# הורד APK מ: github.com/USERNAME/shavtzak/releases/latest
```

## תהליך שיבוץ

1. **הגדרות** → קבע מנוחה מינימלית, הוסף מחלקות ופק"לים
2. **עמדות** → הגדר עמדות + תקנים + משך משמרת
3. **חיילים** → הוסף חיילים (בודד או המוני)
4. **שיבוץ** → הגדר טווח זמן והפעל שיבוץ
5. **לוח** → צפה בשבצ"ק בזמן אמת
6. **בקרה** → בדוק חריגות מנוחה

## טכנולוגיות

- **Frontend**: HTML5 + Bootstrap 5 RTL
- **Backend**: Firebase Realtime Database
- **Mobile**: Capacitor (Android APK)
- **CI/CD**: GitHub Actions
