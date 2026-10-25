import http from 'http';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { fileURLToPath } from 'url';

try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Load .env file into process.env if present
if (fs.existsSync(path.join(__dirname, '.env'))) {
    const content = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8');
    const matches = content.matchAll(/^\s*([\w.\-]+)\s*=\s*(['"]?)([\s\S]*?)\2\s*$/gm);
    for (const match of matches) {
        if (!process.env[match[1]]) {
            process.env[match[1]] = match[3] || '';
        }
    }
}

// 2. Import serverless API handlers
const { default: getReportsHandler } = await import('./api/getReports.js');
const { default: submitReportHandler } = await import('./api/submitReport.js');
const { default: verifyReportHandler } = await import('./api/verifyReport.js');
const { default: updateReportStatusHandler } = await import('./api/updateReportStatus.js');
const { default: sendEmailHandler } = await import('./api/send-email.js');

const API_ROUTES = {
    '/api/getReports': getReportsHandler,
    '/api/submitReport': submitReportHandler,
    '/api/verifyReport': verifyReportHandler,
    '/api/updateReportStatus': updateReportStatusHandler,
    '/api/send-email': sendEmailHandler
};

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    // Add Vercel/Express-like helper functions to response
    res.status = function (code) {
        res.statusCode = code;
        return res;
    };
    res.json = function (data) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(data));
        return res;
    };

    // Parse URL path
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = urlObj.pathname;

    // Check if it's an API route
    if (API_ROUTES[pathname]) {
        let bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', async () => {
            const rawBody = Buffer.concat(bodyChunks).toString();
            if (rawBody && req.headers['content-type']?.includes('application/json')) {
                try {
                    req.body = JSON.parse(rawBody);
                } catch {
                    req.body = rawBody;
                }
            } else {
                req.body = rawBody ? rawBody : {};
            }

            try {
                await API_ROUTES[pathname](req, res);
            } catch (err) {
                console.error(`Error in ${pathname}:`, err);
                if (!res.writableEnded) {
                    res.status(500).json({ message: 'Internal Server Error', error: err.message });
                }
            }
        });
        return;
    }

    // Default file routing for frontend
    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    } else if (pathname === '/admin') {
        pathname = '/admin.html';
    }

    const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(__dirname, safePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 GeoPothole AI App is running locally!`);
    console.log(`📱 Citizen App: http://localhost:${PORT}`);
    console.log(`🛠️ Admin Portal: http://localhost:${PORT}/admin`);
    console.log(`========================================\n`);
});
