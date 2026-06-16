const nodemailer = require('nodemailer');
const { google } = require('googleapis');

/**
 * Sends RFQ email via Gmail using OAuth2.
 * Requires env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER
 * To set these up:
 *   1. Go to https://console.cloud.google.com/
 *   2. Create OAuth2 credentials (Desktop app)
 *   3. Enable Gmail API
 *   4. Use OAuth2 Playground to get refresh token for your Gmail account
 */
async function sendRFQEmail({ to, subject, body, requirement }) {
  // If credentials not configured, return mock success for development
  if (!process.env.GMAIL_CLIENT_ID || process.env.GMAIL_CLIENT_ID === 'YOUR_CLIENT_ID') {
    console.log(`[MOCK EMAIL] To: ${to.join(', ')}\nSubject: ${subject}\n`);
    return { success: true, message: `Email logged (Gmail not configured). Would send to: ${to.join(', ')}` };
  }

  try {
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oAuth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    const { token: accessToken } = await oAuth2Client.getAccessToken();

    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.GMAIL_USER,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        accessToken,
      },
    });

    const mailOptions = {
      from: `Brainium Sales Team <${process.env.GMAIL_USER}>`,
      bcc: to.join(', '),  // BCC so vendors don't see each other
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>').replace(
        'Brainium Sales Team',
        '<strong>Brainium Sales Team</strong>'
      ),
    };

    const result = await transport.sendMail(mailOptions);
    return { success: true, message: `Sent to ${to.length} vendor(s). Message ID: ${result.messageId}` };
  } catch (error) {
    console.error('Gmail send error:', error.message);
    return { success: false, message: error.message };
  }
}

module.exports = { sendRFQEmail };
