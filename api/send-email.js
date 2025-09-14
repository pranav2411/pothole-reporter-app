// --- IMPORTS ---
import { Resend } from 'resend';

// The default export is what Vercel will run when this endpoint is called.
export default async function handler(request, response) {
    // --- SECURITY & SETUP ---
    // On Vercel, the handler takes (request, response) objects.
    // We only want to accept POST requests for this function.
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }
    
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
        console.error('RESEND_API_KEY environment variable not set.');
        return response.status(500).json({ message: 'Server configuration error: Missing API key.' });
    }
    const resend = new Resend(resendApiKey);
    const EMAIL_FROM = 'onboarding@resend.dev';

    // --- DATA PARSING ---
    // The data sent from the frontend is in the 'body' of the request.
    const { to, subject, html } = request.body;

    // Basic validation to ensure we have the data we need.
    if (!to || !subject || !html) {
        return response.status(400).json({ message: 'Missing required email fields (to, subject, or html).' });
    }

    // --- EMAIL SENDING ---
    try {
        const data = await resend.emails.send({
            from: EMAIL_FROM,
            to: to,
            subject: subject,
            html: html,
        });

        // If the email sends successfully, return a success message.
        return response.status(200).json({ message: 'Email sent successfully!', data });
    } catch (error) {
        // If there's an error sending the email, log it and return an error message.
        console.error('Error sending email via Resend:', error);
        return response.status(500).json({ message: 'Failed to send email.', error: error.message });
    }
}
