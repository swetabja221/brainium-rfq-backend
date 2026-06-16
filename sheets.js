const { google } = require('googleapis');

/**
 * Syncs requirements and vendors to Google Sheets.
 * Requires env vars: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID
 *
 * Setup:
 *   1. Create a Service Account in Google Cloud Console
 *   2. Enable Google Sheets API
 *   3. Share your Google Sheet with the service account email (Editor access)
 *   4. Copy the Sheet ID from the URL: docs.google.com/spreadsheets/d/SHEET_ID/edit
 */
async function syncToSheets({ requirements, vendors }) {
  if (!process.env.GOOGLE_SHEET_ID || process.env.GOOGLE_SHEET_ID === 'YOUR_SHEET_ID') {
    console.log('[MOCK SHEETS] Google Sheets not configured. Would sync', requirements.length, 'requirements and', vendors.length, 'vendors.');
    return { success: true, mock: true };
  }

  const auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  // ── Requirements sheet ──────────────────────────────────
  const reqRows = [
    ['ID', 'Title', 'Client', 'BDM', 'Tech Stack', 'Type', 'Status', 'Date', 'Description', 'Quote Count', 'Created At'],
    ...requirements.map(r => [
      r.id, r.title, r.client, r.bdm, r.tech, r.type, r.status,
      r.date, r.description, (r.quotes || []).length, r.created_at,
    ]),
  ];

  // ── Vendors sheet ───────────────────────────────────────
  const vendorRows = [
    ['ID', 'Name', 'Company', 'Email', 'Tech Stack', 'City', 'Type', 'Contact'],
    ...vendors.map(v => [v.id, v.name, v.company, v.email, v.tech, v.city, v.type, v.contact]),
  ];

  // ── Quotations sheet ────────────────────────────────────
  const allQuotes = requirements.flatMap(r =>
    (r.quotes || []).map(q => [
      q.id, r.title, q.vendor_name, q.amount, q.num_developers,
      q.hours, q.timeline, q.notes, q.created_at,
    ])
  );
  const quotationRows = [
    ['ID', 'Requirement', 'Vendor', 'Amount', 'Developers', 'Hours', 'Timeline', 'Notes', 'Created At'],
    ...allQuotes,
  ];

  // Write to sheets (upsert approach — clear then write)
  await writeSheet(sheets, spreadsheetId, 'Requirements', reqRows);
  await writeSheet(sheets, spreadsheetId, 'Vendors', vendorRows);
  await writeSheet(sheets, spreadsheetId, 'Quotations', quotationRows);

  return { success: true, synced: { requirements: requirements.length, vendors: vendors.length, quotes: allQuotes.length } };
}

async function writeSheet(sheets, spreadsheetId, sheetName, rows) {
  // Try to create the sheet tab if it doesn't exist
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  } catch (_) { /* Sheet already exists, that's fine */ }

  // Clear and write
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A1:Z10000`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

module.exports = { syncToSheets };
