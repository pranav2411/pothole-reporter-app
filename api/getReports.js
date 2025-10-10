// --- IMPORTS ---
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// --- INITIALIZATION ---
// This section securely initializes the Firebase Admin SDK.
let db;
try {
    // Vercel caches environment variables, so we need to parse the key.
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

    // Check if the app is already initialized to prevent errors in a serverless environment.
    if (!getApps().length) {
        initializeApp({
            credential: cert(serviceAccount)
        });
    }
    db = getFirestore();
} catch (e) {
    console.error('Failed to initialize Firebase Admin SDK in getReports:', e);
}

// --- MAIN HANDLER FUNCTION ---
// This is the main function that Vercel will run when the /api/getReports endpoint is called.
export default async function handler(request, response) {
    // Ensure the function was initialized correctly.
    if (!db) {
        return response.status(500).json({ message: 'Server configuration error: Database not initialized.' });
    }

    // Allow only GET requests for this endpoint.
    if (request.method !== 'GET') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // Fetch all documents from the 'reports' collection in Firestore.
        const reportsRef = db.collection('reports');
        const snapshot = await reportsRef.get();

        if (snapshot.empty) {
            return response.status(200).json([]); // Return an empty array if no reports exist.
        }

        // Map the documents to a clean array of report objects.
        const reports = [];
        snapshot.forEach(doc => {
            reports.push({
                id: doc.id,
                ...doc.data()
            });
        });

        // Send the array of reports back to the frontend with a success status.
        return response.status(200).json(reports);

    } catch (error) {
        // If there's an error fetching from the database, log it and send a 500 internal server error response.
        console.error("Error fetching reports from Firestore:", error);
        return response.status(500).json({ message: 'Failed to fetch reports from the database.' });
    }
}

