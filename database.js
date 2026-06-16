const { v4: uuidv4 } = require('uuid');

// ── Turso persistent SQLite ────────────────────────────────
// Falls back to in-memory JSON if Turso not configured yet
let tursoClient = null;
let memStore = null;

function getTurso() {
  if (tursoClient) return tursoClient;
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) return null;
  try {
    const { createClient } = require('@libsql/client');
    // Use https:// URL to bypass migration job checks in newer libsql versions
    const url = process.env.TURSO_URL.replace('libsql://', 'https://');
    tursoClient = createClient({
      url,
      authToken: process.env.TURSO_TOKEN,
    });
    console.log('Connected to Turso SQLite');
    return tursoClient;
  } catch(e) {
    console.log('Turso connection failed:', e.message);
    return null;
  }
}

function getMemStore() {
  if (memStore) return memStore;
  memStore = { requirements: [], vendors: [], quotations: [], rfq_emails: [] };
  seedData(memStore);
  return memStore;
}

// ── Schema ─────────────────────────────────────────────────
async function initTurso(client) {
  // Create tables one by one (batch API varies by version)
  await client.execute(`CREATE TABLE IF NOT EXISTS requirements (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, client TEXT, bdm TEXT,
    tech TEXT, type TEXT, status TEXT DEFAULT 'Pending', date TEXT,
    description TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT,
    tech TEXT, city TEXT, type TEXT DEFAULT 'Company', contact TEXT,
    blacklisted INTEGER DEFAULT 0, blacklist_reason TEXT,
    blacklisted_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS quotations (
    id TEXT PRIMARY KEY, requirement_id TEXT, vendor_id TEXT,
    vendor_name TEXT, amount TEXT, num_developers TEXT, hours TEXT,
    timeline TEXT, notes TEXT, is_winner INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await client.execute(`CREATE TABLE IF NOT EXISTS rfq_emails (
    id TEXT PRIMARY KEY, requirement_id TEXT, vendor_emails TEXT,
    subject TEXT, body TEXT, status TEXT, attachment_name TEXT,
    error_message TEXT, sent_at TEXT DEFAULT (datetime('now'))
  )`);

  // Seed vendors if empty
  const { rows: vRows } = await client.execute('SELECT COUNT(*) as c FROM vendors');
  if (vRows[0].c === 0) await seedTurso(client);
  else {
    // Check if requirements and quotations need seeding
    const { rows: rRows } = await client.execute('SELECT COUNT(*) as c FROM requirements');
    const { rows: qRows } = await client.execute('SELECT COUNT(*) as c FROM quotations');
    const reqCount = Number(rRows[0].c);
    const quoteCount = Number(qRows[0].c);
    console.log(`DB state: vendors=${Number(vRows[0].c)}, reqs=${reqCount}, quotes=${quoteCount}`);

    if (reqCount < 28 || reqCount > 42) {
      // Wrong count — clear and reseed requirements only
      console.log('Requirements count wrong, reseeding...');
      await client.execute('DELETE FROM quotations');
      await client.execute('DELETE FROM requirements');
      await seedTurso(client);
    } else if (quoteCount < 5) {
      // Seed quotations only if missing
      console.log('Seeding quotations...');
      const store = { requirements: [], vendors: [], quotations: [] };
      seedData(store);
      // Map seed req titles to real DB ids
      const dbReqs = (await client.execute('SELECT id, title FROM requirements')).rows;
      for (const q of store.quotations) {
        // find matching req by requirement_id from seed
        const seedReq = store.requirements.find(r => r.id === q.requirement_id);
        if (!seedReq) continue;
        const dbReq = dbReqs.find(r => r.title === seedReq.title);
        if (!dbReq) continue;
        try {
          await client.execute({ sql: 'INSERT OR IGNORE INTO quotations (id,requirement_id,vendor_name,amount,num_developers,hours,timeline,notes,is_winner) VALUES (?,?,?,?,?,?,?,?,?)', args: [q.id, dbReq.id, q.vendor_name, q.amount, q.num_developers, q.hours, q.timeline, q.notes, q.is_winner?1:0] });
        } catch(e) {}
      }
      console.log('Quotations seeded.');
    } else {
      console.log('DB looks correct, skipping reseed.');
    }
  }
}

async function seedTurso(client) {
  const store = { requirements: [], vendors: [], quotations: [] };
  seedData(store);

  // ── Vendors: upsert by name (not id) ──────────────────
  // Clear all existing seed vendors and re-insert with correct data
  await client.execute('DELETE FROM vendors');
  for (const v of store.vendors) {
    try {
      await client.execute({
        sql: 'INSERT INTO vendors (id,name,company,email,tech,city,type,contact,blacklisted,blacklist_reason) VALUES (?,?,?,?,?,?,?,?,0,?)',
        args: [v.id,v.name,v.company,v.email,v.tech,v.city,v.type,v.contact,'']
      });
    } catch(e) {}
  }

  // ── Requirements: delete duplicates first, keep unique titles ──
  // Remove all rows where title appears more than once (keep none — reseed all)
  await client.execute('DELETE FROM requirements');
  await client.execute('DELETE FROM quotations');
  for (const r of store.requirements) {
    try {
      await client.execute({
        sql: 'INSERT INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [r.id,r.title,r.client,r.bdm,r.tech,r.type,r.status,r.date,r.description]
      });
    } catch(e) {}
  }
  for (const q of store.quotations) {
    try {
      await client.execute({
        sql: 'INSERT INTO quotations (id,requirement_id,vendor_name,amount,num_developers,hours,timeline,notes,is_winner) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [q.id,q.requirement_id,q.vendor_name,q.amount,q.num_developers,q.hours,q.timeline,q.notes,q.is_winner?1:0]
      });
    } catch(e) {}
  }

  const vCount = await client.execute('SELECT COUNT(*) as c FROM vendors');
  const rCount = await client.execute('SELECT COUNT(*) as c FROM requirements');
  console.log(`Turso reseeded: ${vCount.rows[0].c} vendors, ${rCount.rows[0].c} reqs`);
}

// ── Public API ─────────────────────────────────────────────
// Returns { client, isMemory } — all server routes use these helpers
async function query(sql, args = []) {
  const client = getTurso();
  if (client) {
    const result = await client.execute({ sql, args });
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  }
  // Memory fallback
  const store = getMemStore();
  if (sql.includes('FROM requirements')) {
    if (args.length && sql.includes('WHERE id')) return store.requirements.filter(r => r.id === args[0]);
    if (sql.includes("status='Pending'")) return store.requirements.filter(r => r.status === 'Pending');
    if (sql.includes("status IN")) return store.requirements.filter(r => ['CV Shared','Estimation given','In Progress'].includes(r.status));
    if (sql.includes("status='Closed'")) return store.requirements.filter(r => r.status === 'Closed');
    if (sql.includes('COUNT(*)')) return [{ c: store.requirements.length }];
    return store.requirements;
  }
  if (sql.includes('FROM vendors')) {
    if (args.length && sql.includes('WHERE id')) return store.vendors.filter(v => v.id === args[0]);
    if (sql.includes('COUNT(*)')) return [{ c: store.vendors.length }];
    return [...store.vendors].sort((a,b) => a.name.localeCompare(b.name));
  }
  if (sql.includes('FROM quotations')) {
    if (args.length) return store.quotations.filter(q => q.requirement_id === args[0] || q.id === args[0]);
    if (sql.includes('COUNT(*)')) return [{ c: store.quotations.length }];
    return store.quotations;
  }
  if (sql.includes('FROM rfq_emails')) return [...(store.rfq_emails||[])].sort((a,b)=>new Date(b.sent_at)-new Date(a.sent_at));
  return [{ c: 0 }];
}

async function execute(sql, args = []) {
  const client = getTurso();
  if (client) {
    await client.execute({ sql, args });
    return;
  }
  // Memory fallback mutations
  const store = getMemStore();
  if (sql.startsWith('INSERT INTO requirements')) {
    store.requirements.unshift({ id:args[0],title:args[1],client:args[2],bdm:args[3],tech:args[4],type:args[5],status:args[6],date:args[7],description:args[8],created_at:new Date().toISOString() });
  } else if (sql.startsWith('INSERT INTO vendors')) {
    store.vendors.push({ id:args[0],name:args[1],company:args[2],email:args[3],tech:args[4],city:args[5],type:args[6],contact:args[7],blacklisted:false,blacklist_reason:'',created_at:new Date().toISOString() });
  } else if (sql.startsWith('INSERT INTO quotations')) {
    store.quotations.push({ id:args[0],requirement_id:args[1],vendor_id:args[2],vendor_name:args[3],amount:args[4],num_developers:args[5],hours:args[6],timeline:args[7],notes:args[8],is_winner:args[9]===1,created_at:new Date().toISOString() });
  } else if (sql.startsWith('INSERT INTO rfq_emails')) {
    (store.rfq_emails = store.rfq_emails||[]).push({ id:args[0],requirement_id:args[1],vendor_emails:args[2],subject:args[3],body:args[4],status:args[5],attachment_name:args[6]||'',error_message:args[7]||'',sent_at:new Date().toISOString() });
  } else if (sql.startsWith('UPDATE requirements')) {
    const id = args[args.length-1];
    const r = store.requirements.find(x=>x.id===id);
    if (r) { const fields=['title','client','bdm','tech','type','status','description']; const setPart=sql.match(/SET (.+) WHERE/)[1]; setPart.split(', ').forEach((f,i)=>{const k=f.split(' = ')[0];if(fields.includes(k))r[k]=args[i];}); }
  } else if (sql.startsWith('UPDATE vendors')) {
    const id = args[args.length-1];
    const v = store.vendors.find(x=>x.id===id);
    if (v) { if(sql.includes('blacklisted=1')){v.blacklisted=true;v.blacklist_reason=args[0];v.blacklisted_at=args[1];} else if(sql.includes('blacklisted=0')){v.blacklisted=false;v.blacklist_reason='';v.blacklisted_at=null;} else { ['name','company','email','tech','city','type','contact'].forEach((k,i)=>{if(args[i]!==undefined)v[k]=args[i];}); } }
  } else if (sql.startsWith('UPDATE quotations')) {
    const id = args[args.length-1];
    const q = store.quotations.find(x=>x.id===id);
    if (sql.includes('is_winner = 0')) store.quotations.filter(x=>x.requirement_id===args[0]).forEach(x=>x.is_winner=false);
    if (sql.includes('is_winner = 1') && q) q.is_winner=true;
    if (sql.includes("status = 'Closed'")) { const r=store.requirements.find(x=>x.id===args[0]); if(r)r.status='Closed'; }
  } else if (sql.startsWith('DELETE FROM quotations')) {
    store.quotations = store.quotations.filter(q=>q.id!==args[0]&&q.requirement_id!==args[0]);
  } else if (sql.startsWith('DELETE FROM requirements')) {
    store.requirements = store.requirements.filter(r=>r.id!==args[0]);
    store.quotations = store.quotations.filter(q=>q.requirement_id!==args[0]);
  } else if (sql.startsWith('INSERT INTO users')) {
    if (!store.users) store.users = [];
    store.users.push({ id:args[0], name:args[1], email:args[2], password:args[3], role:args[4], active:1, created_at:new Date().toISOString() });
  } else if (sql.startsWith('UPDATE users')) {
    const id=args[args.length-1]; const u=store.users?.find(x=>x.id===id);
    if(u){ if(args[0]!==undefined&&args[0]!==null)u.name=args[0]; if(args[1]!==undefined&&args[1]!==null)u.role=args[1]; if(args[2]!==undefined&&args[2]!==null)u.active=args[2]; if(args[3]!==undefined&&args[3]!==null)u.password=args[3]; }
  } else if (sql.startsWith('DELETE FROM users')) {
    if(store.users)store.users=store.users.filter(u=>u.id!==args[0]);
  } else if (sql.startsWith('DELETE FROM vendors')) {
    store.vendors = store.vendors.filter(v=>v.id!==args[0]);
  }
}

// Initialize on startup
async function init() {
  const client = getTurso();
  if (client) {
    await initTurso(client);
  } else {
    console.log('No Turso config — using in-memory store. Add TURSO_URL + TURSO_TOKEN env vars for persistence.');
    getMemStore();
  }
}

module.exports = { query, execute, init, uuidv4, getTurso, getMemStore };

// ── Seed Data ─────────────────────────────────────────────
function seedData(store) {
  const companies = [
    { name:'Santhosh Gupta', company:'Deltacubes.us', email:'santhosh.gupta3@deltacubes.us', tech:'ReactJS, NodeJS, Angular, AWS Lambda, PHP, Laravel', city:'Bengaluru', contact:'9963219974' },
    { name:'Prateek Saluja', company:'RESILIENCESOFT', email:'prateek@resiliencesoft.com', tech:'Core PHP, CodeIgniter, Laravel, Angular JS, MySQL', city:'Bilaspur', contact:'9981424199' },
    { name:'Priya K', company:'Techy Geeks', email:'Priya.k@techygeeksit.com', tech:'VR, AR, Mobile App, 3D Modeling, Game Development, UI/UX', city:'Puducherry', contact:'9488611933' },
    { name:'Ravi', company:'eDelta Enterprise Solutions', email:'ravi@edeltaes.com', tech:'Angular JS, Angular 2, Ionic, AWS, Node.JS, Express.js', city:'Ahmedabad', contact:'9624300546' },
    { name:'Goutam', company:'Top Talent Hunt', email:'gautam@toptalenthunt.com', tech:'React JS, Bootstrap, CSS, HTML, MySQL, Angular, Node JS', city:'Pune', contact:'9625447855' },
    { name:'Shubham Atre', company:'Sourcebae', email:'info@sourcebae.com', tech:'Angular, PHP, Node.js, Java, Laravel, React JS, React Native, Vue.js, Flutter, Django, .NET, Python', city:'Indore', contact:'6232091754' },
    { name:'Akshay Rathi', company:'TechSierra.in', email:'akshay@techsierra.in', tech:'React.js, Angular, Node.js, PHP (Laravel), AWS, Azure, MySQL, MongoDB, React Native, .NET', city:'Mumbai', contact:'9819783891' },
    { name:'Atul Parihar', company:'WitArist IT Services', email:'atul.parihar@witarist.com', tech:'Full Stack', city:'Noida', contact:'09971842701' },
    { name:'Shalini Rathore', company:'Webority Technologies', email:'shalini@webority.com', tech:'WordPress, Shopify, Magento, Drupal, SEO, Android, iOS, Flutter', city:'Gurgaon', contact:'9811938666' },
    { name:'Rupal Gandhi', company:'QriousTech', email:'rupal.gandhi@qrioustech.com', tech:'React Js, Node Js, MERN, Java, React Native, Flutter, Salesforce, Power BI, WordPress, Android', city:'Ahmedabad', contact:'7990242189' },
    { name:'Sowmen', company:'IT Idol', email:'sowmen@itidoltechnologies.com', tech:'Full Stack, Mobile, Salesforce', city:'', contact:'9106833252' },
    { name:'Tapan Kumar', company:'Guardians Infotech', email:'tapan@guardiansinfotech.com', tech:'Full Stack, DevOps', city:'', contact:'9515333645' },
    { name:'Samadhan More', company:'Spiral Technolabs', email:'biz@spiraltechnolabs.com', tech:'Full Stack, Mobile, React', city:'', contact:'7984436866' },
    { name:'Greanu Shharanya', company:'CodersBrain', email:'greanu@codersbrain.com', tech:'Full Stack, Mobile, AI', city:'', contact:'8971280873' },
    { name:'Rajib Dutta', company:'Hepmade', email:'rajib@hepmade.com', tech:'Full Stack, Mobile, AI, Web', city:'', contact:'9836133368' },
    { name:'Geetimoy', company:'Confitech', email:'contact@confitechsol.com', tech:'Full Stack, Mobile, Web', city:'', contact:'9051359990' },
    { name:'Snehal Baraskar', company:'Qloron', email:'snehal.baraskar@qloron.com', tech:'Full Stack, Mobile, React, Node', city:'', contact:'9405558886' },
    { name:'Ashwin Tiwari', company:'Eliora Technology', email:'ashwin@elioratechno.com', tech:'Power BI, Data Analytics, Mobile & Web Development', city:'', contact:'8446619125' },
    { name:'Tausif Kovadiya', company:'Emaad Infotech', email:'tausif@emaadinfotech.com', tech:'Full Stack, PHP, React, Node', city:'', contact:'9176001452' },
    { name:'Akash Thakkar', company:'Aashvi Infotech', email:'akash.thakkar@aashviinfotech.com', tech:'Full Stack, Mobile, Web', city:'', contact:'9033363180' },
    { name:'Shristy Chandgothia', company:'Sinelogix Technologies', email:'sales@sinelogixtechnologies.com', tech:'PHP, Laravel, Magento, Shopify, WordPress, React JS, Flutter, Android, iOS, Java', city:'Vadodara', contact:'8980898451' },
    { name:'Sambita Mohapatra', company:'Kudos Technolabs', email:'sambita.m@kudostechnolabs.com', tech:'Full Stack, React, Node', city:'', contact:'7847864280' },
    { name:'Raunak Agrawal', company:'Protribe Global', email:'raunak.agrawal@protribe-global.com', tech:'Full Stack, Backend, Frontend, Mobile, DevOps, Cloud, AI/ML', city:'', contact:'9106842996' },
    { name:'Tanmoy Mondal', company:'Internal', email:'tanmoy@brainium.com', tech:'React, Node, AI/ML, Python, Full Stack', city:'Kolkata', contact:'' },
  ];
  const freelancers = [
    { name:'Kaustuv Basak', tech:'Java, Spring Boot, Node.JS, Python, Django, React JS, React Native', city:'Bengaluru', contact:'9384852305', email:'kbasak51903@gmail.com' },
    { name:'Kalyan Saha', tech:'ASP.NET MVC, C#.NET, Angular, React JS, Power Center, HTML5, MySQL', city:'Kolkata', contact:'9734557385', email:'kalyansaharana@rediffmail.com' },
    { name:'Prosenjit Ghosh', tech:'Azure Data Factory, Java, Python, Data Warehousing, ETL, BI Tools, Spring Boot', city:'Kolkata', contact:'9831740771', email:'proghosh123@outlook.com' },
    { name:'Baljeet Singh', tech:'Java, Spring Boot, Microservices, AWS', city:'Mohali', contact:'8437979305', email:'beetengg@gmail.com' },
    { name:'Hiren Patel', tech:'Java, Spring Boot, AWS, Hibernate, Microservices', city:'Ahmedabad', contact:'9427668282', email:'mca.hiren@gmail.com' },
    { name:'Dibyendu Rakshit', tech:'Java, Spring Boot, Docker, Kubernetes, Kafka, Elastic Search, AWS, MongoDB', city:'Bengaluru', contact:'6361276886', email:'dibyendu.rakshit.83@gmail.com' },
    { name:'Ratnesh Kumar', tech:'Java, Spring Boot, Hibernate, Oracle, Postgres, AWS, Android', city:'Mumbai', contact:'9920831441', email:'ratnesh.mca@gmail.com' },
    { name:'Raghu Varre', tech:'ASP.Net, ASP.NET MVC, C#, SQL, SSIS, SSRS, Web API, Javascript', city:'Hyderabad', contact:'9985295838', email:'raghu.varre09@gmail.com' },
    { name:'Nimesh Patel', tech:'ASP.NET MVC, Angular JS, C#.NET, Jquery, Javascript, Angular 2', city:'Ahmedabad', contact:'8320413964', email:'adsgripmarketing@gmail.com' },
    { name:'Ashwini Vanjire', tech:'Angular 2, Angular JS, Ionic, Angular 12, Node.js, React JS', city:'Pune', contact:'7083193305', email:'ashwinipatil1321@gmail.com' },
    { name:'Suraj Rath', tech:'Angular JS, Angular 2, React JS, Javascript, HTML5, CSS3, Typescript, Redux', city:'Bengaluru', contact:'8339828084', email:'surajrath8@gmail.com' },
    { name:'Raj Srivastva', tech:'HTML5, CSS3, Bootstrap, Angular JS, Angular 2, React JS, UI/UX', city:'Delhi', contact:'8826917121', email:'rajglobol@gmail.com' },
    { name:'Adil Khan', tech:'Java, Android Studio, HTML5, React JS, Angular, Bootstrap, Spring Boot, MySQL, Firebase', city:'Noida', contact:'9873648143', email:'adilkhant0666@gmail.com' },
    { name:'Amar Pandey', tech:'HTML, CSS, Angular JS, React.Js, Ionic, jQuery, Bootstrap, Oracle, MySQL', city:'Kolkata', contact:'8274980877', email:'007amarpandey@gmail.com' },
    { name:'Vikesh Vaghela', tech:'Node.JS, React JS, Angular JS, PHP, Codeignitor, Websocket, MongoDB, MySQL', city:'Surat', contact:'8141879844', email:'vickeyvaghela82@gmail.com' },
    { name:'Yash Sanghani', tech:'Python, Full Stack, Javascript, Django', city:'Surat', contact:'7436025170', email:'yashsanghani3110@gmail.com' },
    { name:'Kaustubh Limbani', tech:'Python, Django, Flask, Javascript, HTML, Docker, GIT, Pandas', city:'Surat', contact:'9106607272', email:'kplimbani95@gmail.com' },
    { name:'Ashutosh Yadav', tech:'React JS, HTML5, CSS3, Bootstrap, Python, Django, Javascript', city:'Kalyan', contact:'9136345128', email:'ashu.ydv2001@gmail.com' },
    { name:'Guru Patidar', tech:'Android Studio, App Development, Retrofit, REST API, Kotlin, Java', city:'Indore', contact:'6264255700', email:'gurupatidar007@gmail.com' },
    { name:'Rushabh Navadiya', tech:'Flutter, Android, iOS, Java, Kotlin, Android Studio', city:'Surat', contact:'8866002166', email:'rushabhnavadiya1998@gmail.com' },
    { name:'Ritik Rathaur', tech:'Android, Kotlin, Android Studio, Java', city:'Noida', contact:'8287225737', email:'ritik89577@gmail.com' },
    { name:'Alpa Bhojani', tech:'Objective-C, Swift, iOS, React Native', city:'Ahmedabad', contact:'8238538383', email:'alpabhojani.kbasystems@gmail.com' },
    { name:'Mayank Kulshrestha', tech:'iOS, Flutter', city:'Ghaziabad', contact:'8447752075', email:'mayank.kuls83@gmail.com' },
    { name:'Dhananjay Gadekar', tech:'Salesforce, Trigger, Javascript, HTML, CSS, APEX, LWC, SOQL, Flows', city:'Pune', contact:'9373841998', email:'dhananjaygadekar94@gmail.com' },
    { name:'Varun Gupta', tech:'Salesforce, Software Testing, JIRA', city:'Ambala', contact:'6283704041', email:'varungupta3603@gmail.com' },
    { name:'Nandhini Arjunan', tech:'Salesforce, Jenkins, Aura, Integration, Service Cloud, Community Cloud', city:'', contact:'6363525614', email:'nandhiniarjunanbusiness@gmail.com' },
    { name:'Snehal Singh', tech:'SAP Fiori, SAP UI5, SAP ABAP, Power BI', city:'Jabalpur', contact:'8871985050', email:'99snehalsingh1997@gmail.com' },
    { name:'Rajapandi Karuppaiya', tech:'SAP, SAP HANA 1.0, Linux', city:'Bangalore', contact:'7010818037', email:'rajapandiking@gmail.com' },
    { name:'Tanupriya Singh', tech:'Unity 3D, C#, JavaScript, MySQL, HTML5, Gaming, Augmented Reality', city:'Noida', contact:'8979830244', email:'tanumjp@gmail.com' },
    { name:'Swapnil Titar', tech:'Automation Testing, Selenium, Cypress, REST API Testing, Jmeter, Javascript', city:'Pune', contact:'7517386468', email:'swapniltitar03@gmail.com' },
    { name:'Raghvendra Raghuvanshi', tech:'Core Java, JavaScript, Selenium WebDriver, TestNG, Cucumber BDD, Jenkins, Docker', city:'Noida', contact:'9340217143', email:'raghvendrar015@gmail.com' },
    { name:'Akhilesh Jain', tech:'MongoDB, Golang, Kafka, Cassandra, Docker, Zookeeper, SQL, PostgreSQL', city:'Pune', contact:'8796435818', email:'akhileshjain19@gmail.com' },
    { name:'Arun Kumaar S', tech:'Golang, Go, AWS, Serverless, Python, SQL, NoSQL', city:'Bengaluru', contact:'9791601406', email:'arunthuvini@gmail.com' },
    { name:'Nishant Hiremath', tech:'Golang, PostgreSQL, MongoDB, Git, Microservices', city:'Mumbai', contact:'7738500286', email:'nishire27@gmail.com' },
    { name:'Provat Das', tech:'PHP, Laravel, HTML, CSS, Node, Vue, Angular', city:'Kolkata', contact:'9832996894', email:'' },
    { name:'Surajit Datta', tech:'HTML, CSS, JavaScript, React, Redux, Node.js, Express, MongoDB', city:'', contact:'7908216496', email:'bubuldatta91314@gmail.com' },
    { name:'Ritik Kohar', tech:'Remix, ReactJS, Node JS, Full Stack', city:'', contact:'9306332262', email:'ritikkochar2@gmail.com' },
    { name:'Deepansh Tandon', tech:'Next.js, React, JavaScript, Java, SpringBoot, Microservices, PostgreSQL, CI/CD, Docker', city:'', contact:'9123090375', email:'Deepansh.tandon@gmail.com' },
    { name:'Palvin Muthesh', tech:'React Native, Ionic, Flutter, MEAN, MERN, JS Frameworks', city:'Remote', contact:'9629317140', email:'rrabbit2121@gmail.com' },
    { name:'Abhishek Kumar Ram', tech:'Python, Machine Learning, Deep Learning, AI, Generative AI, LLMs, Power BI, Data Science', city:'', contact:'9123082964', email:'' },
    { name:'Anirban Patra', tech:'Data Science, Machine Learning', city:'', contact:'8159071050', email:'anirbanpatra79@gmail.com' },
    { name:'Pranav Singhal', tech:'Blockchain, Cloud, Product Management, Visualization', city:'Hyderabad', contact:'8861200127', email:'pranavrox92@gmail.com' },
    { name:'Abhrajyoti Sen', tech:'Blockchain, MERN Stack, Hyperledger Fabric, Python, Go, NodeJS, AWS', city:'Kolkata', contact:'9038928864', email:'abhrajyoti700@gmail.com' },
    { name:'Umashankar Shaw', tech:'PHP, Laravel, HTML, CSS, Node', city:'Kolkata', contact:'8479805628', email:'' },
    { name:'Sairam', tech:'Boomi Developer', city:'', contact:'9000488840', email:'' },
    { name:'Kiran Ahmed', tech:'iOS, Swift, Mobile Development', city:'Gujarat', contact:'', email:'' },
  ];

  for (const v of companies) store.vendors.push({ id:uuidv4(), name:v.name, company:v.company, email:v.email||'', tech:v.tech, city:v.city||'', type:v.company==='Internal'?'Internal':'Company', contact:v.contact||'', blacklisted:false, blacklist_reason:'', created_at:new Date().toISOString() });
  for (const v of freelancers) store.vendors.push({ id:uuidv4(), name:v.name, company:'Freelancer', email:v.email||'', tech:v.tech, city:v.city||'', type:'Freelancer', contact:v.contact||'', blacklisted:false, blacklist_reason:'', created_at:new Date().toISOString() });

  const reqs = [
    { title:'Market Index Project — .NET Redesign', client:'Gaurav', bdm:'Gaurav', tech:'.NET, React, Mobile App', type:'FC', status:'Pending', date:'2025-05-21', description:'Redesign of https://www.marketindex.com.au/ — website + mobile app. Separate quotes for web and app.' },
    { title:'CS Cart Multi-Vendor — PHP/Smarty Developer', client:'Dave', bdm:'Dave', tech:'PHP, Smarty, CS Cart', type:'FD', status:'CV Shared', date:'2025-05-01', description:'CS Cart Multi-Vendor Ultimate. Developer needed for custom add-on, PHP, Smarty, hooks troubleshooting.' },
    { title:'Python and AI/ML Developers', client:'Payel', bdm:'Payel', tech:'Python, AI, ML', type:'FD', status:'CV Shared', date:'2025-05-02', description:'Python and AI/ML developers needed for project delivery.' },
    { title:'.NET Angular — Welspun', client:'Manojit', bdm:'Manojit', tech:'.NET, Angular', type:'FD', status:'CV Shared', date:'2025-05-03', description:'.NET and Angular developers for Welspun client.' },
    { title:'SAP PP QM Consultant (10+ yrs)', client:'Manojit', bdm:'Manojit', tech:'SAP PP, SAP QM', type:'FD', status:'CV Shared', date:'2025-05-07', description:'SAP PP QM consultant with 10+ years experience. WFH. Budget ₹1,40,000/month.' },
    { title:'Salesforce DevOps Engineer', client:'Manojit', bdm:'Manojit', tech:'Salesforce, DevOps', type:'FD', status:'CV Shared', date:'2025-05-08', description:'Salesforce DevOps Engineer required.' },
    { title:'BIM Developer', client:'Manojit', bdm:'Manojit', tech:'BIM, Autodesk', type:'TM', status:'Closed', date:'2025-05-12', description:'BIM developer needed. Debanjan Pal got selected.' },
    { title:'GenAI Developer', client:'Manojit', bdm:'Manojit', tech:'GenAI, Python, LLM', type:'TM', status:'CV Shared', date:'2025-05-14', description:'Generative AI developer for project work.' },
    { title:'AI-powered Sponsorship Platform', client:'Monojit', bdm:'Monojit', tech:'AI, Full Stack', type:'FC', status:'Estimation given', date:'2025-05-17', description:'AI-powered sponsorship platform development.' },
    { title:'Odoo Developer — Kolkata', client:'Bikash', bdm:'Bikash', tech:'Odoo, Python', type:'TM', status:'Lost', date:'2025-06-01', description:'Odoo developer needed in Kolkata. Quoted ₹1800/hour.' },
    { title:'AI/ML Developer', client:'Bikash', bdm:'Bikash', tech:'AI, ML, Python', type:'FD', status:'Closed', date:'2025-06-10', description:'Python AI/ML developer for project delivery. Budget around 1 Lakh/month.' },
    { title:'Shopify — Golazzo', client:'Monojit', bdm:'Monojit', tech:'Shopify', type:'FC', status:'Closed', date:'2025-06-03', description:'Shopify development for Golazzo client. Quoted ₹800/hour.' },
    { title:'Python + React Developer', client:'Bikash', bdm:'Bikash', tech:'Python, React', type:'FD', status:'CV Shared', date:'2025-06-06', description:'Python and React developer needed.' },
    { title:'Salesforce — Onsite USA', client:'Manojit', bdm:'Manojit', tech:'Salesforce', type:'FD', status:'Pending', date:'2025-06-24', description:'Salesforce developer onsite in USA. Green card holders only.' },
    { title:'ServiceNow — Sukolpo', client:'Bikash', bdm:'Bikash', tech:'ServiceNow', type:'FD', status:'Pending', date:'2025-08-01', description:'ServiceNow resources needed — 5 to 50 resources.' },
    { title:'Shopify + React — Pivotee', client:'Manojit', bdm:'Manojit', tech:'Shopify, React', type:'FD', status:'Closed', date:'2025-09-04', description:'Full-time Shopify + React developers for Pivotee client.' },
    { title:'Full Stack Java/React + QA + DevOps', client:'Manojit', bdm:'Manojit', tech:'Java, Spring Boot, React, QA, DevOps', type:'FD', status:'CV Shared', date:'2025-09-09', description:'Full Stack (Java/SpringBoot+React) 2 positions, QA 2 positions, DevOps 1 position. Hyderabad. Immediate.' },
    { title:'French Speaking Unity Developer', client:'Bikash', bdm:'Bikash', tech:'Unity, C#', type:'FD', status:'CV Shared', date:'2025-09-10', description:'French speaking Unity developer required.' },
    { title:'Python Backend Developer (6-8 yrs)', client:'Azhar', bdm:'Azhar', tech:'Python, Flask, FastAPI, Django, AWS, MongoDB', type:'FD', status:'CV Shared', date:'2025-10-01', description:'6-8 years Python backend. Flask, FastAPI, Django, Serverless. AWS services. Noida/Pune/Bangalore hybrid.' },
    { title:'Network Engineer + Tableau + Python', client:'Amritendu', bdm:'Amritendu', tech:'Network, Tableau, Python', type:'FD', status:'CV Shared', date:'2025-10-09', description:'Network Engineer (Cisco, F5, Fortinet), Senior Tableau Developer, Sr. Python Engineer needed.' },
    { title:'Data Scientist — Networking & Graph', client:'Sweety', bdm:'Sweety', tech:'Data Science, Python, NetworkX, PySpark, Azure', type:'FD', status:'CV Shared', date:'2025-11-24', description:'Data Scientist specializing in network design, graph-based modeling, PySpark on Azure/Databricks.' },
    { title:'Project/Delivery Manager — PMO', client:'Manojit', bdm:'Manojit', tech:'PMO, Jira, Agile, PRINCE2', type:'FD', status:'CV Shared', date:'2025-12-01', description:'Project/Delivery Manager with IT governance, PMO best practices, Agile delivery, Jira expertise.' },
    { title:'.NET + Azure Developer', client:'Manojit', bdm:'Manojit', tech:'.NET, Azure', type:'FD', status:'CV Shared', date:'2025-12-02', description:'.NET and Azure developer required.' },
    { title:'Senior Python Developer — Welspun', client:'Manojit', bdm:'Manojit', tech:'Python, Full Stack', type:'FD', status:'CV Shared', date:'2025-12-03', description:'Senior Python developer for Welspun client.' },
    { title:'Senior Angular Developer (7+ yrs)', client:'Amritendu', bdm:'Amritendu', tech:'Angular 7+', type:'FD', status:'Closed', date:'2025-12-10', description:'7+ yrs Angular developer, budget ₹1.2 LPM, remote, immediately available.' },
    { title:'Senior AI Engineer (7+ yrs)', client:'Amritendu', bdm:'Amritendu', tech:'AI, ML, Python, LLM', type:'FD', status:'CV Shared', date:'2025-12-11', description:'Senior AI Engineer, 7+ years, budget ₹1.4 LPM, remote.' },
    { title:'RPA + Power Automate Developer', client:'Manojit', bdm:'Manojit', tech:'RPA, Power Automate', type:'FD', status:'CV Shared', date:'2026-01-05', description:'RPA profile with knowledge in Power Automate desktop. Budget 1.50L.' },
    { title:'Python + Azure Developer — Ashok Kumar', client:'Manojit', bdm:'Manojit', tech:'Python, Azure', type:'FD', status:'CV Shared', date:'2026-01-10', description:'Python + Azure developer for Ashok Kumar Jalda.' },
    { title:'Full Stack React + .NET Core + SQL', client:'Manojit', bdm:'Manojit', tech:'React, .NET Core, SQL', type:'FD', status:'Pending', date:'2026-02-01', description:'3 Full Stack Developers — React, .NET Core, and SQL for Welspun.' },
    { title:'Swift/SwiftUI iOS Developer', client:'Azhar', bdm:'Azhar', tech:'Swift, SwiftUI, UIKit, iOS', type:'FD', status:'CV Shared', date:'2026-02-05', description:'Swift/SwiftUI/UIKit: 5+ years. REST/GraphQL APIs: 2+ years. CI/CD: 2+ years.' },
    { title:'Shopify Developer', client:'Manojit', bdm:'Manojit', tech:'Shopify', type:'FD', status:'CV Shared', date:'2026-03-01', description:'Shopify developer required.' },
    { title:'AI Architect (10+ yrs) — RAG/RLHF', client:'Amritendu', bdm:'Amritendu', tech:'AI, RAG, RLHF, Python, AWS, GCP, Azure', type:'FD', status:'CV Shared', date:'2026-03-04', description:'AI Architect 10+ years. RAG, RLHF, Python, AWS, GCP, Azure.' },
    { title:'AI/ML Engineer — Production Grade', client:'Amritendu', bdm:'Amritendu', tech:'AI, ML, Python, RAG, RLHF, AWS', type:'FD', status:'CV Shared', date:'2026-03-05', description:'AI/ML Engineers for production-grade AI systems. RAG, RLHF, Python-based architectures on AWS.' },
    { title:'Backend .NET Core + MongoDB (3 positions)', client:'Bikash', bdm:'Bikash', tech:'.NET Core, MongoDB, Vue.js', type:'FD', status:'Pending', date:'2026-04-01', description:'3 Backend devs (3-6 yrs) + 1 Vue.js UI developer. Healthcare domain preferred, 1-3 months.' },
    { title:'Sukolpo — DevOps + AI', client:'Bikash', bdm:'Bikash', tech:'DevOps, AI', type:'FD', status:'CV Shared', date:'2026-04-02', description:'DevOps + AI developer for Sukolpo project.' },
    { title:'Prabhat — AI LLM Developer', client:'Bikash', bdm:'Bikash', tech:'AI, LLM, Python', type:'FD', status:'CV Shared', date:'2026-04-03', description:'AI LLM developer needed.' },
  ];
  for (const r of reqs) store.requirements.push({ id:uuidv4(), ...r, created_at:new Date().toISOString() });

  store.quotations.push(
    { id:uuidv4(), requirement_id:store.requirements[0].id, vendor_name:'Tanmoy Mondal', amount:'₹27 Lakh', num_developers:'8', hours:'2500 hrs', timeline:'5-6 months', notes:'PM, TL, 2 backend, 2 frontend, 1 mobile, 1 QA', is_winner:false, created_at:new Date().toISOString() },
    { id:uuidv4(), requirement_id:store.requirements[0].id, vendor_name:'Qloron', amount:'₹25-40 Lakh', num_developers:'4', hours:'—', timeline:'—', notes:'Website ₹25L, Website+App ₹40L', is_winner:false, created_at:new Date().toISOString() },
    { id:uuidv4(), requirement_id:store.requirements[1].id, vendor_name:'Tanmoy Mondal', amount:'₹1.40 LPM', num_developers:'1', hours:'—', timeline:'Ongoing', notes:'Profile: Proparna, notice 15 days', is_winner:true, created_at:new Date().toISOString() },
  );

  // ── QUOTATIONS from real spreadsheet data ──────────────
  function addQ(reqTitle, vendor, amount, notes, isWinner) {
    const req = store.requirements.find(r => r.title === reqTitle);
    if (!req) return;
    store.quotations.push({ id:uuidv4(), requirement_id:req.id, vendor_name:vendor, amount:amount||'—', num_developers:'1', hours:'—', timeline:'—', notes:notes||'', is_winner:isWinner||false, created_at:new Date().toISOString() });
    if (isWinner) req.status = 'Closed';
  }

  // Market Index Project — .NET Redesign
  addQ('Market Index Project — .NET Redesign', 'Tanmoy Mondal', '₹27 Lakh', '2500 hours, 5-6 months', false);
  addQ('Market Index Project — .NET Redesign', 'Qloron', '₹25-40 Lakh', 'Website ₹25L / Website+App ₹40L', false);
  addQ('Market Index Project — .NET Redesign', 'Slatro Innovations', '₹17-20 Lakhs', '', false);
  addQ('Market Index Project — .NET Redesign', 'Spiral Technolabs', 'Web $14,400 / App $22,000', '', false);

  // CS Cart Multi-Vendor — PHP/Smarty Developer
  addQ('CS Cart Multi-Vendor — PHP/Smarty Developer', 'Tanmoy Mondal', '₹90k/month', 'MOHD ZAID', false);
  addQ('CS Cart Multi-Vendor — PHP/Smarty Developer', 'Hepmade', '—', '', false);
  addQ('CS Cart Multi-Vendor — PHP/Smarty Developer', 'IT Idol', '—', 'Not available', false);
  addQ('CS Cart Multi-Vendor — PHP/Smarty Developer', 'Confitech', '—', 'Soumen Laha', false);

  // Python and AI/ML Developers
  addQ('Python and AI/ML Developers', 'Tanmoy Mondal', '—', 'Prashant - Python', false);
  addQ('Python and AI/ML Developers', 'Confitech', '—', 'Prashant', false);
  addQ('Python and AI/ML Developers', 'Hepmade', '—', 'Rittika, Rohit', false);

  // .NET Angular — Welspun
  addQ('.NET Angular — Welspun', 'Confitech', '—', '', false);
  addQ('.NET Angular — Welspun', 'Tanmoy Mondal', '—', '', false);
  addQ('.NET Angular — Welspun', 'IT Idol', '—', 'Abhishek - 1 lakh', false);

  // SAP PP QM Consultant (10+ yrs)
  addQ('SAP PP QM Consultant (10+ yrs)', 'Tanmoy Mondal', '₹1.10 LPM', 'Syed', false);

  // Salesforce DevOps Engineer
  addQ('Salesforce DevOps Engineer', 'Tanmoy Mondal', '₹1.45-1.65 LPM', 'Padma ₹1.45L, Santosh ₹1.65L, Pradeep ₹1.5L, Akshay ₹90k', false);

  // BIM Developer
  addQ('BIM Developer', 'Tanmoy Mondal', '₹600/hour', 'Debanjan Pal - selected', true);

  // GenAI Developer
  addQ('GenAI Developer', 'Sai Madhu', '₹1,500/hour', '', false);

  // AI-powered Sponsorship Platform
  addQ('AI-powered Sponsorship Platform', 'Tanmoy Mondal', '₹5 Lakh', '', false);
  addQ('AI-powered Sponsorship Platform', 'Hepmade', '₹12 Lakh', '', false);
  addQ('AI-powered Sponsorship Platform', 'Yugvin', '—', "Didn't share", false);

  // Odoo Developer — Kolkata
  addQ('Odoo Developer — Kolkata', 'Tanmoy Mondal', '₹800/hour', 'Abhishek Das. Client quoted 1800/hour', false);

  // AI/ML Developer
  addQ('AI/ML Developer', 'Tanmoy Mondal', '₹4.15 Lakh total', 'Ridwan - selected', true);
  addQ('AI/ML Developer', 'Hepmade', '₹1.10 LPM', 'Rittika - CV not selected', false);

  // Shopify — Golazzo
  addQ('Shopify — Golazzo', 'Tanmoy Mondal', '₹35k', '', true);
  addQ('Shopify — Golazzo', 'Hepmade', '—', "Couldn't provide", false);

  // Python + React Developer
  addQ('Python + React Developer', 'Tanmoy Mondal', '—', '', false);
  addQ('Python + React Developer', 'Hepmade', '—', '', false);

  // Salesforce — Onsite USA
  addQ('Salesforce — Onsite USA', 'Dattu Marupaka', '20 LPA', 'Sireesha, Tavva, Anmol, Sekhar', false);
  addQ('Salesforce — Onsite USA', 'Nirag Tech', '18 LPA', '', false);

  // Full Stack Java/React + QA + DevOps
  addQ('Full Stack Java/React + QA + DevOps', 'Tanmoy Mondal (via Ananya)', '—', 'Akhil V - Java, Spring Boot, React', false);

  // Python Backend Developer (6-8 yrs)
  addQ('Python Backend Developer (6-8 yrs)', 'Tanmoy Mondal (via Ananya)', '—', 'Sai S J - Immediate Joiner - Bangalore', false);

  // Data Scientist — Networking & Graph
  addQ('Data Scientist — Networking & Graph', 'Tanmoy Mondal (via Ananya)', '₹1.20 LPM', 'Devendra R - Bangalore', false);
  addQ('Data Scientist — Networking & Graph', 'Hepmade', '—', 'Not available', false);

  // Project/Delivery Manager — PMO
  addQ('Project/Delivery Manager — PMO', 'Tanmoy Mondal', '—', 'Sukanto + Vijay', false);
  addQ('Project/Delivery Manager — PMO', 'Bhabisya Jhamnani', '—', '', false);
  addQ('Project/Delivery Manager — PMO', 'Raghav', '₹1.50 LPM', 'Anuradha', false);
  addQ('Project/Delivery Manager — PMO', 'Snehal Singh', '—', '', false);

  // .NET + Azure Developer
  addQ('.NET + Azure Developer', 'Tanmoy Mondal', '₹1.20 LPM', 'Anil', false);
  addQ('.NET + Azure Developer', 'Raghav', '₹1.70 LPM', 'Nitesh', false);
  addQ('.NET + Azure Developer', 'Snehal Singh', '—', '', false);

  // Senior Python Developer — Welspun
  addQ('Senior Python Developer — Welspun', 'Tanmoy Mondal', '₹75k/month', 'Rahul', false);
  addQ('Senior Python Developer — Welspun', 'Raghav', '₹1.30 LPM', 'Rajwinder', false);
  addQ('Senior Python Developer — Welspun', 'Confitech', '₹1 LPM', 'Sayan Kumar Das', false);

  // Senior Angular Developer (7+ yrs)
  addQ('Senior Angular Developer (7+ yrs)', 'Tanmoy Mondal', '₹1.40 LPM', 'Proparna, notice 15 days', true);

  // Senior AI Engineer (7+ yrs)
  addQ('Senior AI Engineer (7+ yrs)', 'Tanmoy Mondal', '₹1.90 LPM', 'Mrigank', false);

  // RPA + Power Automate Developer
  addQ('RPA + Power Automate Developer', 'Tanmoy Mondal', '₹85k/month', 'Basil A', false);
  addQ('RPA + Power Automate Developer', 'Confitech', '₹1 LPM + GST', 'Sayan Kumar Das', false);
  addQ('RPA + Power Automate Developer', 'IT Idol (Jinal)', '₹1.20 LPM + GST', '', false);

  // Python + Azure Developer — Ashok Kumar
  addQ('Python + Azure Developer — Ashok Kumar', 'Tanmoy Mondal', '₹85k/month', 'Anubhab', false);
  addQ('Python + Azure Developer — Ashok Kumar', 'Tanmoy Mondal', '₹90k/month', 'Haris', false);

  // Full Stack React + .NET Core + SQL
  addQ('Full Stack React + .NET Core + SQL', 'Tanmoy Mondal', '—', 'Basil A', false);
  addQ('Full Stack React + .NET Core + SQL', 'LinkedIn', '—', '', false);

  // Swift/SwiftUI iOS Developer
  addQ('Swift/SwiftUI iOS Developer', 'Tanmoy Mondal', '—', '', false);
  addQ('Swift/SwiftUI iOS Developer', 'LinkedIn', '₹1.20-1.50 LPM', 'Ritik ₹1.20L, Sadaf ₹1.50L', false);

  // Shopify Developer
  addQ('Shopify Developer', 'Tanmoy Mondal', '₹1 LPM', 'Kishan', false);

  // AI Architect (10+ yrs) — RAG/RLHF
  addQ('AI Architect (10+ yrs) — RAG/RLHF', 'Tanmoy Mondal', '₹95k/month', '', false);

  // AI/ML Engineer — Production Grade
  addQ('AI/ML Engineer — Production Grade', 'Tanmoy Mondal', '₹1.40 LPM', '', false);

  // Backend .NET Core + MongoDB (3 positions)
  addQ('Backend .NET Core + MongoDB (3 positions)', 'Tanmoy Mondal', '—', '', false);

  // Sukolpo — DevOps + AI
  addQ('Sukolpo — DevOps + AI', 'Tanmoy Mondal', '₹1,200/hour', 'Kishan', false);

  // Prabhat — AI LLM Developer
  addQ('Prabhat — AI LLM Developer', 'Tanmoy Mondal', '17,000 AED', '', false);

  // Shopify + React — Pivotee
  addQ('Shopify + React — Pivotee', 'IT Idol', '₹1 LPM', 'Nilesh, Rohit selected', true);

  // Network Engineer + Tableau + Python
  addQ('Network Engineer + Tableau + Python', 'Tanmoy Mondal', '—', '', false);
  addQ('Network Engineer + Tableau + Python', 'Kaliraj', '₹90k/month', '', false);

}