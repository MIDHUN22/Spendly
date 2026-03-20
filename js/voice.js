/**
 * voice.js — Web Speech API integration + transcript parser
 */

const CATEGORY_MAP = {
    Food: ['zomato', 'swiggy', 'restaurant', 'food', 'lunch', 'dinner', 'breakfast', 'cafe', 'coffee', 'hotel', 'biryani', 'pizza', 'burger', 'dhaba', 'thali', 'snack', 'eat', 'meal'],
    Transport: ['uber', 'ola', 'rapido', 'metro', 'bus', 'auto', 'petrol', 'diesel', 'fuel', 'irctc', 'train', 'flight', 'cab', 'rickshaw', 'taxi', 'rapido', 'travel', 'trip'],
    Shopping: ['amazon', 'flipkart', 'myntra', 'mall', 'shop', 'store', 'market', 'buy', 'purchase', 'cloth', 'dress', 'shirt', 'shoe', 'bag', 'watch', 'electronics'],
    Bills: ['electricity', 'water', 'gas', 'wifi', 'internet', 'broadband', 'phone', 'mobile', 'recharge', 'airtel', 'jio', 'bsnl', 'vi', 'bill', 'utility', 'emi'],
    Health: ['hospital', 'clinic', 'doctor', 'pharmacy', 'medicine', 'medical', 'chemist', 'medplus', 'health', 'apollo', 'dental', 'gym', 'fitness'],
    Entertainment: ['netflix', 'hotstar', 'spotify', 'prime', 'movie', 'cinema', 'theatre', 'game', 'book', 'concert', 'show', 'disney', 'youtube', 'subscription']
};

export function parseVoiceTranscript(transcript) {
    const text = transcript.toLowerCase().trim();
    let amount = null, merchant = '', category = 'Other', confidence = 0;

    // ── Amount extraction ────────────────────────────────────────────────────────
    const amountPatterns = [
        /(?:spent|paid|spend|pay|costed?)\s+(?:rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i,
        /(?:rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
        /([\d,]+(?:\.\d{1,2})?)\s+(?:rupees?|bucks?)/i,
        /\b([\d,]+(?:\.\d{1,2})?)\b/
    ];
    for (const p of amountPatterns) {
        const m = text.match(p);
        if (m) {
            amount = parseFloat(m[1].replace(/,/g, ''));
            confidence += 40;
            break;
        }
    }

    // ── Merchant extraction ──────────────────────────────────────────────────────
    const merchantPatterns = [
        /(?:at|from|to|in)\s+([a-z][a-z0-9\s&'.,-]{1,30}?)(?:\s+(?:for|on|yesterday|today|last|using)|$)/i,
        /(?:for|on)\s+(?!food|transport|bill|shopping|health)([a-z][a-z0-9\s&'.,-]{1,30}?)(?:\s|$)/i
    ];
    for (const p of merchantPatterns) {
        const m = text.match(p);
        if (m) {
            merchant = m[1].trim().replace(/\b\w/g, c => c.toUpperCase());
            confidence += 30;
            break;
        }
    }

    // ── Category detection ───────────────────────────────────────────────────────
    const searchText = `${text} ${merchant.toLowerCase()}`;
    for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
        if (keywords.some(kw => searchText.includes(kw))) {
            category = cat;
            confidence += 30;
            break;
        }
    }

    return { amount, merchant, category, confidence, rawText: transcript };
}

// ── Web Speech API wrapper ────────────────────────────────────────────────────

let recognition = null;
let isRecording = false;

export function isVoiceSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function startVoiceRecognition({ onInterim, onFinal, onError, onEnd }) {
    if (!isVoiceSupported()) {
        onError?.('Voice recognition is not supported in this browser. Please use Chrome or Edge.');
        return;
    }
    if (isRecording) stopVoiceRecognition();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
        let interim = '', final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const t = event.results[i][0].transcript;
            if (event.results[i].isFinal) final += t;
            else interim += t;
        }
        if (interim) onInterim?.(interim);
        if (final) onFinal?.(final);
    };

    recognition.onerror = (event) => {
        isRecording = false;
        const msg = {
            'no-speech': 'No speech detected. Please try again.',
            'audio-capture': 'Microphone not found. Please check permissions.',
            'not-allowed': 'Microphone permission denied. Please allow access.',
            'network': 'Network error during recognition.',
            'aborted': null // user cancelled
        }[event.error] || `Voice error: ${event.error}`;
        if (msg) onError?.(msg);
    };

    recognition.onend = () => {
        isRecording = false;
        onEnd?.();
    };

    recognition.start();
    isRecording = true;
}

export function stopVoiceRecognition() {
    if (recognition && isRecording) {
        recognition.stop();
        isRecording = false;
    }
}

export function getIsRecording() { return isRecording; }
