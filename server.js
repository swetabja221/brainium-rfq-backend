require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { sendRFQEmail } = require('./mailer');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('../frontend/public'));

// ── REQUIREMENTS ──────────────────────────────────────────

app.get('/api/requirements', (req, res) => {
  try {
    const db = getDb();
    const reqs = db.all('SELECT * FROM requirements ORDER BY created_at DESC');
    // Attach quotes count to each
    for (const r of reqs) {
      const result = db.all('SELECT * FROM quotations WHERE requirement_id = ? ORDER BY created_at DESC', [r.id]);
      r.quotes = result;
    }
    res.json(reqs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/requirements/:id', (req, res) => {
  try {
    const db = getDb();
    const req_row = db.all('SELECT * FROM requirements WHERE id = ?', [req.params.id])[0];
    if (!req_row) return res.status(404).json({ error: 'Not found' });
    req_row.quotes = db.all('SELECT * FROM quotations WHERE requirement_id = ? ORDER BY created_at DESC', [req.params.id]);
    res.json(req_row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/requirements', (req, res) => {
  try {
    const db = getDb();
    const { title, client, bdm, tech, type, status, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const id = uuidv4();
    const date = new Date().toISOString().slice(0, 10);
    db.run('INSERT INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, title, client || '', bdm || '', tech || '', type || 'FD', status || 'Pending', date, description || '']);
    const newReq = db.all('SELECT * FROM requirements WHERE id = ?', [id])[0];
    newReq.quotes = [];
    res.status(201).json(newReq);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/requirements/:id', (req, res) => {
  try {
    const db = getDb();
    const fields = ['title', 'client', 'bdm', 'tech', 'type', 'status', 'description'];
    const updates = [];
    const values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(req.body[f]);
      }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    db.run(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, values);
    const updated = db.all('SELECT * FROM requirements WHERE id = ?', [req.params.id])[0];
    updated.quotes = db.all('SELECT * FROM quotations WHERE requirement_id = ?', [req.params.id]);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/requirements/:id', (req, res) => {
  try {
    const db = getDb();
    db.run('DELETE FROM quotations WHERE requirement_id = ?', [req.params.id]);
    db.run('DELETE FROM requirements WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── VENDORS ──────────────────────────────────────────────

app.get('/api/vendors', (req, res) => {
  try {
    const db = getDb();
    res.json(db.all('SELECT * FROM vendors ORDER BY name ASC'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/vendors', (req, res) => {
  try {
    const db = getDb();
    const { name, company, email, tech, city, type, contact } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const id = uuidv4();
    db.run('INSERT INTO vendors (id,name,company,email,tech,city,type,contact) VALUES (?,?,?,?,?,?,?,?)',
      [id, name, company || '', email || '', tech || '', city || '', type || 'Company', contact || '']);
    res.status(201).json(db.all('SELECT * FROM vendors WHERE id = ?', [id])[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/vendors/:id', (req, res) => {
  try {
    const db = getDb();
    const fields = ['name', 'company', 'email', 'tech', 'city', 'type', 'contact'];
    const updates = [], values = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields' });
    values.push(req.params.id);
    db.run(`UPDATE vendors SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json(db.all('SELECT * FROM vendors WHERE id = ?', [req.params.id])[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/vendors/:id', (req, res) => {
  try {
    const db = getDb();
    db.run('DELETE FROM vendors WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── QUOTATIONS ───────────────────────────────────────────

app.post('/api/requirements/:id/quotations', (req, res) => {
  try {
    const db = getDb();
    const { vendor_name, vendor_id, amount, num_developers, hours, timeline, notes } = req.body;
    if (!vendor_name || !amount) return res.status(400).json({ error: 'vendor_name and amount required' });
    const qid = uuidv4();
    db.run('INSERT INTO quotations (id,requirement_id,vendor_id,vendor_name,amount,num_developers,hours,timeline,notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [qid, req.params.id, vendor_id || null, vendor_name, amount, num_developers || '', hours || '—', timeline || '—', notes || '']);
    res.status(201).json(db.all('SELECT * FROM quotations WHERE id = ?', [qid])[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/quotations/:id', (req, res) => {
  try {
    const db = getDb();
    db.run('DELETE FROM quotations WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── EMAIL / RFQ ───────────────────────────────────────────

app.post('/api/send-rfq', async (req, res) => {
  try {
    const db = getDb();
    const { requirement_id, vendor_ids, subject, body, additional_notes } = req.body;
    if (!requirement_id || !vendor_ids?.length) {
      return res.status(400).json({ error: 'requirement_id and vendor_ids required' });
    }
    const req_row = db.all('SELECT * FROM requirements WHERE id = ?', [requirement_id])[0];
    if (!req_row) return res.status(404).json({ error: 'Requirement not found' });

    const placeholders = vendor_ids.map(() => '?').join(',');
    const vendors = db.all(`SELECT * FROM vendors WHERE id IN (${placeholders})`, vendor_ids);
    const vendorEmails = vendors.filter(v => v.email).map(v => v.email);

    if (!vendorEmails.length) {
      return res.status(400).json({ error: 'No valid email addresses for selected vendors' });
    }

    const emailResult = await sendRFQEmail({
      to: vendorEmails,
      subject: subject || `RFQ: ${req_row.title}`,
      body: body || buildDefaultBody(req_row, additional_notes),
      requirement: req_row,
    });

    const logId = uuidv4();
    db.run('INSERT INTO rfq_emails (id,requirement_id,vendor_emails,subject,body,status) VALUES (?,?,?,?,?,?)',
      [logId, requirement_id, vendorEmails.join(','), subject || `RFQ: ${req_row.title}`, body || '', emailResult.success ? 'sent' : 'failed']);

    res.json({ success: emailResult.success, message: emailResult.message, sent_to: vendorEmails });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GOOGLE SHEETS SYNC ────────────────────────────────────

app.post('/api/sync/sheets', async (req, res) => {
  try {
    const { syncToSheets } = require('./sheets');
    const db = getDb();
    const reqs = db.all('SELECT * FROM requirements ORDER BY created_at DESC');
    for (const r of reqs) r.quotes = db.all('SELECT * FROM quotations WHERE requirement_id = ?', [r.id]);
    const vendors = db.all('SELECT * FROM vendors ORDER BY name ASC');
    await syncToSheets({ requirements: reqs, vendors });
    res.json({ success: true, message: 'Synced to Google Sheets successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STATS ─────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try {
    const db = getDb();
    const total = db.all('SELECT COUNT(*) as c FROM requirements')[0].c;
    const pending = db.all("SELECT COUNT(*) as c FROM requirements WHERE status = 'Pending'")[0].c;
    const active = db.all("SELECT COUNT(*) as c FROM requirements WHERE status IN ('CV Shared','Estimation given','In Progress')")[0].c;
    const closed = db.all("SELECT COUNT(*) as c FROM requirements WHERE status = 'Closed'")[0].c;
    const quotes = db.all('SELECT COUNT(*) as c FROM quotations')[0].c;
    const vendors = db.all('SELECT COUNT(*) as c FROM vendors')[0].c;
    res.json({ total, pending, active, closed, quotes, vendors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function buildDefaultBody(req, notes) {
  return `Dear Partner,

We hope this message finds you well.

Brainium is inviting bids for the following project requirement. Please review and provide your proposal with the details listed below.

Project: ${req.title}
Tech Stack: ${req.tech}
Contract Type: ${req.type}

${req.description}

Please provide:
• Price Quotation (website and mobile app separately if applicable)
• Showcase of similar projects
• Number of Developers Required
• Timeline for Completion

${notes ? 'Additional Notes:\n' + notes + '\n' : ''}
Kindly submit your proposal within 3 working days.

Best Regards,
Brainium Sales Team`;
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Brainium RFQ API running on http://localhost:${PORT}`));
