// --- IMPORTS ---
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { geohashQueryBounds, geohashForLocation } from 'geofire-common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { Resend } from 'resend';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// --- ENVIRONMENT VARIABLE CHECK ---
const requiredEnvVars = [
    'FIREBASE_SERVICE_ACCOUNT_KEY',
    'GEMINI_API_KEY',
    'ROBOFLOW_API_KEY',
    'WEATHER_API_KEY',
    'RESEND_API_KEY'
];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);
if (missingEnvVars.length > 0) {
    console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
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
const resend = new Resend(process.env.RESEND_API_KEY);

// --- CONFIGURATION ---
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const DUPLICATE_CHECK_RADIUS_METERS = 20;

// --- MAIN HANDLER FUNCTION ---
export default async function handler(request, response) {
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

        const roboflowResult = await detectPothole(image);
        const annotatedImage = await annotateImage(image, roboflowResult.predictions);
        
        if (roboflowResult.predictions.length === 0) {
            return response.status(200).json({ 
                title: "No Pothole Detected",
                message: "Our initial AI analysis did not find a pothole. If you're sure there's an issue, please report it to your local authorities directly."
            });
        }

        if (location.latitude && location.longitude) {
            const duplicateReport = await findDuplicateReport(location.latitude, location.longitude);
            if (duplicateReport) {
                const reportRef = db.collection('reports').doc(duplicateReport.id);
                await reportRef.update({
                    confirmations: duplicateReport.confirmations + 1,
                    lastConfirmedAt: new Date()
                });
                
                const updatedReportDetails = { ...duplicateReport, confirmations: duplicateReport.confirmations + 1 };
                await sendEmailReport(updatedReportDetails, annotatedImage);

                return response.status(200).json({
                    title: "Report Confirmed!",
                    message: "Thanks for confirming! This pothole has already been reported. We've added your confirmation and sent an updated report.",
                    annotatedImage: annotatedImage
                });
            }
        }

        const [assessment, weather] = await Promise.all([
            getAIAssessment(image),
            getWeather(location.latitude, location.longitude)
        ]);

        const newReport = {
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            geohash: location.latitude ? geohashForLocation([location.latitude, location.longitude]) : null,
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
        await sendEmailReport(newReport, annotatedImage);

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
async function sendEmailReport(reportDetails, annotatedImageBase64) {
    const { address, severity, estimatedCost, potholeType, confirmations, latitude, longitude } = reportDetails;
    const isUpdate = confirmations > 1;
    const googleMapsLink = (latitude && longitude) ? `https://www.google.com/maps?q=${latitude},${longitude}` : null;

    let aiAnalysisHtml = '';
    if (severity && severity !== 'N/A') {
        aiAnalysisHtml = `
            <h2>AI-Powered Damage Assessment:</h2>
            <ul>
                <li><strong>Severity Score:</strong> ${severity}/10</li>
                <li><strong>Pothole Type:</strong> ${potholeType}</li>
                <li><strong>Estimated Repair Cost:</strong> ${estimatedCost}</li>
            </ul>
        `;
    } else {
        aiAnalysisHtml = `
            <h2>AI-Powered Damage Assessment:</h2>
            <p>Advanced AI analysis could not be completed for this report.</p>
        `;
    }

    const subject = isUpdate 
        ? `Pothole Report Confirmed: ${address || 'New Report'}` 
        : `New Pothole Report Submitted: ${address || 'New Report'}`;

    const htmlBody = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h1>${isUpdate ? 'Pothole Confirmation Update' : 'New Pothole Report Submitted'}</h1>
            <p>A new report has been filed and requires attention.</p>
            <h2>Report Details:</h2>
            <ul>
                <li><strong>Location:</strong> ${address || 'Address not available'}</li>
                ${googleMapsLink ? `<li><strong>Map Link:</strong> <a href="${googleMapsLink}">View on Google Maps</a></li>` : ''}
                <li><strong>Total Confirmations:</strong> ${confirmations}</li>
            </ul>
            ${aiAnalysisHtml}
            <p>The annotated image showing the detected pothole is attached to this email for visual confirmation and analysis.</p>
            <hr>
            <p style="font-size: 0.8em; color: #888;">This is an automated message from the Pothole Reporter App.</p>
        </div>
    `;

    try {
        await resend.emails.send({
            from: 'onboarding@resend.dev',
            to: 'pranavkh2411@gmail.com',
            subject: subject,
            html: htmlBody,
            attachments: [
                {
                    filename: 'pothole_image_detected.jpg',
                    // FIX: Convert the base64 string to a Buffer for reliable attachments
                    content: Buffer.from(annotatedImageBase64, 'base64'),
                },
            ],
        });
        console.log('Email sent successfully for report at:', address);
    } catch (error) {
        console.error('Failed to send email via Resend:', error);
    }
}


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
    const bounds = geohashQueryBounds([lat, lon], radiusInM);

    const promises = bounds.map(b => {
        const q = db.collection('reports')
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

    const unrepairedDocs = matchingDocs.filter(doc => doc.status !== 'Repaired');

    const center = { lat, lon };
    for (const doc of unrepairedDocs) {
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
    try {
        const image = await loadImage(`data:image/jpeg;base64,${base64Image}`);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        ctx.strokeStyle = '#00FF00';
        ctx.lineWidth = 4;
        ctx.font = '20px Arial';
        ctx.fillStyle = '#00FF00';

        predictions.forEach(p => {
            const x = p.x - p.width / 2;
            const y = p.y - p.height / 2;
            
            ctx.strokeRect(x, y, p.width, p.height);
            
            const label = `${p.class} (${(p.confidence * 100).toFixed(1)}%)`;
            const textY = y > 20 ? y - 5 : y + 20;
            ctx.fillText(label, x, textY);
        });

        return canvas.toDataURL('image/jpeg').split(',')[1];
    } catch (error) {
        console.error('Failed to annotate image:', error);
        return base64Image;
    }
}

function haversineDistance(coords1, coords2) {
    function toRad(x) { return x * Math.PI / 180; }
    const R = 6371;
    const dLat = toRad(coords2.lat - coords1.lat);
    const dLon = toRad(coords2.lon - coords1.lon);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(coords1.lat)) * Math.cos(toRad(coords2.lat)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

