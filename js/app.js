/**
 * app.js — Spendly main entry point
 * Handles: routing, onboarding, dashboard, history, analytics, settings
 * All page-specific logic is co-located here to keep modules simple.
 */

import {
    addExpense, updateExpense, deleteExpense, getAllExpenses,
    getExpensesToday, getExpensesThisWeek, getExpensesThisMonth,
    getExpensesByDateRange, clearAllExpenses,
    getSetting, setSetting, getAllSettings,
    sumDebits, groupByCategory, groupByDate, topMerchants
} from './db.js';

import { parseVoiceTranscript, startVoiceRecognition, stopVoiceRecognition, isVoiceSupported } from './voice.js';
import { parseBankSMS } from './sms-parser.js';
import { scanReceipt, fileToDataURL } from './ocr.js';
import { renderDonutChart, renderBarChart, renderSparkline, getDonutBase64, CAT_COLORS } from './charts.js';
import { exportCSV, exportPDF } from './export.js';

// ── Globals ───────────────────────────────────────────────────────────────────
let _settings = {};
let _currentPage = 'dashboard';
let _historyCategory = 'All';
let _analyticsExpenses = [];
let _analyticsPeriod = 'month';
let _ocrReceiptDataURL = null;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    window._spendlyCurrency = _settings.currency || '₹';

    registerServiceWorker();
    listenOffline();
    initNav();
    await checkOnboarding();
});

async function loadSettings() {
    _settings = await getAllSettings();
    window._spendlyCurrency = _settings.currency || '₹';
}

// ── Service Worker ────────────────────────────────────────────────────────────
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => {
                navigator.serviceWorker.addEventListener('message', e => {
                    if (e.data.type === 'SYNC_COMPLETE') showToast('Expenses synced!', 'success');
                });
            })
            .catch(err => console.warn('SW registration failed:', err));
    }
}

// ── Offline detection ─────────────────────────────────────────────────────────
function listenOffline() {
    const banner = document.getElementById('offline-banner');
    const update = () => banner.classList.toggle('show', !navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
}

// ── Onboarding ────────────────────────────────────────────────────────────────
async function checkOnboarding() {
    const done = await getSetting('onboardingDone');
    if (done) {
        document.getElementById('onboarding').classList.add('hidden');
        await navigateTo('dashboard');
    } else {
        showOnboarding();
    }
}

function showOnboarding() {
    const ob = document.getElementById('onboarding');
    const track = ob.querySelector('.slides-track');
    const dots = ob.querySelectorAll('.dot');
    let slide = 0;
    const total = 3;

    function goTo(n) {
        slide = Math.max(0, Math.min(total - 1, n));
        track.style.transform = `translateX(-${slide * 100}%)`;
        dots.forEach((d, i) => d.classList.toggle('active', i === slide));
        ob.querySelector('#ob-prev').style.opacity = slide === 0 ? '0.3' : '1';
        ob.querySelector('#ob-next').textContent = slide === total - 1 ? 'Get Started' : 'Next →';
    }

    ob.querySelector('#ob-prev').addEventListener('click', () => goTo(slide - 1));
    ob.querySelector('#ob-next').addEventListener('click', async () => {
        if (slide < total - 1) { goTo(slide + 1); }
        else {
            const budgetVal = ob.querySelector('#ob-budget').value;
            if (budgetVal) await setSetting('monthlyBudget', +budgetVal);
            await setSetting('onboardingDone', true);
            ob.classList.add('hidden');
            await navigateTo('dashboard');
        }
    });

    // Touch swipe
    let ts = 0;
    track.addEventListener('touchstart', e => ts = e.touches[0].clientX, { passive: true });
    track.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - ts;
        if (Math.abs(dx) > 50) goTo(slide + (dx < 0 ? 1 : -1));
    });

    goTo(0);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function initNav() {
    // Bottom nav
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });
    // Sidebar nav
    document.querySelectorAll('.sidebar-nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });
    // FAB
    document.getElementById('fab')?.addEventListener('click', () => navigateTo('add'));
}

