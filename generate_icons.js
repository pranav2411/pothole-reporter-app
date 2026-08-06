import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

function drawIcon(size, filename) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // 1. Draw rounded container background
    const radius = size * 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
    ctx.fill();

    // Subtle border
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = size * 0.02;
    ctx.stroke();

    // 2. Draw circular inner badge
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#eff6ff'; // light blue
    ctx.fill();
    ctx.strokeStyle = '#3b82f6'; // deep blue
    ctx.lineWidth = size * 0.04;
    ctx.stroke();

    // 3. Draw a stylized map-pin / road hazard logo inside
    const cx = size / 2;
    const cy = size / 2 - (size * 0.05);
    const r = size * 0.16;

    // Pin head circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#3b82f6';
    ctx.fill();

    // Pin needle/triangle base
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + (size * 0.28));
    ctx.closePath();
    ctx.fillStyle = '#3b82f6';
    ctx.fill();

    // Pin center punch hole (representing road pothole target)
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = '#eff6ff';
    ctx.fill();

    // Save to file
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filename, buffer);
    console.log(`Generated PWA icon asset: ${filename} (${size}x${size})`);
}

drawIcon(192, 'icon-192.png');
drawIcon(512, 'icon-512.png');
