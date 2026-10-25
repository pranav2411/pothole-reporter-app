import fs from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { Resend } from 'resend';

// Manual .env parser to avoid external dependencies like dotenv
if (fs.existsSync('.env')) {
    const content = fs.readFileSync('.env', 'utf-8');
    // Simple regex to parse KEY=VAL (handling multi-line JSON values wrapped in quotes)
    const matches = content.matchAll(/^\s*([\w.\-]+)\s*=\s*(['"]?)([\s\S]*?)\2\s*$/gm);
    for (const match of matches) {
        let val = match[3] || '';
        process.env[match[1]] = val;
    }
}

console.log("=== GeoPothole AI: API Credential Diagnostics ===");

// 1. Check Env variables existence
const required = ['FIREBASE_SERVICE_ACCOUNT_KEY', 'GEMINI_API_KEY', 'ROBOFLOW_API_KEY', 'WEATHER_API_KEY', 'RESEND_API_KEY'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error(`❌ Missing Environment Variables in .env: ${missing.join(', ')}`);
    process.exit(1);
} else {
    console.log("✅ All required environment variables are present in .env");
}

async function testFirebase() {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        if (!getApps().length) {
            initializeApp({ credential: cert(serviceAccount) });
        }
        const db = getFirestore();
        // Try reading a test collection
        await db.collection('reports').limit(1).get();
        console.log("✅ Firebase Firestore: Connection successful!");
    } catch (e) {
        console.error("❌ Firebase Firestore: Connection failed!", e.message);
    }
}

async function testGemini() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
        const result = await model.generateContent("Respond with only the word 'OK'.");
        const text = result.response.text().trim();
        if (text.includes("OK") || text.length > 0) {
            console.log(`✅ Google Gemini AI: Connection successful! (Response: '${text}')`);
        } else {
            throw new Error("Invalid response received");
        }
    } catch (e) {
        console.error("❌ Google Gemini AI: Authentication failed!", e.message);
    }
}

async function testWeather() {
    try {
        const key = process.env.WEATHER_API_KEY;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=26.9124&lon=75.7873&appid=${key}`;
        const response = await axios.get(url);
        if (response.data && response.data.weather) {
            console.log(`✅ OpenWeatherMap: Connection successful! (City: ${response.data.name}, Temp: ${(response.data.main.temp - 273.15).toFixed(1)}°C)`);
        } else {
            throw new Error("Invalid response structure");
        }
    } catch (e) {
        console.error("❌ OpenWeatherMap: Request failed!", e.message);
    }
}

async function testRoboflow() {
    try {
        const key = process.env.ROBOFLOW_API_KEY;
        const url = `https://detect.roboflow.com/new-pothole-detection/1?api_key=${key}`;
        const response = await axios.post(url, "", {
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        }).catch(err => {
            return err.response;
        });
        
        if (response && response.status !== 401 && response.status !== 403) {
            console.log("✅ Roboflow API Key: Authentication successful!");
        } else {
            throw new Error("Unauthorized (Invalid API Key)");
        }
    } catch (e) {
        console.error("❌ Roboflow API: Verification failed!", e.message);
    }
}

async function testResend() {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const response = await resend.domains.list();
        if (response.data) {
            console.log("✅ Resend Email Service: Authentication successful!");
        } else if (response.error && response.error.name === 'restricted_api_key') {
            console.log("✅ Resend Email Service: Authentication successful! (Note: Key is restricted to sending only, which is perfect for this app)");
        } else {
            throw new Error(response.error ? response.error.message : "Invalid response");
        }
    } catch (e) {
        console.error("❌ Resend Email Service: Connection failed!", e.message);
    }
}

async function runAll() {
    await testFirebase();
    await testGemini();
    await testWeather();
    await testRoboflow();
    await testResend();
    console.log("=== Diagnostics Completed ===");
}

runAll();