window.navigateTo = async function (page) {
    if (_currentPage === page && document.getElementById(`page-${page}`).innerHTML.trim()) return;
    _currentPage = page;

    // Update active states
    document.querySelectorAll('.nav-item, .sidebar-nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === page);
    });

    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    const target = document.getElementById(`page-${page}`);
    if (!target) return;

    // Lazy-load page HTML (relative paths — works at any base URL)
    if (!target.dataset.loaded) {
        const pageMap = {
            dashboard: 'dashboard.html',
            add: 'add-expense.html',
            history: 'history.html',
            analytics: 'analytics.html',
            settings: 'settings.html'
        };
        try {
            const res = await fetch(`pages/${pageMap[page]}`);
            const html = await res.text();
            target.innerHTML = html;
            target.dataset.loaded = 'true';
        } catch (e) {
            target.innerHTML = `<p class="text-muted p-16">Failed to load page.</p>`;
        }
    }

    target.classList.add('active');

    // Initialize page
    const inits = {
        dashboard: initDashboard,
        add: initAddExpense,
        history: initHistory,
        analytics: initAnalytics,
        settings: initSettings
    };
    await inits[page]?.();
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(amount) {
    const c = _settings.currency || '₹';
    return `${c}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function catColor(category) {
    return CAT_COLORS[category] || '#B8B8B8';
}

function txnHTML(exp) {
    const amountClass = exp.type === 'credit' ? 'credit' : '';
    const sign = exp.type === 'credit' ? '+' : '-';
    return `
  <div class="txn-item" id="txn-${exp.id}" onclick="toggleTxn(${exp.id})">
    <div class="txn-item-row">
      <span class="cat-dot" style="background:${catColor(exp.category)}"></span>
      <span class="txn-merchant truncate">${exp.merchant}</span>
      <span class="txn-amount ${amountClass}">${sign}${fmt(exp.amount)}</span>
    </div>
    <div class="txn-meta">${formatDate(exp.date)} · ${formatTime(exp.date)}</div>
    <div class="txn-details">
      <div class="flex items-center gap-8">
        <span class="txn-badge badge-${exp.category}">${exp.category}</span>
        <span class="text-xs text-muted">${exp.source || 'manual'}</span>
      </div>
      ${exp.notes ? `<div class="text-sm text-secondary">${exp.notes}</div>` : ''}
      <div class="txn-actions mt-8">
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteTxn(event,${exp.id})" title="Delete">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  </div>`;
}

window.toggleTxn = (id) => {
    document.getElementById(`txn-${id}`)?.classList.toggle('expanded');
};

window.deleteTxn = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this expense?')) return;
    try {
        await deleteExpense(id);
        document.getElementById(`txn-${id}`)?.remove();
        showToast('Expense deleted', 'success');
    } catch (err) {
        showToast(err.message, 'danger');
    }
};

// ── Toast ─────────────────────────────────────────────────────────────────────
window.showToast = function (msg, type = 'info', duration = 3500) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => {
        t.classList.add('dismissing');
        setTimeout(() => t.remove(), 310);
    }, duration);
};

