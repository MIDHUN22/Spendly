/**
 * db.js — IndexedDB wrapper using the idb library
 * Database: "spendly-db" v1
 * Stores: "expenses", "settings"
 */

let _db = null;

export async function getDB() {
    if (_db) return _db;
    _db = await idb.openDB('spendly-db', 1, {
        upgrade(db) {
            // Expenses store
            if (!db.objectStoreNames.contains('expenses')) {
                const expStore = db.createObjectStore('expenses', {
                    keyPath: 'id',
                    autoIncrement: true
                });
                expStore.createIndex('date', 'date');
                expStore.createIndex('category', 'category');
                expStore.createIndex('type', 'type');
                expStore.createIndex('createdAt', 'createdAt');
            }
            // Settings store (key-value)
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings');
            }
        }
    });
    return _db;
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export async function addExpense(data) {
    try {
        const db = await getDB();
        const expense = {
            amount: Number(data.amount),
            merchant: String(data.merchant || '').trim(),
            category: data.category || 'Other',
            type: data.type || 'debit',
            date: data.date || new Date().toISOString(),
            notes: data.notes || '',
            source: data.source || 'manual',
            receiptImage: data.receiptImage || null,
            createdAt: Date.now()
        };
        const id = await db.add('expenses', expense);
        return { ...expense, id };
    } catch (err) {
        console.error('addExpense error:', err);
        throw new Error('Failed to save expense. Please try again.');
    }
}

export async function updateExpense(id, data) {
    try {
        const db = await getDB();
        const existing = await db.get('expenses', id);
        if (!existing) throw new Error('Expense not found');
        const updated = { ...existing, ...data, id };
        await db.put('expenses', updated);
        return updated;
    } catch (err) {
        console.error('updateExpense error:', err);
        throw new Error('Failed to update expense.');
    }
}

export async function deleteExpense(id) {
    try {
        const db = await getDB();
        await db.delete('expenses', id);
    } catch (err) {
        console.error('deleteExpense error:', err);
        throw new Error('Failed to delete expense.');
    }
}

export async function getAllExpenses() {
    try {
        const db = await getDB();
        return await db.getAll('expenses');
    } catch (err) {
        console.error('getAllExpenses error:', err);
        return [];
    }
}

export async function getExpenseById(id) {
    try {
        const db = await getDB();
        return await db.get('expenses', id);
    } catch (err) {
        console.error('getExpenseById error:', err);
        return null;
    }
}

export async function getExpensesByDateRange(startDate, endDate) {
    try {
        const db = await getDB();
        const all = await db.getAll('expenses');
        const start = new Date(startDate).getTime();
        const end = new Date(endDate).getTime();
        return all.filter(e => {
            const t = new Date(e.date).getTime();
            return t >= start && t <= end;
        });
    } catch (err) {
        console.error('getExpensesByDateRange error:', err);
        return [];
    }
}

export async function getExpensesThisMonth() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
    return getExpensesByDateRange(start, end);
}

export async function getExpensesToday() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    return getExpensesByDateRange(start, end);
}

export async function getExpensesThisWeek() {
    const now = new Date();
    const day = now.getDay();       // 0=Sun
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const start = new Date(now.setDate(diff));
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return getExpensesByDateRange(start.toISOString(), end.toISOString());
}

export async function clearAllExpenses() {
    try {
        const db = await getDB();
        await db.clear('expenses');
    } catch (err) {
        throw new Error('Failed to clear data.');
    }
}

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULTS = {
    userName: 'User',
    monthlyBudget: 0,
    currency: '₹',
    categoryBudgets: {
        Food: 0, Transport: 0, Shopping: 0,
        Bills: 0, Health: 0, Entertainment: 0, Other: 0
    }
};

export async function getSetting(key) {
    try {
        const db = await getDB();
        const val = await db.get('settings', key);
        return val !== undefined ? val : DEFAULTS[key];
    } catch {
        return DEFAULTS[key];
    }
}

export async function setSetting(key, value) {
    try {
        const db = await getDB();
        await db.put('settings', value, key);
    } catch (err) {
        console.error('setSetting error:', err);
    }
}

export async function getAllSettings() {
    try {
        const db = await getDB();
        const keys = ['userName', 'monthlyBudget', 'currency', 'categoryBudgets'];
        const result = { ...DEFAULTS };
        for (const k of keys) {
            const v = await db.get('settings', k);
            if (v !== undefined) result[k] = v;
        }
        return result;
    } catch {
        return { ...DEFAULTS };
    }
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

export function sumDebits(expenses) {
    return expenses
        .filter(e => e.type === 'debit')
        .reduce((s, e) => s + e.amount, 0);
}

export function groupByCategory(expenses) {
    const map = {};
    for (const e of expenses) {
        if (e.type !== 'debit') continue;
        map[e.category] = (map[e.category] || 0) + e.amount;
    }
    return map;
}

export function groupByDate(expenses) {
    const map = {};
    for (const e of expenses) {
        if (e.type !== 'debit') continue;
        const d = e.date.slice(0, 10);
        map[d] = (map[d] || 0) + e.amount;
    }
    return map;
}

export function topMerchants(expenses, n = 5) {
    const map = {};
    for (const e of expenses) {
        if (e.type !== 'debit') continue;
        map[e.merchant] = (map[e.merchant] || 0) + e.amount;
    }
    return Object.entries(map)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n);
}
