/**
 * Retail AI Dashboard i18n — English + العربية (RTL).
 * Usage in HTML: data-i18n="key" (textContent) / data-i18n-ph="key" (placeholder).
 */
(function () {
  "use strict";

  const dict = {
    en: {
      appTitle: "🏪 Retail AI",
      adminTitle: "🛡️ Admin Panel",
      connecting: "connecting…",
      demoBanner: "Demo mode — running outside Telegram with mock data.",
      adminDemoBanner: "Demo mode — running outside Telegram. Admin restrictions disabled.",
      connLive: "Live · reading the channel bus",
      connMirror: "Cached mirror (no channel configured)",
      connDemo: "Demo mode (mock data)",
      statusTab: "Status",
      insightsTab: "Insights",
      settingsTab: "Settings",
      liveOccupancy: "Live occupancy",
      people: "people",
      congestionIndex: "Congestion index",
      updated: "Updated",
      neverUpdated: "never",
      deviceOffline: "Offline",
      deviceLastSeen: "last seen",
      minutesAgo: "min ago",
      inferenceMs: "last inference",
      uptimeMin: "uptime (min)",
      infOk: "inferences ok",
      subscriptionUntil: "Subscription until",
      noSubscription: "No subscription expiry set",
      expiredSuffix: " — EXPIRED",
      noAnalytics: "No analytics yet — the edge core has not posted a report.",
      footfallToday: "Footfall today",
      peakHour: "Peak hour",
      staffingEfficiency: "Staffing efficiency",
      staffingGaps24h: "Staffing gaps (24h)",
      peakDistribution: "Peak-hour distribution",
      footfallTrend: "Footfall trend",
      camerasSection: "📹 Cameras (RTSP)",
      addCamera: "+ Add camera",
      aiPrompt: "🧠 AI prompt",
      bridgeSection: "🔌 Telegram bridge & thresholds",
      botToken: "BOT_TOKEN — any bot admin of the channel, used for READING state (see README)",
      channelId: "STATE_CHANNEL_ID (private channel)",
      adminId: "ADMIN_ID (Telegram id that may manage subscriptions)",
      bridgeSecret: "BRIDGE_SECRET (optional HMAC key — same value as the edge core's config.env)",
      storeCapacity: "Store capacity",
      staffingThreshold: "Staffing threshold",
      refreshSeconds: "Refresh interval (seconds)",
      save: "💾 Save & push to core",
      saveNote: "Settings are stored in Telegram CloudStorage and pushed to the edge core through the private channel (see README).",
      adminPanel: "Admin panel →",
      dashboard: "Dashboard →",
      footerBrand: "Retail AI · zero-cloud-cost",
      fleetMonitor: "🛰️ Fleet monitor",
      refresh: "Refresh",
      subscriptions: "💳 Subscriptions",
      addManageUser: "Add / manage a user",
      userId: "user_id (Telegram id)",
      name: "Name (optional)",
      addUser: "+ Add user",
      grantSub: "Grant subscription (pushes to the core)",
      pushSub: "Push subscription",
      quickDays: "d",
      fleetNote: "Changes flow: Admin → channel → edge core (subscription firewall)",
      adminLocked: "Admins only.",
      adminLockedHint: "Your Telegram id is not the configured ADMIN_ID.",
      noUsers: "No users yet — add a user below.",
      configureFirst: "Configure BOT_TOKEN + channel in Settings first.",
      storeDevice: "Store device",
      channelLbl: "channel",
      lastSeen: "last seen",
      expiry: "expiry",
      recommendedStaffing: "Recommended staffing (7-day average)",
      staffNeeded: "staff",
      camHealth: "Camera health",
    },
    ar: {
      appTitle: "🏪 ريتيل AI",
      adminTitle: "🛡️ لوحة المشرف",
      connecting: "جارٍ الاتصال…",
      demoBanner: "وضع تجريبي — يعمل خارج تيليجرام ببيانات وهمية.",
      adminDemoBanner: "وضع تجريبي — يعمل خارج تيليجرام. قيود المشرف معطّلة.",
      connLive: "مباشر · قراءة ناقل القناة",
      connMirror: "نسخة مخزّنة (لا توجد قناة مهيأة)",
      connDemo: "وضع تجريبي (بيانات وهمية)",
      statusTab: "الحالة",
      insightsTab: "التحليلات",
      settingsTab: "الإعدادات",
      liveOccupancy: "الإشغال المباشر",
      people: "أشخاص",
      congestionIndex: "مؤشر الازدحام",
      updated: "آخر تحديث",
      neverUpdated: "أبدًا",
      deviceOffline: "غير متصل",
      deviceLastSeen: "آخر ظهور",
      minutesAgo: "دقيقة مضت",
      inferenceMs: "آخر استدلال",
      uptimeMin: "مدة التشغيل (دقيقة)",
      infOk: "استدلالات ناجحة",
      subscriptionUntil: "الاشتراك حتى",
      noSubscription: "لا يوجد تاريخ انتهاء اشتراك",
      expiredSuffix: " — منتهي",
      noAnalytics: "لا توجد تحليلات بعد — لم يرسل الجهاز أي تقرير.",
      footfallToday: "الزوار اليوم",
      peakHour: "ساعة الذروة",
      staffingEfficiency: "كفاءة التوظيف",
      staffingGaps24h: "فجوات التوظيف (24 س)",
      peakDistribution: "توزيع ساعات الذروة",
      footfallTrend: "اتجاه الزوار",
      camerasSection: "📹 الكاميرات (RTSP)",
      addCamera: "+ إضافة كاميرا",
      aiPrompt: "🧠 موجّه الذكاء الاصطناعي",
      bridgeSection: "🔌 جسر تيليجرام والحدود",
      botToken: "BOT_TOKEN — أي بوت مشرف على القناة، يُستخدم لقراءة الحالة (انظر README)",
      channelId: "STATE_CHANNEL_ID (القناة الخاصة)",
      adminId: "ADMIN_ID (معرّف تيليجرام المخوّل بإدارة الاشتراكات)",
      bridgeSecret: "BRIDGE_SECRET (مفتاح HMAC اختياري — نفس القيمة في config.env بالجهاز)",
      storeCapacity: "سعة المتجر",
      staffingThreshold: "حد فجوة التوظيف",
      refreshSeconds: "فترة التحديث (ثوانٍ)",
      save: "💾 حفظ وإرسال إلى الجهاز",
      saveNote: "تُحفظ الإعدادات في تخزين تيليجرام السحابي وتُرسل إلى الجهاز عبر القناة الخاصة (انظر README).",
      adminPanel: "لوحة المشرف ←",
      dashboard: "لوحة التحكم ←",
      footerBrand: "ريتيل AI · بلا تكلفة سحابية",
      fleetMonitor: "🛰️ مراقبة الأسطول",
      refresh: "تحديث",
      subscriptions: "💳 الاشتراكات",
      addManageUser: "إضافة / إدارة مستخدم",
      userId: "user_id (معرّف تيليجرام)",
      name: "الاسم (اختياري)",
      addUser: "+ إضافة مستخدم",
      grantSub: "منح اشتراك (يُرسل إلى الجهاز)",
      pushSub: "إرسال الاشتراك",
      fleetNote: "مسار التغيير: المشرف ← القناة ← الجهاز (جدار الاشتراك)",
      adminLocked: "للمشرفين فقط.",
      adminLockedHint: "معرّف تيليجرام الخاص بك ليس هو ADMIN_ID المهيأ.",
      noUsers: "لا يوجد مستخدمون بعد — أضف مستخدمًا بالأسفل.",
      configureFirst: "هيّئ BOT_TOKEN والقناة في الإعدادات أولًا.",
      storeDevice: "جهاز المتجر",
      channelLbl: "القناة",
      lastSeen: "آخر ظهور",
      expiry: "الانتهاء",
      recommendedStaffing: "التوظيف المقترح (متوسط 7 أيام)",
      staffNeeded: "موظف",
      camHealth: "صحة الكاميرات",
    },
  };

  let lang = "en";
  try { lang = localStorage.getItem("retail_ai_lang") || "en"; } catch {}
  if (dict[lang] === undefined) lang = "en";

  function t(key) {
    return (dict[lang] && dict[lang][key]) || dict.en[key] || key;
  }

  function setLang(l) {
    if (dict[l]) lang = l;
    try { localStorage.setItem("retail_ai_lang", lang); } catch {}
    apply();
  }

  function apply() {
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    const btn = document.getElementById("lang-toggle");
    if (btn) btn.textContent = lang === "ar" ? "EN" : "عربي";
  }

  window.RetailI18n = { t, setLang, apply, lang: () => lang };
})();
