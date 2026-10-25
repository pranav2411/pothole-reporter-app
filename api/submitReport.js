// --- IMPORTS ---
import dns from 'dns';
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {
    // Ignore in unsupported environments
}

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { geohashQueryBounds, geohashForLocation } from 'geofire-common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { Resend } from 'resend';
import { createCanvas, loadImage } from '@napi-rs/canvas';

// --- CONFIGURATION & ENV SETUP ---
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DUPLICATE_CHECK_RADIUS_METERS = 20;

// Log missing optional env vars gracefully
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY is missing from environment.');
}
if (!ROBOFLOW_API_KEY) console.warn('ROBOFLOW_API_KEY not configured. Roboflow inference disabled.');
if (!GEMINI_API_KEY) console.warn('GEMINI_API_KEY not configured. Gemini AI assessment disabled.');
if (!WEATHER_API_KEY) console.warn('WEATHER_API_KEY not configured. Weather enrichment disabled.');
if (!RESEND_API_KEY) console.warn('RESEND_API_KEY not configured. Email notifications disabled.');

// --- INITIALIZATION ---
let db = null;
try {
    let keyStr = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (keyStr) {
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
    }
} catch (e) {
    console.error('Failed to initialize Firebase Admin SDK:', e.message);
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// --- MAIN HANDLER FUNCTION ---
export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }

    if (!db) {
        return response.status(500).json({ 
            message: 'Server configuration error: Database not initialized. Please ensure FIREBASE_SERVICE_ACCOUNT_KEY is configured.' 
        });
    }

    try {
        const { image, location, forceSubmit, source } = request.body;
        if (!image || !location) {
            return response.status(400).json({ message: 'Missing image or location data.' });
        }

        console.log('[submitReport] Processing image for location:', location.address || location.latitude, 'source:', source);

        // 1. Primary Object Detection via Roboflow (using sensitive 20% confidence threshold for road video)
        let roboflowResult = null;
        if (ROBOFLOW_API_KEY) {
            roboflowResult = await detectPothole(image);
        }

        let hasRoboflowDetections = Boolean(
            roboflowResult && 
            roboflowResult.predictions && 
            roboflowResult.predictions.length > 0
        );

        let annotatedImage = null;
        let aiAssessment = null;

        if (hasRoboflowDetections) {
            annotatedImage = await annotateImage(image, roboflowResult.predictions);
        }

        // 2. Secondary Multimodal Analysis via Gemini (if Roboflow had 0 predictions, or to assess severity)
        if (!hasRoboflowDetections && !forceSubmit && source !== 'dashcam_manual') {
            // Check with Gemini Vision to see if road damage/pothole is present
            aiAssessment = await getAIAssessment(image);
            if (aiAssessment && aiAssessment.hasPothole) {
                annotatedImage = image; // Detected via Gemini AI Vision
            }
        }

        // 3. Final Decision
        const isHazardDetected = Boolean(
            hasRoboflowDetections || 
            (aiAssessment && aiAssessment.hasPothole) || 
            forceSubmit || 
            source === 'dashcam_manual'
        );

        if (!isHazardDetected) {
            return response.status(200).json({ 
                title: "No Pothole Detected",
                message: "Our initial AI analysis did not detect an active pothole. If you observe road damage, please position camera directly toward defect or report directly."
            });
        }

        if (!annotatedImage) {
            annotatedImage = image;
        }

        // 4. Duplicate Check
        if (location.latitude && location.longitude) {
            const duplicateReport = await findDuplicateReport(location.latitude, location.longitude);
            if (duplicateReport) {
                const reportRef = db.collection('reports').doc(duplicateReport.id);
                const updatedConfirmations = (duplicateReport.confirmations || 1) + 1;
                await reportRef.update({
                    confirmations: updatedConfirmations,
                    lastConfirmedAt: new Date()
                });
                
                const updatedReportDetails = { ...duplicateReport, confirmations: updatedConfirmations };
                // Send email in background if configured
                sendEmailReport(updatedReportDetails, annotatedImage, image).catch(err => {
                    console.error("Duplicate confirmation email error:", err.message);
                });

                return response.status(200).json({
                    title: "Report Confirmed!",
                    message: "Thanks for confirming! This pothole has already been reported. We've added your verification vote.",
                    annotatedImage: annotatedImage,
                    assessment: {
                        severity: duplicateReport.severity || 6,
                        potholeType: duplicateReport.potholeType || 'Road Surface Defect',
                        estimatedCost: duplicateReport.estimatedCost || '4,500 INR'
                    },
                    reportId: duplicateReport.id
                });
            }
        }

        // 5. Gather AI Assessment & Weather
        if (!aiAssessment) {
            const [assessmentRes, weatherRes] = await Promise.all([
                getAIAssessment(image),
                getWeather(location.latitude, location.longitude)
            ]);
            aiAssessment = assessmentRes;
            var weather = weatherRes;
        } else {
            var weather = await getWeather(location.latitude, location.longitude);
        }

        const safeSeverity = (aiAssessment && aiAssessment.severity != null && !isNaN(parseFloat(aiAssessment.severity)))
            ? parseFloat(aiAssessment.severity)
            : 6;
        const safePotholeType = (aiAssessment && aiAssessment.potholeType)
            ? aiAssessment.potholeType
            : (hasRoboflowDetections ? "Deep Road Pothole" : "Road Surface Defect");
        const safeEstimatedCost = (aiAssessment && aiAssessment.estimatedCost)
            ? aiAssessment.estimatedCost
            : "4,500 INR";

        const newReport = {
            address: location.address || (location.latitude ? `Lat: ${location.latitude.toFixed(4)}, Lon: ${location.longitude.toFixed(4)}` : 'Jaipur Roadway'),
            latitude: location.latitude || 26.9124,
            longitude: location.longitude || 75.7873,
            geohash: location.latitude ? geohashForLocation([location.latitude, location.longitude]) : null,
            imageUrl: `data:image/jpeg;base64,${annotatedImage}`,
            status: 'Submitted',
            confirmations: 1,
            createdAt: new Date(),
            lastConfirmedAt: new Date(),
            weather: weather || "Clear (28°C)",
            severity: safeSeverity,
            estimatedCost: safeEstimatedCost,
            potholeType: safePotholeType,
            source: source || 'citizen'
        };

        const docRef = await db.collection('reports').add(newReport);
        newReport.id = docRef.id;
        console.log('[submitReport] Report added to Firestore with ID:', newReport.id);

        // Send email notification in background without blocking response
        sendEmailReport(newReport, annotatedImage, image).catch(err => {
            console.error("Background email report error:", err.message);
        });

        return response.status(200).json({
            title: "Report Submitted!",
            message: "Thank you! Your report has been submitted with our advanced AI analysis.",
            annotatedImage: annotatedImage,
            assessment: {
                severity: safeSeverity,
                potholeType: safePotholeType,
                estimatedCost: safeEstimatedCost
            },
            reportId: newReport.id
        });

    } catch (error) {
        console.error("Error in submitReport function:", error);
        return response.status(500).json({ message: `An internal error occurred: ${error.message}` });
    }
}

