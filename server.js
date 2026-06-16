require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./database');
const { sendRFQEmail } = require('./mailer');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

function dbAll(sql, params = []) {
  const db = getDb();
  try { return db.all(sql, params); } catch(e) { return []; }
}
function dbRun(sql, params = []) {
  const db = getDb();
  const store = db._store;
  if (store) {
    // In-memory mode — parse the SQL manually
    if (sql.startsWith('INSERT INTO requirements')) {
      const r = { id:params[0],title:params[1],client:params[2],bdm:params[3],tech:params[4],type:params[5],status:params[6],date:params[7],description:params[8],created_at:new Date().toISOString() };
      store.requirements.unshift(r);
    } else if (sql.startsWith('INSERT INTO vendors')) {
      store.vendors.push({ id:params[0],name:params[1],company:params[2],email:params[3],tech:params[4],city:params[5],type:params[6],contact:params[7],created_at:new Date().toISOString() });
    } else if (sql.startsWith('INSERT INTO quotations')) {
      store.quotations.push({ id:params[0],requirement_id:params[1],vendor_id:params[2],vendor_name:params[3],amount:params[4],num_developers:params[5],hours:params[6],timeline:params[7],notes:params[8],created_at:new Date().toISOString() });
    } else if (sql.startsWith('UPDATE requirements')) {
      const id = params[params.length-1];
      const r = store.requirements.find(x=>x.id===id);
      if (r) {
        const fields = ['title','client','bdm','tech','type','status','description'];
        const setPart = sql.match(/SET (.+) WHERE/)[1];
        setPart.split(', ').forEach((f,i) => { const k=f.split(' = ')[0]; if(fields.includes(k)) r[k]=params[i]; });
      }
    } else if (sql.startsWith('UPDATE vendors')) {
      const id = params[params.length-1];
      const v = store.vendors.find(x=>x.id===id);
      if (v) { ['name','company','email','tech','city','type','contact'].forEach((k,i)=>{ if(params[i]!==undefined) v[k]=params[i]; }); }
    } else if (sql.startsWith('DELETE FROM quotations') && params.length) {
      store.quotations = store.quotations.filter(q=>q.id!==params[0] && q.requirement_id!==params[0]);
    } else if (sql.startsWith('DELETE FROM requirements')) {
      store.requirements = store.requirements.filter(r=>r.id!==params[0]);
      store.quotations = store.quotations.filter(q=>q.requirement_id!==params[0]);
    } else if (sql.startsWith('DELETE FROM vendors')) {
      store.vendors = store.vendors.filter(v=>v.id!==params[0]);
    }
    return;
  }
  try { db.run(sql, params); } catch(e) { console.error(e.message); }
}

function getStore() {
  const db = getDb();
  return db._store || null;
}

