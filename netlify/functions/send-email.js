// --- IMPORTS ---
// We need to use 'resend' to send emails.
// Netlify functions run on Node.js, so we can import packages.
import { Resend } from 'resend';

// The handler function is what Netlify will run when this endpoint is called.
export async function handler(event) {
    // --- SECURITY & SETUP ---
    // Get the Resend API key from an environment variable.
    // This is the SECURE way to store secrets.
    const resend = new Resend(process.env.RESEND_API_KEY);
    const EMAIL_FROM = 'onboarding@resend.dev';

    // --- DATA PARSING ---
    // The data sent from the frontend (HTML file) comes in the 'body' of the event.
    // We need to parse it from a string into a JSON object.
    const { to, subject, html } = JSON.parse(event.body);

    // Basic validation to ensure we have the data we need.
    if (!to || !subject || !html) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Missing required email fields.' }),
        };
    }

    // --- EMAIL SENDING ---
    try {
        // Use the Resend client to send the email with the data we received.
        await resend.emails.send({
            from: EMAIL_FROM,
            to: to,
            subject: subject,
            html: html,
        });

        // If the email sends successfully, return a success message.
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Email sent successfully!' }),
        };
    } catch (error) {
        // If there's an error sending the email, log it and return an error message.
        console.error('Error sending email:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Failed to send email.' }),
        };
    }
}

