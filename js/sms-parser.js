/**
 * sms-parser.js — Bank SMS regex parser for Indian banks
 */

export function parseBankSMS(smsText) {
    const text = smsText.trim();

    // Skip OTP / non-transaction messages
    if (/\botp\b|one.time.pass|do not share|verification code/i.test(text)) {
        return { isTransaction: false, reason: 'OTP message' };
    }
    if (!/(?:debited|credited|debit|credit|spent|paid|withdrawn|purchase|received|deposited|refund)/i.test(text)) {
        return { isTransaction: false, reason: 'Not a transaction SMS' };
    }

    const result = {
        isTransaction: true,
        amount: null,
        type: null,    // 'debit' | 'credit'
        merchant: '',
        balance: null,
        account: '',
        date: null,
        rawText: text
    };

    // ── Amount ────────────────────────────────────────────────────────────────────
    const amountPatterns = [
        /(?:rs\.?|inr\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
        /(?:debited|credited)\s+(?:with\s+)?(?:rs\.?|inr\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
        /(?:amount|amt)\s+(?:of\s+)?(?:rs\.?|inr\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
    ];
    for (const p of amountPatterns) {
        const m = text.match(p);
        if (m) {
            result.amount = parseFloat(m[1].replace(/,/g, ''));
            break;
        }
    }
    if (!result.amount) return { isTransaction: false, reason: 'Could not parse amount' };

    // ── Type ──────────────────────────────────────────────────────────────────────
    if (/\b(debited|debit|spent|paid|withdrawn|purchase|dr)\b/i.test(text)) {
        result.type = 'debit';
    } else if (/\b(credited|credit|received|deposited|refund|cr)\b/i.test(text)) {
        result.type = 'credit';
    } else {
        result.type = 'debit'; // default assumption
    }

    // ── Merchant ──────────────────────────────────────────────────────────────────
    const merchantPatterns = [
        /(?:at|to|for)\s+([A-Z][A-Za-z0-9\s\-\.&']{2,35})(?:\s+on\b|\s+ref\b|\s+vpa\b|\s+upi\b|\.|,|;)/,
        /(?:at|to|for)\s+([A-Za-z][A-Za-z0-9\s\-\.&']{2,35})(?=\s+(?:on|from|ref|vpa|upi|account|\d))/i,
        /([a-z0-9._+%-]+@[a-z0-9.-]+)/i,   // UPI VPA
        /\(([A-Z][A-Z0-9\s-.]{2,30})\)/,   // Merchant in brackets
        /(?:info|desc|narration)[:\s]+([A-Za-z0-9\s\-&.]{3,40})/i
    ];
    for (const p of merchantPatterns) {
        const m = text.match(p);
        if (m) {
            result.merchant = m[1].trim();
            break;
        }
    }

    // ── Balance ───────────────────────────────────────────────────────────────────
    const balM = text.match(/(?:avl?\.?\s*bal(?:ance)?|bal(?:ance)?\s+(?:is|:))\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (balM) result.balance = parseFloat(balM[1].replace(/,/g, ''));

    // ── Account ───────────────────────────────────────────────────────────────────
    const accM = text.match(/[Aa]\/?[Cc]\.?\s*(?:no\.?\s*)?([Xx*]{2,}\d{3,6})/);
    if (accM) result.account = accM[1];

    // ── Date ─────────────────────────────────────────────────────────────────────
    const datePatterns = [
        /(\d{1,2}[\-\/]\w{3}[\-\/]\d{2,4})/,
        /(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/,
        /(\d{4}[\-\/]\d{2}[\-\/]\d{2})/
    ];
    for (const p of datePatterns) {
        const m = text.match(p);
        if (m) {
            result.date = m[1];
            break;
        }
    }

    // ── Category inference ────────────────────────────────────────────────────────
    const mLower = result.merchant.toLowerCase();
    const CATEGORY_MAP = {
        Food: ['zomato', 'swiggy', 'restaurant', 'food', 'cafe', 'coffee', 'pizza', 'burger', 'hotelier'],
        Transport: ['uber', 'ola', 'rapido', 'metro', 'fuel', 'petrol', 'irctc', 'railway', 'airlines', 'cab'],
        Shopping: ['amazon', 'flipkart', 'myntra', 'mall', 'shop', 'store', 'market'],
        Bills: ['electricity', 'water', 'gas', 'wifi', 'internet', 'airtel', 'jio', 'bsnl', 'vi', 'recharge'],
        Health: ['hospital', 'clinic', 'doctor', 'pharmacy', 'apollo', 'medplus', 'medicine'],
        Entertainment: ['netflix', 'hotstar', 'spotify', 'prime', 'amazon prime', 'disney', 'book', 'cinema']
    };
    result.category = 'Other';
    for (const [cat, kws] of Object.entries(CATEGORY_MAP)) {
        if (kws.some(k => mLower.includes(k) || text.toLowerCase().includes(k))) {
            result.category = cat;
            break;
        }
    }

    return result;
}