// ── REQUIREMENTS ──────────────────────────────────────────
app.get('/api/requirements', (req, res) => {
  try {
    const store = getStore();
    let reqs;
    if (store) {
      reqs = [...store.requirements];
      reqs.forEach(r => { r.quotes = store.quotations.filter(q=>q.requirement_id===r.id); });
    } else {
      reqs = dbAll('SELECT * FROM requirements ORDER BY created_at DESC');
      reqs.forEach(r => { r.quotes = dbAll('SELECT * FROM quotations WHERE requirement_id = ?', [r.id]); });
    }
    res.json(reqs);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/requirements/:id', (req, res) => {
  try {
    const store = getStore();
    let r;
    if (store) {
      r = store.requirements.find(x=>x.id===req.params.id);
      if (r) r.quotes = store.quotations.filter(q=>q.requirement_id===r.id);
    } else {
      r = dbAll('SELECT * FROM requirements WHERE id = ?', [req.params.id])[0];
      if (r) r.quotes = dbAll('SELECT * FROM quotations WHERE requirement_id = ?', [req.params.id]);
    }
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/requirements', (req, res) => {
  try {
    const { title, client, bdm, tech, type, status, description } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const id = uuidv4();
    const date = new Date().toISOString().slice(0,10);
    dbRun('INSERT INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, title, client||'', bdm||'', tech||'', type||'FD', status||'Pending', date, description||'']);
    const store = getStore();
    const newReq = store ? store.requirements.find(x=>x.id===id) : dbAll('SELECT * FROM requirements WHERE id = ?',[id])[0];
    newReq.quotes = [];
    res.status(201).json(newReq);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/requirements/:id', (req, res) => {
  try {
    const store = getStore();
    const fields = ['title','client','bdm','tech','type','status','description'];
    if (store) {
      const r = store.requirements.find(x=>x.id===req.params.id);
      if (!r) return res.status(404).json({ error: 'Not found' });
      fields.forEach(f => { if (req.body[f] !== undefined) r[f] = req.body[f]; });
      r.quotes = store.quotations.filter(q=>q.requirement_id===r.id);
      return res.json(r);
    }
    const updates = [], values = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
    if (!updates.length) return res.status(400).json({ error: 'No fields' });
    values.push(req.params.id);
    dbRun(`UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, values);
    const updated = dbAll('SELECT * FROM requirements WHERE id = ?', [req.params.id])[0];
    updated.quotes = dbAll('SELECT * FROM quotations WHERE requirement_id = ?', [req.params.id]);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/requirements/:id', (req, res) => {
  try {
    dbRun('DELETE FROM requirements', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VENDORS ──────────────────────────────────────────────
app.get('/api/vendors', (req, res) => {
  try {
    const store = getStore();
    res.json(store ? [...store.vendors].sort((a,b)=>a.name.localeCompare(b.name)) : dbAll('SELECT * FROM vendors ORDER BY name ASC'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vendors', (req, res) => {
  try {
    const { name, company, email, tech, city, type, contact } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    const id = uuidv4();
    dbRun('INSERT INTO vendors (id,name,company,email,tech,city,type,contact) VALUES (?,?,?,?,?,?,?,?)',
      [id, name, company||'', email||'', tech||'', city||'', type||'Company', contact||'']);
    const store = getStore();
    res.status(201).json(store ? store.vendors.find(x=>x.id===id) : dbAll('SELECT * FROM vendors WHERE id = ?',[id])[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/vendors/:id', (req, res) => {
  try {
    const store = getStore();
    if (store) {
      const v = store.vendors.find(x=>x.id===req.params.id);
      if (!v) return res.status(404).json({ error: 'Not found' });
      ['name','company','email','tech','city','type','contact'].forEach(f => { if (req.body[f] !== undefined) v[f] = req.body[f]; });
      return res.json(v);
    }
    const fields = ['name','company','email','tech','city','type','contact'];
    const updates = [], values = [];
    fields.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); } });
    values.push(req.params.id);
    dbRun(`UPDATE vendors SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json(dbAll('SELECT * FROM vendors WHERE id = ?',[req.params.id])[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vendors/:id', (req, res) => {
  try {
    dbRun('DELETE FROM vendors', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── QUOTATIONS ───────────────────────────────────────────
app.post('/api/requirements/:id/quotations', (req, res) => {
  try {
    const { vendor_name, vendor_id, amount, num_developers, hours, timeline, notes } = req.body;
    if (!vendor_name || !amount) return res.status(400).json({ error: 'vendor_name and amount required' });
    const qid = uuidv4();
    dbRun('INSERT INTO quotations (id,requirement_id,vendor_id,vendor_name,amount,num_developers,hours,timeline,notes) VALUES (?,?,?,?,?,?,?,?,?)',
      [qid, req.params.id, vendor_id||null, vendor_name, amount, num_developers||'', hours||'—', timeline||'—', notes||'']);
    const store = getStore();
    res.status(201).json(store ? store.quotations.find(x=>x.id===qid) : dbAll('SELECT * FROM quotations WHERE id = ?',[qid])[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/quotations/:id', (req, res) => {
  try {
    dbRun('DELETE FROM quotations', [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── EMAIL ─────────────────────────────────────────────────
app.post('/api/send-rfq', async (req, res) => {
  try {
    const { requirement_id, vendor_ids, subject, body } = req.body;
    if (!requirement_id || !vendor_ids?.length) return res.status(400).json({ error: 'requirement_id and vendor_ids required' });
    const store = getStore();
    const req_row = store ? store.requirements.find(x=>x.id===requirement_id) : dbAll('SELECT * FROM requirements WHERE id = ?',[requirement_id])[0];
    if (!req_row) return res.status(404).json({ error: 'Requirement not found' });
    const vendors = store ? store.vendors.filter(v=>vendor_ids.includes(v.id)) : dbAll(`SELECT * FROM vendors WHERE id IN (${vendor_ids.map(()=>'?').join(',')})`, vendor_ids);
    const vendorEmails = vendors.filter(v=>v.email).map(v=>v.email);
    const result = await sendRFQEmail({ to: vendorEmails, subject: subject||`RFQ: ${req_row.title}`, body: body||'', requirement: req_row });
    res.json({ success: result.success, message: result.message, sent_to: vendorEmails });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync/sheets', async (req, res) => {
  try {
    const { syncToSheets } = require('./sheets');
    const store = getStore();
    const reqs = store ? store.requirements.map(r=>({...r, quotes: store.quotations.filter(q=>q.requirement_id===r.id)})) : dbAll('SELECT * FROM requirements');
    const vendors = store ? store.vendors : dbAll('SELECT * FROM vendors');
    await syncToSheets({ requirements: reqs, vendors });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── STATS ─────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const store = getStore();
    if (store) {
      return res.json({
        total: store.requirements.length,
        pending: store.requirements.filter(r=>r.status==='Pending').length,
        active: store.requirements.filter(r=>['CV Shared','Estimation given','In Progress'].includes(r.status)).length,
        closed: store.requirements.filter(r=>r.status==='Closed').length,
        quotes: store.quotations.length,
        vendors: store.vendors.length,
      });
    }
    res.json({
      total: dbAll('SELECT COUNT(*) as c FROM requirements')[0].c,
      pending: dbAll("SELECT COUNT(*) as c FROM requirements WHERE status='Pending'")[0].c,
      active: dbAll("SELECT COUNT(*) as c FROM requirements WHERE status IN ('CV Shared','Estimation given','In Progress')")[0].c,
      closed: dbAll("SELECT COUNT(*) as c FROM requirements WHERE status='Closed'")[0].c,
      quotes: dbAll('SELECT COUNT(*) as c FROM quotations')[0].c,
      vendors: dbAll('SELECT COUNT(*) as c FROM vendors')[0].c,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.json({ status: 'Brainium RFQ API is running', version: '1.0.0' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Brainium RFQ API running on port ${PORT}`));

// ── VENDOR EDIT ───────────────────────────────────────────
// Already handled by PATCH /api/vendors/:id above

// ── MARK WINNER ──────────────────────────────────────────
app.patch('/api/quotations/:id/winner', (req, res) => {
  try {
    const store = getStore();
    const { requirement_id } = req.body;
    if (store) {
      // Clear previous winner for this requirement
      store.quotations.filter(q => q.requirement_id === requirement_id).forEach(q => q.is_winner = false);
      const q = store.quotations.find(x => x.id === req.params.id);
      if (!q) return res.status(404).json({ error: 'Not found' });
      q.is_winner = true;
      // Update requirement status to Closed
      const r = store.requirements.find(x => x.id === requirement_id);
      if (r) r.status = 'Closed';
      return res.json(q);
    }
    dbRun('UPDATE quotations SET is_winner = 0 WHERE requirement_id = ?', [requirement_id]);
    dbRun('UPDATE quotations SET is_winner = 1 WHERE id = ?', [req.params.id]);
    dbRun("UPDATE requirements SET status = 'Closed' WHERE id = ?", [requirement_id]);
    res.json(dbAll('SELECT * FROM quotations WHERE id = ?', [req.params.id])[0]);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── VENDOR ANALYTICS ─────────────────────────────────────
app.get('/api/analytics', (req, res) => {
  try {
    const store = getStore();
    if (!store) return res.json({ vendorStats: [], topVendors: [] });

    const vendorMap = {};
    for (const q of store.quotations) {
      if (!vendorMap[q.vendor_name]) {
        vendorMap[q.vendor_name] = { name: q.vendor_name, quotes: 0, won: 0, amounts: [], requirements: new Set() };
      }
      vendorMap[q.vendor_name].quotes++;
      vendorMap[q.vendor_name].requirements.add(q.requirement_id);
      if (q.is_winner) vendorMap[q.vendor_name].won++;
      if (q.amount && q.amount !== '—') vendorMap[q.vendor_name].amounts.push(q.amount);
    }

    const vendorStats = Object.values(vendorMap).map(v => ({
      name: v.name,
      quotes: v.quotes,
      won: v.won,
      projects: v.requirements.size,
      winRate: v.quotes > 0 ? Math.round((v.won / v.quotes) * 100) : 0,
      latestAmount: v.amounts[v.amounts.length - 1] || '—',
    })).sort((a, b) => b.quotes - a.quotes);

    // BDM stats
    const bdmMap = {};
    for (const r of store.requirements) {
      const bdm = r.bdm || 'Unknown';
      if (!bdmMap[bdm]) bdmMap[bdm] = { name: bdm, total: 0, closed: 0, pending: 0 };
      bdmMap[bdm].total++;
      if (r.status === 'Closed') bdmMap[bdm].closed++;
      if (r.status === 'Pending') bdmMap[bdm].pending++;
    }
    const bdmStats = Object.values(bdmMap).sort((a, b) => b.total - a.total);

    res.json({ vendorStats, bdmStats });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
