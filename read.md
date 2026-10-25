Advanced Pothole App: Setup & Deployment Guide
Your application is now a full-stack platform. Follow these steps carefully to set up all the necessary services and deploy your project.

Part 1: Firebase Setup (Database)
First, follow the Firebase_Setup_Guide.md you already have. This will get your database created and configured with the correct security rules. Once done, you need one more thing from Firebase:

1. Create a Service Account Key:

In your Firebase project, click the gear icon > Project settings.

Go to the "Service accounts" tab.

Click "Generate new private key". A JSON file will be downloaded.

Open this JSON file, copy its entire contents. You will need this for the FIREBASE_SERVICE_ACCOUNT_KEY environment variable later.

Part 2: Google AI (Gemini) Setup
Go to the Google AI Studio.

Click "Get API key" and then "Create API key in new project".

Copy the generated API key. This is your GEMINI_API_KEY.

Part 3: OpenWeatherMap Setup
Go to OpenWeatherMap and create a free account.

Once logged in, go to the "API keys" tab in your dashboard.

Copy your default API key. This is your WEATHER_API_KEY.

Part 4: Final Vercel Deployment
Structure Your Project: Make sure your local folder has this exact structure:

/
├── api/
│   ├── getReports.js
│   └── submitReport.js
├── package.json
└── index.html

Upload to GitHub: Upload this entire project structure to a new GitHub repository.

Deploy on Vercel:

Log in to Vercel and import this new GitHub repository.

Before clicking "Deploy", expand the "Environment Variables" section. You can configure these keys:

| Environment Variable | Description | Requirement |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Entire contents of your downloaded Firebase service account JSON key file | **Required** (Database) |
| `ROBOFLOW_API_KEY` | Roboflow API key for real-time YOLO pothole detection (e.g. `djY6VSuRnjsR4C3waivR`) | Recommended |
| `GEMINI_API_KEY` | Google AI Studio API Key for Gemini Flash AI damage assessment & dual-detection | Recommended |
| `WEATHER_API_KEY` | OpenWeatherMap API Key for live weather metadata | Optional |
| `RESEND_API_KEY` | Resend API Key for automated municipal email alerts (`re_...`) | Optional |

*Note: The app is built with graceful fallbacks. If any optional key (`RESEND_API_KEY`, `WEATHER_API_KEY`, etc.) is omitted, the app will continue to work seamlessly without crashing or throwing 500 errors.*

Click "Deploy".

Your advanced application is now live! It features continuous AI dashcam windshield scanning, dual YOLO + Gemini Vision pothole detection, citizen verification voting, proximity audio alerts, and real-time municipal synchronization.