const { Database: NodeSqlite3WasmDatabase } = require('node-sqlite3-wasm');
const path = require('path');

const DB_PATH = path.join(__dirname, 'brainium.db');
let db;

function getDb() {
  if (!db) {
    db = new NodeSqlite3WasmDatabase(DB_PATH);
    initSchema();
  }
  return db;
}

function initSchema() {
  db.run(`CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client TEXT,
    bdm TEXT,
    tech TEXT,
    type TEXT,
    status TEXT DEFAULT 'Pending',
    date TEXT,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    email TEXT,
    tech TEXT,
    city TEXT,
    type TEXT DEFAULT 'Company',
    contact TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS quotations (
    id TEXT PRIMARY KEY,
    requirement_id TEXT NOT NULL,
    vendor_id TEXT,
    vendor_name TEXT NOT NULL,
    amount TEXT NOT NULL,
    num_developers TEXT,
    hours TEXT,
    timeline TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (requirement_id) REFERENCES requirements(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rfq_emails (
    id TEXT PRIMARY KEY,
    requirement_id TEXT NOT NULL,
    vendor_emails TEXT,
    subject TEXT,
    body TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'sent'
  )`);

  seedData();
}

function seedData() {
  const count = db.all('SELECT COUNT(*) as c FROM vendors')[0].c;
  if (count > 0) return;

  const { v4: uuidv4 } = require('uuid');

  const vendors = [
    ['Internal','Tanmoy Mondal','Internal','tanmoy@brainium.com','React, Node, AI/ML, Python','Kolkata','Internal',''],
    ['Company','Santhosh Gupta','Deltacubes.us','santhosh.gupta3@deltacubes.us','ReactJS, NodeJS, Angular, AWS','Bengaluru','Company','9963219974'],
    ['Company','Prateek Saluja','RESILIENCESOFT','prateek@resiliencesoft.com','PHP, Laravel, Angular, MySQL','Bilaspur','Company','9981424199'],
    ['Company','Akshay Rathi','TechSierra.in','akshay@techsierra.in','React, Node, PHP, Laravel, AWS','Mumbai','Company','9819783891'],
    ['Company','Shubham Atre','Sourcebae','info@sourcebae.com','Angular, PHP, Node, React, Flutter','Indore','Company','6232091754'],
    ['Company','Rupal Gandhi','QriousTech','rupal.gandhi@qrioustech.com','React, Node, MERN, Flutter, Salesforce','Ahmedabad','Company','7990242189'],
    ['Company','Snehal Baraskar','Qloron','snehal.baraskar@qloron.com','Full Stack, Mobile, React','','Company','94055 58886'],
    ['Company','Rajib Dutta','Hepmade','rajib@hepmade.com','Full Stack, Mobile, AI','','Company','98361 33368'],
    ['Company','Sambita Mohapatra','Kudos Technolabs','sambita.m@kudostechnolabs.com','Full Stack, React, Node','','Company','7847864280'],
    ['Company','Sowmen','IT Idol','sowmen@itidoltechnologies.com','Full Stack, Mobile, Salesforce','','Company','91068 33252'],
    ['Company','Tausif Kovadiya','Emaad Infotech','tausif@emaadinfotech.com','Full Stack, PHP, React','','Company','91760014526'],
    ['Company','Goutam','Top Talent Hunt','gautam@toptalenthunt.com','React, Node, Angular','Pune','Company','9625447855'],
  ];

  for (const [type, name, company, email, tech, city, vtype, contact] of vendors) {
    db.run('INSERT INTO vendors (id,name,company,email,tech,city,type,contact) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), name, company, email, tech, city, vtype, contact]);
  }

  const reqs = [
    ['Market Index Project — .NET Redesign','Brainium (Gaurav)','Gaurav','.NET, React, Mobile App','FC','Pending','2025-05-21','Redesign of https://www.marketindex.com.au/ — website + mobile app. Need price quote separately for web and app.'],
    ['Senior Angular Developer (7+ yrs)','Amritendu','Amritendu','Angular 7+','FD','CV Shared','2025-12-10','7+ yrs Angular developer, budget ₹1.2 LPM, remote, immediately available.'],
    ['AI/ML Developer','Bikash','Bikash','AI, ML, Python','FD','Closed','2025-06-10','Python AI/ML developer for project delivery. Budget around 1 Lakh/month.'],
    ['Backend .NET Core + MongoDB (3 positions)','Bikash','Bikash','.NET Core, MongoDB, Vue.js','FD','Pending','2026-04-01','3 Backend devs (3-6 yrs) + 1 Vue.js UI developer. Healthcare domain preferred, 1-3 months.'],
    ['Shopify + React — Pivotee','Manojit','Manojit','Shopify, React','FD','Closed','2025-09-04','Full-time Shopify + React developers needed for Pivotee client.'],
  ];

  const reqIds = [];
  for (const [title, client, bdm, tech, type, status, date, description] of reqs) {
    const id = uuidv4();
    reqIds.push(id);
    db.run('INSERT INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, title, client, bdm, tech, type, status, date, description]);
  }

  // Seed some quotes for first requirement
  const quotes = [
    [reqIds[0], 'Tanmoy Mondal', '₹27 Lakh', '8', '2500 hrs', '5-6 months', 'Includes PM, TL, 2 backend, 2 frontend, 1 mobile, 1 QA'],
    [reqIds[0], 'Qloron', '₹25-40 Lakh', '4', '—', '—', 'Website ₹25L separately, Website+App ₹40L'],
    [reqIds[1], 'Tanmoy Mondal', '₹1.40 LPM', '1', '—', 'Ongoing', 'Profile: Proparna, notice period 15 days'],
    [reqIds[2], 'Tanmoy Mondal', '₹4.15 Lakh total', '1', '—', '1 month', 'Immediate joiner available'],
  ];

  for (const [rid, vname, amount, devs, hours, timeline, notes] of quotes) {
    db.run('INSERT INTO quotations (id,requirement_id,vendor_name,amount,num_developers,hours,timeline,notes) VALUES (?,?,?,?,?,?,?,?)',
      [uuidv4(), rid, vname, amount, devs, hours, timeline, notes]);
  }
}

module.exports = { getDb };
