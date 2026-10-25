import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- INITIALIZATION ---
let db;
try {
    let keyStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (typeof keyStr === 'string') {
        keyStr = keyStr.trim();
        if ((keyStr.startsWith("'") && keyStr.endsWith("'")) ||
            (keyStr.startsWith('"') && keyStr.endsWith('"') && !keyStr.startsWith('{"'))) {
            keyStr = keyStr.slice(1, -1);
        }
    }
    const serviceAccount = JSON.parse(keyStr);
    if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} catch (e) {
    console.error('Failed to initialize Firebase Admin SDK in verifyReport:', e);
}

// --- MAIN HANDLER FUNCTION ---
export default async function handler(request, response) {
    if (!db) {
        return response.status(500).json({ message: 'Server configuration error: Database not initialized.' });
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { reportId, action } = request.body;

        if (!reportId || !action) {
            return response.status(400).json({ message: 'Missing reportId or action.' });
        }

        const validActions = ['confirm', 'fixed'];
        if (!validActions.includes(action)) {
            return response.status(400).json({ message: 'Invalid verification action.' });
        }

        const reportRef = db.collection('reports').doc(reportId);
        const doc = await reportRef.get();

        if (!doc.exists) {
            return response.status(404).json({ message: 'Report not found.' });
        }

        const updateData = {};
        if (action === 'confirm') {
            updateData.confirmations = FieldValue.increment(1);
            updateData.lastConfirmedAt = new Date();
        } else if (action === 'fixed') {
            updateData.fixedConfirmations = FieldValue.increment(1);
        }

        await reportRef.update(updateData);

        return response.status(200).json({ message: 'Verification vote recorded successfully.' });

    } catch (error) {
        console.error("Error verifying report:", error);
        return response.status(500).json({ message: `An internal error occurred: ${error.message}` });
    }
}
