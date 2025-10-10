// --- IMPORTS ---
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// FIX: Use a namespace import for robust compatibility with the CommonJS geofire-common package.
import * as geofire from 'geofire-common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

// --- ENVIRONMENT VARIABLE CHECK ---
// This check runs once when the function is initialized
const requiredEnvVars = [
    'FIREBASE_SERVICE_ACCOUNT_KEY',
    'GEMINI_API_KEY',
    'ROBOFLOW_API_KEY',
    'WEATHER_API_KEY'
];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);
if (missingEnvVars.length > 0) {
    console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    // We will throw an error here to prevent the function from being used in a broken state.
    // The handler will catch this on invocation and return a 500 error.
}

// --- INITIALIZATION ---
let db;
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} catch (e) {
    console.error('Failed to initialize Firebase Admin SDK:', e);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-pro-vision"});

// --- CONFIGURATION ---
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const DUPLICATE_CHECK_RADIUS_METERS = 20;

// --- MAIN HANDLER FUNCTION ---
export default async function handler(request, response) {
    // Check if any environment variables were missing during startup
    if (missingEnvVars.length > 0) {
        return response.status(500).json({ message: `Server configuration error: Missing environment variables: ${missingEnvVars.join(', ')}` });
    }
     if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        const { image, location } = request.body;
        if (!image || !location) {
            return response.status(400).json({ message: 'Missing image or location data.' });
        }

        // --- 1. Pothole Detection (Roboflow) ---
        const roboflowResult = await detectPothole(image);
        if (roboflowResult.predictions.length === 0) {
            return response.status(200).json({ 
                title: "No Pothole Detected",
                message: "Our initial AI analysis did not find a pothole. If you're sure there's an issue, please report it to your local authorities directly."
            });
        }

        // --- 2. Check for Duplicates ---
        if (location.latitude && location.longitude) {
            const duplicateReport = await findDuplicateReport(location.latitude, location.longitude);
            if (duplicateReport) {
                const reportRef = db.collection('reports').doc(duplicateReport.id);
                await reportRef.update({
                    confirmations: duplicateReport.confirmations + 1,
                    lastConfirmedAt: new Date()
                });
                return response.status(200).json({
                    title: "Report Confirmed!",
                    message: "Thanks for confirming! This pothole has already been reported. We've added your confirmation to the existing report.",
                    annotatedImage: await annotateImage(image, roboflowResult.predictions)
                });
            }
        }

        // --- 3. Advanced Analysis (Gemini AI & Weather) ---
        const [assessment, weather, annotatedImage] = await Promise.all([
            getAIAssessment(image),
            getWeather(location.latitude, location.longitude),
            annotateImage(image, roboflowResult.predictions)
        ]);

        // --- 4. Save New Report to Firestore ---
        const newReport = {
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            geohash: location.latitude ? geofire.getGeohashesForRadius([location.latitude, location.longitude], 1)[0] : null,
            imageUrl: `data:image/jpeg;base64,${annotatedImage}`,
            status: 'Submitted',
            confirmations: 1,
            createdAt: new Date(),
            lastConfirmedAt: new Date(),
            weather: weather,
            severity: assessment.severity,
            estimatedCost: assessment.estimatedCost,
            potholeType: assessment.potholeType
        };
        await db.collection('reports').add(newReport);

        // --- 5. Return Success Response ---
        return response.status(200).json({
            title: "Report Submitted!",
            message: "Thank you! Your report has been submitted with our advanced AI analysis.",
            annotatedImage: annotatedImage,
            assessment: assessment
        });

    } catch (error) {
        console.error("Error in submitReport function:", error);
        return response.status(500).json({ message: `An internal error occurred: ${error.message}` });
    }
}

// --- HELPER FUNCTIONS ---
// ... (The rest of the helper functions remain the same)
async function detectPothole(base64Image) {
    const response = await axios({
        method: "POST",
        url: `https://detect.roboflow.com/new-pothole-detection/1?api_key=${ROBOFLOW_API_KEY}`,
        data: base64Image,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    return response.data;
}

async function findDuplicateReport(lat, lon) {
    const radiusInM = DUPLICATE_CHECK_RADIUS_METERS;
    const bounds = geofire.getGeohashesForRadius([lat, lon], radiusInM);

    const promises = bounds.map(b => {
        const q = db.collection('reports')
            .where('status', '!=', 'Repaired')
            .orderBy('geohash')
            .startAt(b[0])
            .endAt(b[1]);
        return q.get();
    });

    const snapshots = await Promise.all(promises);
    const matchingDocs = [];
    snapshots.forEach(snap => {
        snap.forEach(doc => {
            matchingDocs.push({ id: doc.id, ...doc.data() });
        });
    });

    const center = { lat, lon };
    for (const doc of matchingDocs) {
        const distanceInKm = haversineDistance(center, { lat: doc.latitude, lon: doc.longitude });
        if (distanceInKm * 1000 <= radiusInM) {
            return doc;
        }
    }
    return null;
}

async function getAIAssessment(base64Image) {
    const prompt = `Analyze this image of a road surface. Provide a JSON response with three keys: "severity" (a number from 1-10, where 10 is most severe), "potholeType" (e.g., "Crack", "Pothole", "Utility Cut", "Rutting"), and "estimatedCost" (a string representing a rough, non-binding cost estimate in USD, like "$50 - $150"). Focus only on the most significant pothole if there are multiple.`;
    const imagePart = { inlineData: { data: base64Image, mimeType: 'image/jpeg' } };

    try {
        const result = await geminiModel.generateContent([prompt, imagePart]);
        const text = result.response.text();
        const jsonString = text.replace('```json', '').replace('```', '').trim();
        return JSON.parse(jsonString);
    } catch (e) {
        console.error("Gemini AI analysis failed:", e);
        return { severity: 'N/A', potholeType: 'N/A', estimatedCost: 'N/A' };
    }
}

async function getWeather(lat, lon) {
    if (!lat || !lon) return "N/A";
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
        const response = await axios.get(url);
        return `${response.data.weather[0].main} (${response.data.main.temp}°C)`;
    } catch (e) {
        console.error("Weather fetch failed:", e);
        return "N/A";
    }
}

async function annotateImage(base64Image, predictions) {
    return base64Image;
}

function haversineDistance(coords1, coords2) {
    function toRad(x) { return x * Math.PI / 180; }
    const R = 6371; // Earth radius in km
    const dLat = toRad(coords2.lat - coords1.lat);
    const dLon = toRad(coords2.lon - coords1.lon);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(coords1.lat)) * Math.cos(toRad(coords2.lat)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}


