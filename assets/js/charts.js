/**
 * Chart.js helpers for the Retail AI dashboard.
 * All builders are null-safe and theme-aware (Telegram theme colors).
 */
(function () {
  "use strict";

  const FALLBACK = { bg: "#ffffff", text: "#1c2733", hint: "#708499", accent: "#2ea6ff", link: "#2ea6ff", button: "#2ea6ff" };

  function theme() {
    const p = (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.themeParams) || {};
    return {
      bg: p.bg_color || FALLBACK.bg,
      text: p.text_color || FALLBACK.text,
      hint: p.hint_color || FALLBACK.hint,
      accent: p.button_color || FALLBACK.accent,
      link: p.link_color || FALLBACK.link,
      secondary: p.secondary_bg_color || "#f1f3f5",
    };
  }

  function canvasCtx(id) {
    const el = document.getElementById(id);
    return el ? el.getContext("2d") : null;
  }

  function makeChart(ctx, config) {
    if (!ctx || !window.Chart) return null;
    try { return new window.Chart(ctx, config); } catch { return null; }
  }

  function hourLabel(epoch) {
    const d = new Date(epoch * 1000);
    return String(d.getHours()).padStart(2, "0") + ":00";
  }

  /**
   * Peak-hour distribution bar chart.
   * data: [{hour: epoch, footfall: number}, ...]
   */
  function buildPeakHoursChart(canvasId, distribution) {
    const ctx = canvasCtx(canvasId);
    if (!ctx) return null;
    const t = theme();
    const rows = (distribution || []).slice(-12);
    return makeChart(ctx, {
      type: "bar",
      data: {
        labels: rows.map((r) => hourLabel(r.hour)),
        datasets: [{
          label: "Footfall",
          data: rows.map((r) => r.footfall),
          backgroundColor: t.accent + "cc",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: t.hint }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: t.hint, precision: 0 }, grid: { color: t.secondary } },
        },
      },
    });
  }

  /** Footfall trend line chart (today vs yesterday + trend arrow). */
  function buildTrendChart(canvasId, report) {
    const ctx = canvasCtx(canvasId);
    if (!ctx) return null;
    const t = theme();
    const today = (report && report.footfall_today) || 0;
    const yesterday = (report && report.footfall_yesterday) || 0;
    const trend = (report && report.trend_pct_vs_yesterday) || 0;
    return makeChart(ctx, {
      type: "bar",
      data: {
        labels: ["Yesterday", "Today"],
        datasets: [{
          label: "Visits",
          data: [yesterday, today],
          backgroundColor: [t.secondary, t.accent + "cc"],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: () => "Trend vs yesterday: " + (trend >= 0 ? "+" : "") + trend + "%" } },
        },
        scales: {
          x: { ticks: { color: t.hint }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: t.hint, precision: 0 }, grid: { color: t.secondary } },
        },
      },
    });
  }

  window.RetailCharts = { buildPeakHoursChart, buildTrendChart, hourLabel };
})();
