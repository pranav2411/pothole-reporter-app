import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- INITIALIZATION ---
// This ensures we don't re-initialize the app on every hot-reload in development
if (!initializeApp.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// --- MAIN HANDLER FUNCTION ---
export default async function handler(request, response) {
    if (request.method !== 'GET') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const reportsRef = db.collection('reports');
        const snapshot = await reportsRef.where('status', '!=', 'Repaired').get();

        if (snapshot.empty) {
            return response.status(200).json([]);
        }

        const reports = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // We select only the data needed for the map to keep the payload small
            reports.push({
                id: doc.id,
                latitude: data.latitude,
                longitude: data.longitude,
                address: data.address,
                status: data.status,
                confirmations: data.confirmations,
                imageUrl: data.imageUrl,
                severity: data.severity,
                cost: data.estimatedCost,
                weather: data.weather
            });
        });

        return response.status(200).json(reports);

    } catch (error) {
        console.error("Error fetching reports:", error);
        return response.status(500).json({ message: 'An internal error occurred while fetching reports.' });
    }
}
