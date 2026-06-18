"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatNextPaymentDate = formatNextPaymentDate;
exports.formatNextPaymentDateMonthly = formatNextPaymentDateMonthly;
exports.formatNextPaymentDateYearly = formatNextPaymentDateYearly;
exports.formatNextPaymentDateMonthlyUS = formatNextPaymentDateMonthlyUS;
exports.formatNextPaymentDateYearlyUS = formatNextPaymentDateYearlyUS;
exports.formatNextPaymentDateUS = formatNextPaymentDateUS;
function formatNextPaymentDate(daysOffset) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ✅ New helper — adds exactly 1 calendar month
function formatNextPaymentDateMonthly() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ✅ New helper — adds exactly 1 calendar year
function formatNextPaymentDateYearly() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
// ── US format MM.DD.YYYY ──────────────────────────────────────
// US monthly — 1 month from today in MM.DD.YYYY
function formatNextPaymentDateMonthlyUS() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
// US yearly — 1 year from today in MM.DD.YYYY
function formatNextPaymentDateYearlyUS() {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
// US offset — N days from today in MM.DD.YYYY
function formatNextPaymentDateUS(daysOffset) {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