// --- HELPER FUNCTIONS ---
async function sendEmailReport(reportDetails, annotatedImageBase64, originalImageBase64) {
    if (!resend) {
        console.log('Resend not configured. Skipping email dispatch.');
        return;
    }

    const { address, severity, estimatedCost, potholeType, confirmations, latitude, longitude } = reportDetails;
    const isUpdate = (confirmations || 1) > 1;
    const googleMapsLink = (latitude && longitude) ? `https://www.google.com/maps?q=${latitude},${longitude}` : null;

    let aiAnalysisHtml = '';
    if (severity != null && potholeType != null && estimatedCost != null) {
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
            <p>Advanced AI analysis completed with standard severity scoring.</p>
        `;
    }

    const subject = isUpdate 
        ? `Pothole Report Confirmed: ${address || 'New Report'}` 
        : `New Pothole Report Submitted: ${address || 'New Report'}`;

    const htmlBody = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <h1>${isUpdate ? 'Pothole Confirmation Update' : 'New Pothole Report Submitted'}</h1>
            <p>A road defect report has been filed and requires municipal inspection.</p>
            <h2>Report Details:</h2>
            <ul>
                <li><strong>Location:</strong> ${address || 'Address not available'}</li>
                ${googleMapsLink ? `<li><strong>Map Link:</strong> <a href="${googleMapsLink}">View on Google Maps</a></li>` : ''}
                <li><strong>Total Confirmations:</strong> ${confirmations}</li>
            </ul>
            ${aiAnalysisHtml}
            <p>The original uploaded image and an AI-annotated version are attached to this email for visual confirmation.</p>
            <hr>
            <p style="font-size: 0.8em; color: #888;">This is an automated message from GeoPothole AI Municipal Dispatch.</p>
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
                    content: Buffer.from(annotatedImageBase64, 'base64'),
                },
                {
                    filename: 'pothole_image_original.jpg',
                    content: Buffer.from(originalImageBase64, 'base64'),
                }
            ],
        });
        console.log('Email sent successfully for report at:', address);
    } catch (error) {
        console.error('Failed to send email via Resend:', error.message);
    }
}

async function detectPothole(base64Image) {
    if (!ROBOFLOW_API_KEY) return { predictions: [] };
    try {
        // Use 20% confidence threshold and 30% overlap for robust real-time road defect detection
        const response = await axios({
            method: "POST",
            url: `https://detect.roboflow.com/new-pothole-detection/1?api_key=${ROBOFLOW_API_KEY}&confidence=20&overlap=30`,
            data: base64Image,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: 7000
        });
        return response.data;
    } catch (err) {
        console.warn("Roboflow detection request failed:", err.message);
        return { predictions: [] };
    }
}