// ── Budget alert check ────────────────────────────────────────────────────────
async function checkBudgetAlerts(expense) {
    if (expense.type !== 'debit') return;
    const budgets = _settings.categoryBudgets || {};
    const limit = budgets[expense.category] || 0;
    if (!limit) return;

    const monthExpenses = await getExpensesThisMonth();
    const catTotal = monthExpenses
        .filter(e => e.category === expense.category && e.type === 'debit')
        .reduce((s, e) => s + e.amount, 0);

    const pct = (catTotal / limit) * 100;
    if (pct >= 100) {
        showToast(`🔴 ${expense.category} budget exceeded! ${fmt(catTotal)} of ${fmt(limit)}`, 'danger', 5000);
    } else if (pct >= 80) {
        showToast(`⚠ ${expense.category} budget ${Math.round(pct)}% used (${fmt(catTotal)} of ${fmt(limit)})`, 'warning', 5000);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
async function initDashboard() {
    // Greeting & date
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const nameEl = document.getElementById('dash-greeting-name');
    if (nameEl) nameEl.textContent = `${_settings.userName || 'User'} 👋`;
    const greetEl = document.querySelector('.greeting-text');
    if (greetEl) greetEl.textContent = greet;

    const now = new Date();
    const dateEl = document.getElementById('dash-date');
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const timeEl = document.getElementById('dash-time');
    if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }

    // Totals
    const [todayExp, weekExp, monthExp] = await Promise.all([
        getExpensesToday(), getExpensesThisWeek(), getExpensesThisMonth()
    ]);
    const todayTotal = sumDebits(todayExp);
    const weekTotal = sumDebits(weekExp);
    const monthTotal = sumDebits(monthExp);

    animateCount('dash-today', todayTotal);
    animateCount('dash-week', weekTotal);
    animateCount('dash-month', monthTotal);
    animateCount('dash-month-total', monthTotal);

    // Sparkline — last 7 days
    const vals = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();
        const exps = await getExpensesByDateRange(start, end);
        vals.push(sumDebits(exps));
    }
    setTimeout(() => renderSparkline('sparkline-canvas', vals), 100);

    // Recent transactions
    const all = await getAllExpenses();
    const recent = all.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    const listEl = document.getElementById('dash-recent-list');
    const emptyEl = document.getElementById('dash-empty');
    if (!listEl) return;

    if (recent.length === 0) {
        listEl.style.display = 'none';
        emptyEl?.classList.remove('hidden');
    } else {
        emptyEl?.classList.add('hidden');
        listEl.innerHTML = recent.map(txnHTML).join('');
    }
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const c = _settings.currency || '₹';
    let start = 0;
    const duration = 600;
    const step = Date.now();
    const tick = () => {
        const elapsed = Date.now() - step;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = start + (target - start) * eased;
        el.textContent = `${c}${Math.round(current).toLocaleString('en-IN')}`;
        if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD EXPENSE
// ═══════════════════════════════════════════════════════════════════════════════
function initAddExpense() {
    // Set today's date default
    const dateEl = document.getElementById('manual-date');
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

    // Tab switching
    document.querySelectorAll('#add-tabs .tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#add-tabs .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add('active');
        });
    });

    // Voice support check
    if (!isVoiceSupported()) {
        document.getElementById('voice-not-supported')?.classList.remove('hidden');
        document.getElementById('voice-ui')?.classList.add('hidden');
    }
}

// Manual save
window.saveManualExpense = async function () {
    const amount = parseFloat(document.getElementById('manual-amount').value);
    const merchant = document.getElementById('manual-merchant').value.trim();
    const category = document.getElementById('manual-category').value;
    const type = document.getElementById('manual-type').value;
    const date = document.getElementById('manual-date').value || new Date().toISOString().slice(0, 10);
    const notes = document.getElementById('manual-notes').value.trim();

    if (!amount || amount <= 0) { showToast('Please enter a valid amount', 'danger'); return; }
    if (!merchant) { showToast('Please enter a merchant or description', 'danger'); return; }

    try {
        const btn = document.getElementById('manual-save-btn');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        const exp = await addExpense({ amount, merchant, category, type, date: new Date(date).toISOString(), notes, source: 'manual' });
        showToast(`✓ Saved: ${fmt(exp.amount)} at ${exp.merchant}`, 'success');
        await checkBudgetAlerts(exp);

        // Reset form
        document.getElementById('manual-amount').value = '';
        document.getElementById('manual-merchant').value = '';
        document.getElementById('manual-notes').value = '';
        document.getElementById('manual-date').value = new Date().toISOString().slice(0, 10);

        // Refresh dashboard if visible
        invalidatePages(['dashboard']);
    } catch (err) {
        showToast(err.message, 'danger');
    } finally {
        const btn = document.getElementById('manual-save-btn');
        if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
    }
};

