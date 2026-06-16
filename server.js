require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { query, execute, init, uuidv4 } = require('./database');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── REQUIREMENTS ──────────────────────────────────────────
app.get('/api/requirements', async (req, res) => {
  try {
    const reqs = await query('SELECT * FROM requirements ORDER BY created_at DESC');
    const quotes = await query('SELECT * FROM quotations');
    const map = {};
    quotes.forEach(q => { if (!map[q.requirement_id]) map[q.requirement_id] = []; map[q.requirement_id].push({ ...q, is_winner: q.is_winner === 1 || q.is_winner === true }); });
    res.json(reqs.map(r => ({ ...r, quotes: map[r.id] || [] })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/requirements', async (req, res) => {
  try {
    const { title, client, bdm, tech, type, status, date, description } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title required' });
    const id = uuidv4();
    await execute('INSERT INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, title, client||'', bdm||'', tech||'', type||'FD', status||'Pending', date||new Date().toISOString().slice(0,10), description||'']);
    res.json({ id, title, client, bdm, tech, type, status, date, description, quotes: [], created_at: new Date().toISOString() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/requirements/:id', async (req, res) => {
  try {
    const { title, client, bdm, tech, type, status, description } = req.body;
    await execute('UPDATE requirements SET title=COALESCE(?,title), client=COALESCE(?,client), bdm=COALESCE(?,bdm), tech=COALESCE(?,tech), type=COALESCE(?,type), status=COALESCE(?,status), description=COALESCE(?,description) WHERE id=?',
      [title, client, bdm, tech, type, status, description, req.params.id]);
    const rows = await query('SELECT * FROM requirements WHERE id=?', [req.params.id]);
    res.json(rows[0] || {});
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/requirements/:id', async (req, res) => {
  try {
    await execute('DELETE FROM quotations WHERE requirement_id=?', [req.params.id]);
    await execute('DELETE FROM requirements WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── QUOTATIONS ────────────────────────────────────────────
app.post('/api/requirements/:id/quotations', async (req, res) => {
  try {
    const { vendor_name, vendor_id, amount, num_developers, hours, timeline, notes } = req.body;
    if (!vendor_name || !amount) return res.status(400).json({ error: 'Vendor and amount required' });
    const id = uuidv4();
    await execute('INSERT INTO quotations (id,requirement_id,vendor_id,vendor_name,amount,num_developers,hours,timeline,notes,is_winner) VALUES (?,?,?,?,?,?,?,?,?,0)',
      [id, req.params.id, vendor_id||'', vendor_name, amount, num_developers||'', hours||'', timeline||'', notes||'']);
    res.json({ id, requirement_id: req.params.id, vendor_name, amount, num_developers, hours, timeline, notes, is_winner: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/quotations/:id', async (req, res) => {
  try {
    await execute('DELETE FROM quotations WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/quotations/:id/winner', async (req, res) => {
  try {
    const { requirement_id } = req.body;
    await execute('UPDATE quotations SET is_winner=0 WHERE requirement_id=?', [requirement_id]);
    await execute('UPDATE quotations SET is_winner=1 WHERE id=?', [req.params.id]);
    await execute("UPDATE requirements SET status='Closed' WHERE id=?", [requirement_id]);
    const rows = await query('SELECT * FROM quotations WHERE id=?', [req.params.id]);
    res.json({ ...rows[0], is_winner: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VENDORS ───────────────────────────────────────────────
app.get('/api/vendors', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM vendors ORDER BY name ASC');
    res.json(rows.map(v => ({ ...v, blacklisted: v.blacklisted === 1 || v.blacklisted === true })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vendors', async (req, res) => {
  try {
    const { name, company, email, tech, city, type, contact } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    await execute('INSERT INTO vendors (id,name,company,email,tech,city,type,contact,blacklisted,blacklist_reason) VALUES (?,?,?,?,?,?,?,?,0,?)',
      [id, name, company||'', email||'', tech||'', city||'', type||'Company', contact||'', '']);
    res.json({ id, name, company, email, tech, city, type, contact, blacklisted: false, blacklist_reason: '' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/vendors/:id', async (req, res) => {
  try {
    const { name, company, email, tech, city, type, contact } = req.body;
    await execute('UPDATE vendors SET name=COALESCE(?,name), company=COALESCE(?,company), email=COALESCE(?,email), tech=COALESCE(?,tech), city=COALESCE(?,city), type=COALESCE(?,type), contact=COALESCE(?,contact) WHERE id=?',
      [name, company, email, tech, city, type, contact, req.params.id]);
    const rows = await query('SELECT * FROM vendors WHERE id=?', [req.params.id]);
    res.json({ ...rows[0], blacklisted: rows[0]?.blacklisted === 1 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vendors/:id', async (req, res) => {
  try {
    await execute('DELETE FROM vendors WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/vendors/:id/blacklist', async (req, res) => {
  try {
    const { reason } = req.body;
    await execute('UPDATE vendors SET blacklisted=1, blacklist_reason=?, blacklisted_at=? WHERE id=?',
      [reason||'', new Date().toISOString(), req.params.id]);
    const rows = await query('SELECT * FROM vendors WHERE id=?', [req.params.id]);
    res.json({ ...rows[0], blacklisted: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/vendors/:id/unblacklist', async (req, res) => {
  try {
    await execute('UPDATE vendors SET blacklisted=0, blacklist_reason=NULL, blacklisted_at=NULL WHERE id=?', [req.params.id]);
    const rows = await query('SELECT * FROM vendors WHERE id=?', [req.params.id]);
    res.json({ ...rows[0], blacklisted: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STATS ─────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const reqs = await query('SELECT status FROM requirements');
    const quotes = await query('SELECT COUNT(*) as c FROM quotations');
    const vendors = await query('SELECT COUNT(*) as c FROM vendors WHERE blacklisted=0');
    res.json({
      total: reqs.length,
      pending: reqs.filter(r => r.status === 'Pending').length,
      active: reqs.filter(r => ['CV Shared','Estimation given','In Progress'].includes(r.status)).length,
      closed: reqs.filter(r => r.status === 'Closed').length,
      quotes: quotes[0]?.c || 0,
      vendors: vendors[0]?.c || 0,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ANALYTICS ─────────────────────────────────────────────
app.get('/api/analytics', async (req, res) => {
  try {
    const quotations = await query('SELECT * FROM quotations');
    const requirements = await query('SELECT * FROM requirements');

    const vendorMap = {};
    quotations.forEach(q => {
      if (!vendorMap[q.vendor_name]) vendorMap[q.vendor_name] = { name: q.vendor_name, quotes: 0, won: 0, amounts: [], requirements: new Set() };
      vendorMap[q.vendor_name].quotes++;
      vendorMap[q.vendor_name].requirements.add(q.requirement_id);
      if (q.is_winner === 1 || q.is_winner === true) vendorMap[q.vendor_name].won++;
      if (q.amount) vendorMap[q.vendor_name].amounts.push(q.amount);
    });
    const vendorStats = Object.values(vendorMap).map(v => ({
      name: v.name, quotes: v.quotes, won: v.won, projects: v.requirements.size,
      winRate: v.quotes > 0 ? Math.round((v.won / v.quotes) * 100) : 0,
      latestAmount: v.amounts[v.amounts.length - 1] || '—',
    })).sort((a, b) => b.quotes - a.quotes);

    const bdmMap = {};
    requirements.forEach(r => {
      const bdm = r.bdm || 'Unknown';
      if (!bdmMap[bdm]) bdmMap[bdm] = { name: bdm, total: 0, closed: 0, pending: 0 };
      bdmMap[bdm].total++;
      if (r.status === 'Closed') bdmMap[bdm].closed++;
      if (r.status === 'Pending') bdmMap[bdm].pending++;
    });
    const bdmStats = Object.values(bdmMap).sort((a, b) => b.total - a.total);

    res.json({ vendorStats, bdmStats });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EMAIL LOG ─────────────────────────────────────────────
app.get('/api/email-log', async (req, res) => {
  try {
    const logs = await query('SELECT * FROM rfq_emails ORDER BY sent_at DESC');
    res.json(logs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SEND RFQ ──────────────────────────────────────────────
app.post('/api/send-rfq', async (req, res) => {
  try {
    const { requirement_id, vendor_ids, subject, body, attachment_name } = req.body;
    const allVendors = await query('SELECT * FROM vendors WHERE blacklisted=0');
    const selected = allVendors.filter(v => vendor_ids.includes(v.id) && v.email);
    const vendorEmails = selected.map(v => v.email);
    let emailResult = { success: false, message: 'Gmail not configured' };

    if (process.env.GMAIL_USER && process.env.GMAIL_CLIENT_ID && process.env.GMAIL_REFRESH_TOKEN) {
      try {
        const nodemailer = require('nodemailer');
        const { google } = require('googleapis');
        const oauth2Client = new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, 'https://developers.google.com/oauthplayground');
        oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
        const { token } = await oauth2Client.getAccessToken();
        const transporter = nodemailer.createTransport({ service: 'gmail', auth: { type: 'OAuth2', user: process.env.GMAIL_USER, clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET, refreshToken: process.env.GMAIL_REFRESH_TOKEN, accessToken: token } });
        await transporter.sendMail({ from: process.env.GMAIL_USER, bcc: vendorEmails.join(','), subject: subject || 'RFQ from Brainium', text: body || '' });
        emailResult = { success: true, sent_to: vendorEmails };
      } catch(emailErr) {
        emailResult = { success: false, message: emailErr.message };
      }
    }

    const logId = uuidv4();
    await execute('INSERT INTO rfq_emails (id,requirement_id,vendor_emails,subject,body,status,attachment_name,error_message) VALUES (?,?,?,?,?,?,?,?)',
      [logId, requirement_id||'', vendorEmails.join(','), subject||'', body||'', emailResult.success?'sent':'failed', attachment_name||'', emailResult.message||'']);

    res.json({ ...emailResult, logged: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SYNC (stub) ───────────────────────────────────────────
app.post('/api/sync/sheets', async (req, res) => {
  res.json({ mock: true, message: 'Google Sheets sync not configured' });
});

// ── START ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
init().then(() => {
  app.listen(PORT, () => console.log(`Brainium RFQ backend running on port ${PORT}`));
}).catch(err => {
  console.error('Failed to init database:', err);
  process.exit(1);
});
