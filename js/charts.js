/**
 * charts.js — Chart.js wrappers for analytics
 */

const CAT_COLORS = {
    Food: '#FF6B6B',
    Transport: '#4ECDC4',
    Shopping: '#45B7D1',
    Bills: '#96CEB4',
    Health: '#FFEAA7',
    Entertainment: '#DDA0DD',
    Other: '#B8B8B8'
};

const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeInOutQuart' },
    plugins: {
        legend: {
            labels: { color: '#8888a8', font: { family: 'DM Sans', size: 13 }, padding: 16, boxWidth: 12, boxHeight: 12, borderRadius: 6 }
        },
        tooltip: {
            backgroundColor: '#22222f',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#f0f0f8',
            bodyColor: '#8888a8',
            padding: 12,
            cornerRadius: 10,
            titleFont: { family: 'DM Sans', weight: '600' },
            bodyFont: { family: 'Space Grotesk' }
        }
    }
};

let donutChart = null;
let barChart = null;
let sparkChart = null;

// ── Donut Chart (spending by category) ───────────────────────────────────────

export function renderDonutChart(canvasId, categoryData) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const labels = Object.keys(categoryData);
    const data = Object.values(categoryData);
    const colors = labels.map(l => CAT_COLORS[l] || '#B8B8B8');
    const currency = window._spendlyCurrency || '₹';

    if (donutChart) donutChart.destroy();

    donutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.map(c => c + 'cc'),
                borderColor: colors,
                borderWidth: 2,
                hoverOffset: 6
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            cutout: '72%',
            plugins: {
                ...CHART_DEFAULTS.plugins,
                tooltip: {
                    ...CHART_DEFAULTS.plugins.tooltip,
                    callbacks: {
                        label: ctx => ` ${ctx.label}: ${currency}${ctx.parsed.toLocaleString('en-IN')}`
                    }
                }
            }
        }
    });

    return donutChart;
}

// ── Bar Chart (daily spending) ────────────────────────────────────────────────

export function renderBarChart(canvasId, dateData) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const sorted = Object.entries(dateData).sort(([a], [b]) => a.localeCompare(b));
    const labels = sorted.map(([d]) => {
        const dt = new Date(d);
        return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    });
    const data = sorted.map(([, v]) => v);
    const currency = window._spendlyCurrency || '₹';

    if (barChart) barChart.destroy();

    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Daily Spending',
                data,
                backgroundColor: 'rgba(108,99,255,0.5)',
                borderColor: '#6c63ff',
                borderWidth: 1.5,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            ...CHART_DEFAULTS,
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8888a8', font: { family: 'DM Sans', size: 11 }, maxRotation: 45 }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#8888a8',
                        font: { family: 'Space Grotesk', size: 11 },
                        callback: v => `${currency}${v.toLocaleString('en-IN')}`
                    },
                    beginAtZero: true
                }
            },
            plugins: {
                ...CHART_DEFAULTS.plugins,
                legend: { display: false },
                tooltip: {
                    ...CHART_DEFAULTS.plugins.tooltip,
                    callbacks: {
                        label: ctx => ` ${currency}${ctx.parsed.y.toLocaleString('en-IN')}`
                    }
                }
            }
        }
    });

    return barChart;
}

// ── Sparkline (mini line chart on dashboard) ──────────────────────────────────

export function renderSparkline(canvasId, values) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    if (sparkChart) sparkChart.destroy();

    const max = Math.max(...values, 1);

    sparkChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: values.map((_, i) => i),
            datasets: [{
                data: values,
                borderColor: '#6c63ff',
                borderWidth: 2,
                fill: true,
                backgroundColor: ctx => {
                    const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 56);
                    gradient.addColorStop(0, 'rgba(108,99,255,0.35)');
                    gradient.addColorStop(1, 'rgba(108,99,255,0)');
                    return gradient;
                },
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: '#6c63ff'
            }]
        },
        options: {
            responsive: false,
            animation: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false, min: 0, max: max * 1.2 }
            }
        }
    });

    return sparkChart;
}

export function getDonutBase64() {
    return donutChart ? donutChart.toBase64Image() : null;
}

export { CAT_COLORS };
