import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- INITIALIZATION ---
let db;
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} catch (e) {
    console.error('Failed to initialize Firebase Admin SDK in updateReportStatus:', e);
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
        const { reportId, newStatus } = request.body;

        if (!reportId || !newStatus) {
            return response.status(400).json({ message: 'Missing reportId or newStatus.' });
        }
        
        // In a real production app, you would verify an admin auth token here
        // For now, we are allowing the update to proceed.

        const validStatuses = ['Submitted', 'In Review', 'Repaired'];
        if (!validStatuses.includes(newStatus)) {
            return response.status(400).json({ message: 'Invalid status provided.' });
        }

        const reportRef = db.collection('reports').doc(reportId);
        await reportRef.update({ status: newStatus });

        return response.status(200).json({ message: 'Status updated successfully.' });

    } catch (error) {
        console.error("Error updating report status:", error);
        return response.status(500).json({ message: `An internal error occurred: ${error.message}` });
    }
}
