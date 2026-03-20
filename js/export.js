/**
 * export.js — CSV and PDF export using jsPDF
 */

function ensureJsPDF() {
    return new Promise((resolve, reject) => {
        if (window.jspdf) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load jsPDF'));
        document.head.appendChild(script);
    });
}

function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ── CSV Export ────────────────────────────────────────────────────────────────

export function exportCSV(expenses, currency = '₹') {
    const header = ['Date', 'Time', 'Merchant', 'Category', 'Amount', 'Type', 'Notes', 'Source'];
    const rows = expenses.map(e => [
        formatDate(e.date),
        formatTime(e.date),
        `"${(e.merchant || '').replace(/"/g, '""')}"`,
        e.category,
        e.amount.toFixed(2),
        e.type,
        `"${(e.notes || '').replace(/"/g, '""')}"`,
        e.source
    ]);

    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const fname = `spendly-export-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.csv`;
    _download(url, fname);
    URL.revokeObjectURL(url);
}

// ── PDF Export ────────────────────────────────────────────────────────────────

export async function exportPDF(expenses, currency = '₹', chartBase64 = null) {
    await ensureJsPDF();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const now = new Date();
    const monthYear = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const debits = expenses.filter(e => e.type === 'debit');
    const credits = expenses.filter(e => e.type === 'credit');
    const totalOut = debits.reduce((s, e) => s + e.amount, 0);
    const totalIn = credits.reduce((s, e) => s + e.amount, 0);

    const W = doc.internal.pageSize.getWidth();
    let y = 20;

    // ── Header ──────────────────────────────────────────────────────────────────
    doc.setFillColor(108, 99, 255);
    doc.roundedRect(14, y - 10, W - 28, 28, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Spendly', 22, y + 4);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Expense Report — ${monthYear}`, 22, y + 12);
    doc.setTextColor(50, 50, 50);
    y += 34;

    // ── Summary table ────────────────────────────────────────────────────────────
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Summary', 14, y); y += 8;

    const summaryRows = [
        ['Total Expenses', `${currency}${totalOut.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
        ['Total Income', `${currency}${totalIn.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
        ['Net', `${currency}${(totalIn - totalOut).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`],
        ['Transactions', String(expenses.length)]
    ];

    for (const [label, val] of summaryRows) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setFillColor(245, 245, 250);
        doc.rect(14, y - 4, W - 28, 8, 'F');
        doc.setTextColor(80, 80, 80);
        doc.text(label, 18, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text(val, W - 18, y, { align: 'right' });
        y += 10;
    }
    y += 6;

    // ── Donut chart image ─────────────────────────────────────────────────────────
    if (chartBase64) {
        try {
            doc.addImage(chartBase64, 'PNG', 14, y, 60, 60);
            y += 68;
        } catch (_) { }
    }

    // ── Transactions table ────────────────────────────────────────────────────────
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(50, 50, 50);
    doc.text('Transactions', 14, y); y += 8;

    // Column headers
    const cols = [14, 38, 100, 130, 160, W - 14];
    const headers = ['Date', 'Merchant', 'Category', 'Amount', 'Type'];
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(108, 99, 255);
    doc.rect(14, y - 4, W - 28, 7, 'F');
    doc.setTextColor(255, 255, 255);
    headers.forEach((h, i) => doc.text(h, cols[i] + 1, y));
    y += 8;

    doc.setFont('helvetica', 'normal');
    const sorted = [...expenses].sort((a, b) => new Date(b.date) - new Date(a.date));
    let rowIdx = 0;
    for (const e of sorted) {
        if (y > 270) {
            doc.addPage();
            y = 20;
        }
        doc.setFillColor(rowIdx % 2 === 0 ? 252 : 245, rowIdx % 2 === 0 ? 252 : 252, rowIdx % 2 === 0 ? 255 : 255);
        doc.rect(14, y - 4, W - 28, 7, 'F');
        doc.setTextColor(50, 50, 50);
        const row = [
            formatDate(e.date),
            (e.merchant || '').slice(0, 20),
            e.category,
            `${currency}${e.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
            e.type
        ];
        row.forEach((cell, i) => doc.text(String(cell), cols[i] + 1, y));
        y += 8;
        rowIdx++;
    }

    // ── Footer ────────────────────────────────────────────────────────────────────
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(180, 180, 180);
        doc.text('Generated by Spendly', 14, 290);
        doc.text(`Page ${i} of ${pageCount}`, W - 14, 290, { align: 'right' });
    }

    const fname = `spendly-report-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.pdf`;
    doc.save(fname);
}

function _download(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