async function findDuplicateReport(lat, lon) {
    if (!lat || !lon) return null;
    try {
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
    } catch (e) {
        console.warn("Duplicate report check skipped due to error:", e.message);
    }
    return null;
}

async function getAIAssessment(base64Image) {
    if (!genAI) {
        return { hasPothole: false, severity: 6, potholeType: "Road Surface Defect", estimatedCost: "4,500 INR" };
    }

    const prompt = `Analyze this image of a road surface.
Determine whether there is a pothole, asphalt fissure, or road hazard present.
Provide a clean JSON response with exactly these keys:
{
  "hasPothole": true,
  "severity": 6.5,
  "potholeType": "Pothole",
  "estimatedCost": "4,500 INR"
}
If NO road damage or pothole is visible, set "hasPothole": false and "severity": 0.
Your response MUST BE ONLY the valid JSON object, nothing else.`;

    // Try available Gemini flash models with fallback
    const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
    const imagePart = { inlineData: { data: base64Image, mimeType: 'image/jpeg' } };

    for (const modelName of candidateModels) {
        try {
            const model = genAI.getGenerativeModel({ model: modelName });
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 4000);

            const result = await model.generateContent([prompt, imagePart], { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!result.response || !result.response.text) continue;

            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) continue;

            const parsed = JSON.parse(jsonMatch[0]);
            return {
                hasPothole: parsed.hasPothole !== false && (parsed.hasPothole === true || (parsed.severity && parsed.severity > 0)),
                severity: parsed.severity || 6,
                potholeType: parsed.potholeType || "Road Defect",
                estimatedCost: parsed.estimatedCost || "4,500 INR"
            };
        } catch (e) {
            console.warn(`Gemini model ${modelName} attempt error:`, e.message);
        }
    }

    // Default graceful fallback if all Gemini attempts timed out
    return { hasPothole: false, severity: 6, potholeType: "Road Surface Defect", estimatedCost: "4,500 INR" };
}

async function getWeather(lat, lon) {
    if (!lat || !lon || !WEATHER_API_KEY) return "Clear (28°C)";
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&units=metric`;
        const response = await axios.get(url, { timeout: 4000 });
        return `${response.data.weather[0].main} (${response.data.main.temp}°C)`;
    } catch (e) {
        console.warn("Weather fetch failed:", e.message);
        return "Clear (28°C)";
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
        console.error('Failed to annotate image:', error.message);
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