// ── Voice ──────────────────────────────────────────────────────────────────────
let _voiceFinalTranscript = '';
window.toggleVoice = function () {
    const btn = document.getElementById('mic-btn');
    const status = document.getElementById('voice-status-text');
    if (!btn) return;

    if (btn.classList.contains('recording')) {
        stopVoiceRecognition();
        btn.classList.remove('recording');
        status.textContent = 'Tap the mic to start speaking';
        return;
    }

    btn.classList.add('recording');
    status.textContent = 'Listening...';
    _voiceFinalTranscript = '';

    startVoiceRecognition({
        onInterim(text) {
            const tbox = document.getElementById('voice-transcript');
            if (tbox) tbox.textContent = text;
        },
        onFinal(text) {
            _voiceFinalTranscript += text;
            const tbox = document.getElementById('voice-transcript');
            if (tbox) { tbox.textContent = _voiceFinalTranscript; tbox.style.fontStyle = 'normal'; tbox.style.color = 'var(--text-primary)'; }
            status.textContent = 'Processing...';
            const parsed = parseVoiceTranscript(_voiceFinalTranscript);
            populateVoiceFields(parsed);
        },
        onError(msg) {
            showToast(msg, 'danger');
            btn?.classList.remove('recording');
            status.textContent = 'Tap the mic to start speaking';
        },
        onEnd() {
            btn?.classList.remove('recording');
            if (!_voiceFinalTranscript) status.textContent = 'Tap the mic to start speaking';
        }
    });
};

function populateVoiceFields(parsed) {
    const fields = document.getElementById('voice-parsed-fields');
    if (!fields) return;
    fields.classList.remove('hidden');
    if (parsed.amount) document.getElementById('voice-amount').value = parsed.amount;
    if (parsed.merchant) document.getElementById('voice-merchant').value = parsed.merchant;
    const catEl = document.getElementById('voice-category');
    if (catEl) catEl.value = parsed.category || 'Other';
    document.getElementById('voice-status-text').textContent = `Parsed with ${parsed.confidence}% confidence`;
}

window.saveVoiceExpense = async function () {
    const amount = parseFloat(document.getElementById('voice-amount')?.value);
    const merchant = document.getElementById('voice-merchant')?.value.trim();
    const category = document.getElementById('voice-category')?.value;
    if (!amount || !merchant) { showToast('Please fill amount and merchant', 'danger'); return; }
    try {
        const exp = await addExpense({ amount, merchant, category, type: 'debit', date: new Date().toISOString(), source: 'voice' });
        showToast(`✓ Saved: ${fmt(exp.amount)} at ${exp.merchant}`, 'success');
        await checkBudgetAlerts(exp);
        document.getElementById('voice-parsed-fields')?.classList.add('hidden');
        document.getElementById('voice-transcript').textContent = 'Your speech will appear here...';
        _voiceFinalTranscript = '';
        invalidatePages(['dashboard']);
    } catch (err) { showToast(err.message, 'danger'); }
};

// ── OCR ────────────────────────────────────────────────────────────────────────
window.handleReceiptFile = async function (event) {
    const file = event.target.files?.[0];
    if (!file) return;
    _ocrReceiptDataURL = await fileToDataURL(file);
    const preview = document.getElementById('receipt-preview-img');
    if (preview) preview.src = _ocrReceiptDataURL;
    document.getElementById('receipt-preview-section')?.classList.remove('hidden');
    document.getElementById('receipt-drop-area').style.display = 'none';
};

