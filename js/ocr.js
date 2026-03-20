/**
 * ocr.js — Tesseract.js receipt scanner (lazy-loaded)
 */

let tesseractLoaded = false;

async function ensureTesseract() {
    if (tesseractLoaded) return;
    return new Promise((resolve, reject) => {
        if (window.Tesseract) { tesseractLoaded = true; resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = () => { tesseractLoaded = true; resolve(); };
        script.onerror = () => reject(new Error('Failed to load Tesseract.js'));
        document.head.appendChild(script);
    });
}

/**
 * Parse OCR text for Indian receipt data
 */
function parseReceiptText(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Merchant: first non-empty line
    const merchant = lines[0] || '';

    // Total amount
    const totalPatterns = [
        /(?:grand\s+total|total\s+amount|net\s+amount|amount\s+payable|total)[:\s]+(?:rs\.?|₹)?\s*([\d,]+(?:\.\d{2})?)/i,
        /(?:rs\.?|₹)\s*([\d,]+(?:\.\d{2})?)\s*(?:only|\/\-)?/i,
        /([\d,]+\.\d{2})\s*$/m
    ];
    let amount = null;
    for (const p of totalPatterns) {
        const m = text.match(p);
        if (m) { amount = parseFloat(m[1].replace(/,/g, '')); break; }
    }

    // Date
    const dateM = text.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
    const date = dateM ? dateM[1] : null;

    // GST number (bonus info)
    const gstM = text.match(/(?:gstin|gst\s+no)[:\s]+([0-9A-Z]{15})/i);
    const gst = gstM ? gstM[1] : null;

    return { merchant, amount, date, gst, rawText: text };
}

/**
 * Scan an image file using Tesseract.js
 * @param {File|Blob|string} imageSource — File object or base64 data URL
 * @param {function} onProgress — called with progress 0-1
 * @returns {object} parsed receipt data
 */
export async function scanReceipt(imageSource, onProgress) {
    try {
        await ensureTesseract();

        const { data: { text } } = await Tesseract.recognize(imageSource, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    onProgress?.(m.progress);
                }
            }
        });

        return parseReceiptText(text);
    } catch (err) {
        console.error('OCR error:', err);
        throw new Error('Could not read receipt. Try better lighting or enter manually.');
    }
}

/**
 * Convert File to base64 data URL
 */
export function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}