window.runOCR = async function () {
    if (!_ocrReceiptDataURL) return;
    const progress = document.getElementById('scan-progress');
    const progressBar = document.getElementById('scan-progress-bar');
    const progressLbl = document.getElementById('scan-progress-label');

    progress.classList.add('visible');

    try {
        const result = await scanReceipt(_ocrReceiptDataURL, pct => {
            const p = Math.round(pct * 100);
            if (progressBar) progressBar.style.width = `${p}%`;
            if (progressLbl) progressLbl.textContent = `Scanning... ${p}%`;
        });

        progress.classList.remove('visible');
        document.getElementById('ocr-parsed-fields')?.classList.remove('hidden');
        if (result.amount) document.getElementById('ocr-amount').value = result.amount;
        if (result.merchant) document.getElementById('ocr-merchant').value = result.merchant;
        if (result.date) {
            const parsed = new Date(result.date);
            if (!isNaN(parsed)) document.getElementById('ocr-date').value = parsed.toISOString().slice(0, 10);
        }
        showToast('✓ Receipt scanned!', 'success');
    } catch (err) {
        progress.classList.remove('visible');
        showToast(err.message, 'danger');
    }
};

window.saveOCRExpense = async function () {
    const amount = parseFloat(document.getElementById('ocr-amount')?.value);
    const merchant = document.getElementById('ocr-merchant')?.value.trim() || 'Receipt';
    const category = document.getElementById('ocr-category')?.value;
    const dateVal = document.getElementById('ocr-date')?.value;
    if (!amount) { showToast('Please enter the amount', 'danger'); return; }
    try {
        const exp = await addExpense({
            amount, merchant, category, type: 'debit',
            date: dateVal ? new Date(dateVal).toISOString() : new Date().toISOString(),
            source: 'ocr',
            receiptImage: _ocrReceiptDataURL
        });
        showToast(`✓ Saved: ${fmt(exp.amount)} at ${exp.merchant}`, 'success');
        await checkBudgetAlerts(exp);
        _ocrReceiptDataURL = null;
        document.getElementById('receipt-drop-area').style.display = '';
        document.getElementById('receipt-preview-section')?.classList.add('hidden');
        document.getElementById('ocr-parsed-fields')?.classList.add('hidden');
        invalidatePages(['dashboard']);
    } catch (err) { showToast(err.message, 'danger'); }
};

// ── SMS Parse ──────────────────────────────────────────────────────────────────
window.parseSMS = function () {
    const text = document.getElementById('sms-text')?.value;
    if (!text?.trim()) { showToast('Please paste an SMS', 'danger'); return; }

    const result = parseBankSMS(text);
    if (!result.isTransaction) {
        showToast(`Not a transaction SMS: ${result.reason}`, 'warning');
        return;
    }

    document.getElementById('sms-parsed-fields')?.classList.remove('hidden');
    if (result.amount) document.getElementById('sms-amount').value = result.amount;
    if (result.merchant) document.getElementById('sms-merchant').value = result.merchant;
    const catEl = document.getElementById('sms-category');
    if (catEl) catEl.value = result.category || 'Other';
    const typeEl = document.getElementById('sms-type');
    if (typeEl) typeEl.value = result.type || 'debit';
    const balEl = document.getElementById('sms-balance');
    if (balEl) balEl.value = result.balance ? fmt(result.balance) : '—';
    showToast('SMS parsed successfully', 'success');
};

window.saveSMSExpense = async function () {
    const amount = parseFloat(document.getElementById('sms-amount')?.value);
    const merchant = document.getElementById('sms-merchant')?.value.trim() || 'Bank Transaction';
    const category = document.getElementById('sms-category')?.value;
    const type = document.getElementById('sms-type')?.value;
    if (!amount) { showToast('Please enter the amount', 'danger'); return; }
    try {
        const exp = await addExpense({ amount, merchant, category, type, date: new Date().toISOString(), source: 'sms' });
        showToast(`✓ Saved: ${fmt(exp.amount)} at ${exp.merchant}`, 'success');
        await checkBudgetAlerts(exp);
        document.getElementById('sms-text').value = '';
        document.getElementById('sms-parsed-fields')?.classList.add('hidden');
        invalidatePages(['dashboard']);
    } catch (err) { showToast(err.message, 'danger'); }
};

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════════════════════
async function initHistory() {
    _historyCategory = 'All';
    document.querySelectorAll('#history-filter-chips .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.cat === 'All');
    });
    await filterHistory();
}

window.setHistoryCategory = function (el, cat) {
    _historyCategory = cat;
    document.querySelectorAll('#history-filter-chips .chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    filterHistory();
};

window.filterHistory = async function () {
    const search = (document.getElementById('history-search')?.value || '').toLowerCase();
    const range = document.getElementById('history-date-range')?.value || 'month';
    const listEl = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');
    const countEl = document.getElementById('history-count');
    if (!listEl) return;

    let expenses = await getExpensesInRange(range);

    if (_historyCategory !== 'All') {
        expenses = expenses.filter(e => e.category === _historyCategory);
    }
    if (search) {
        expenses = expenses.filter(e => e.merchant.toLowerCase().includes(search));
    }
    expenses.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (countEl) countEl.textContent = `${expenses.length} transaction${expenses.length !== 1 ? 's' : ''}`;

    if (expenses.length === 0) {
        listEl.innerHTML = '';
        emptyEl?.classList.remove('hidden');
    } else {
        emptyEl?.classList.add('hidden');
        listEl.innerHTML = expenses.map(txnHTML).join('');
    }
};

async function getExpensesInRange(range) {
    const now = new Date();
    switch (range) {
        case 'week': return getExpensesThisWeek();
        case 'month': return getExpensesThisMonth();
        case 'last-month': {
            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
            const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
            return getExpensesByDateRange(start, end);
        }
        default: return getAllExpenses();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
async function initAnalytics() {
    _analyticsPeriod = 'month';
    await renderAnalytics();
}

window.setAnalyticsPeriod = async function (el, period) {
    _analyticsPeriod = period;
    document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    await renderAnalytics();
};

async function renderAnalytics() {
    _analyticsExpenses = await getExpensesInRange(_analyticsPeriod);
    const debits = _analyticsExpenses.filter(e => e.type === 'debit');

    if (debits.length === 0) {
        document.getElementById('analytics-empty')?.classList.remove('hidden');
        return;
    }
    document.getElementById('analytics-empty')?.classList.add('hidden');

    const catData = groupByCategory(_analyticsExpenses);
    const dateData = groupByDate(_analyticsExpenses);
    const merchants = topMerchants(_analyticsExpenses);
    const total = sumDebits(_analyticsExpenses);

    // Stats
    const days = Math.max(Object.keys(dateData).length, 1);
    setEl('stat-avg-day', fmt(total / days));
    const highestExp = debits.reduce((m, e) => e.amount > m ? e.amount : m, 0);
    setEl('stat-highest', fmt(highestExp));
    const topCat = Object.entries(catData).sort((a, b) => b[1] - a[1])[0];
    setEl('stat-top-cat', topCat ? topCat[0] : '—');

    // Charts
    setTimeout(() => {
        if (Object.keys(catData).length > 0) renderDonutChart('donut-chart', catData);
        if (Object.keys(dateData).length > 0) renderBarChart('bar-chart', dateData);
    }, 50);

    // Budget progress
    renderBudgetBars(catData);

    // Top merchants
    const merchEl = document.getElementById('top-merchants-list');
    const emptyM = document.getElementById('top-merchants-empty');
    if (merchEl) {
        if (merchants.length === 0) {
            emptyM?.classList.remove('hidden');
            merchEl.innerHTML = '';
        } else {
            emptyM?.classList.add('hidden');
            merchEl.innerHTML = merchants.map(([name, amount], i) => `
        <div class="merchant-rank-item">
          <div class="merchant-rank-num">${i + 1}</div>
          <div class="merchant-rank-name">${name}</div>
          <div class="merchant-rank-amount">${fmt(amount)}</div>
        </div>`).join('');
        }
    }
}

function renderBudgetBars(catData) {
    const budgets = _settings.categoryBudgets || {};
    const container = document.getElementById('budget-progress-list');
    const noB = document.getElementById('budget-no-budgets');
    if (!container) return;

    const categories = Object.keys(budgets).filter(k => budgets[k] > 0);
    if (categories.length === 0) {
        if (noB) noB.style.display = '';
        container.innerHTML = '';
        return;
    }
    if (noB) noB.style.display = 'none';

    container.innerHTML = categories.map(cat => {
        const spent = catData[cat] || 0;
        const limit = budgets[cat];
        const pct = Math.min((spent / limit) * 100, 100);
        const cls = pct >= 90 ? 'red' : pct >= 60 ? 'amber' : '';
        return `
    <div class="budget-row">
      <div class="budget-row-header">
        <div class="budget-row-cat">
          <span class="cat-dot" style="background:${catColor(cat)}"></span>
          <span>${cat}</span>
        </div>
        <div class="budget-row-amounts">${fmt(spent)} / ${fmt(limit)}</div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill ${cls}" style="width:${pct}%"></div>
      </div>
    </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
async function initSettings() {
    await loadSettings();

    setInputVal('settings-name', _settings.userName || '');
    setInputVal('settings-budget', _settings.monthlyBudget || '');
    const currSel = document.getElementById('settings-currency');
    if (currSel) currSel.value = _settings.currency || '₹';
    const symEl = document.getElementById('settings-currency-symbol');
    if (symEl) symEl.textContent = _settings.currency || '₹';

    // Category budgets
    const budgets = _settings.categoryBudgets || {};
    const categs = ['Food', 'Transport', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Other'];
    const card = document.getElementById('category-budgets-card');
    if (card) {
        card.innerHTML = categs.map(cat => `
    <div class="settings-row" style="${cat === 'Other' ? 'border:none' : ''}">
      <div class="settings-row-label flex items-center gap-8">
        <span class="cat-dot" style="background:${catColor(cat)}"></span>${cat}
      </div>
      <div style="display:flex;align-items:center;gap:4px;">
        <span class="text-muted text-sm">${_settings.currency || '₹'}</span>
        <input type="number" inputmode="decimal" placeholder="0" value="${budgets[cat] || ''}"
          style="width:90px;text-align:right;" class="form-input"
          onchange="saveCatBudget('${cat}', +this.value)">
      </div>
    </div>`).join('');
    }
}

window.saveSettingField = async function (key, value) {
    _settings[key] = value;
    await setSetting(key, value);
    if (key === 'currency') {
        window._spendlyCurrency = value;
        const s = document.getElementById('settings-currency-symbol');
        if (s) s.textContent = value;
    }
};

window.saveCatBudget = async function (cat, value) {
    const budgets = _settings.categoryBudgets || {};
    budgets[cat] = value;
    _settings.categoryBudgets = budgets;
    await setSetting('categoryBudgets', budgets);
};

window.handleExportCSV = async function () {
    try {
        const all = await getAllExpenses();
        exportCSV(all, _settings.currency);
        showToast('CSV downloaded!', 'success');
    } catch (err) { showToast('Export failed: ' + err.message, 'danger'); }
};

window.handleExportPDF = async function () {
    try {
        const all = await getAllExpenses();
        const chartImg = getDonutBase64();
        await exportPDF(all, _settings.currency, chartImg);
        showToast('PDF downloaded!', 'success');
    } catch (err) { showToast('PDF export failed: ' + err.message, 'danger'); }
};

window.handleClearData = async function () {
    if (!confirm('This will permanently delete ALL expenses. Are you sure?')) return;
    try {
        await clearAllExpenses();
        showToast('All data cleared', 'success');
        invalidatePages(['dashboard', 'history', 'analytics']);
    } catch (err) { showToast(err.message, 'danger'); }
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}
function setInputVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}

function invalidatePages(pages) {
    pages.forEach(p => {
        const el = document.getElementById(`page-${p}`);
        if (el) delete el.dataset.loaded;
    });
}
