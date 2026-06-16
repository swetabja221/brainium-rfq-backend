const { v4: uuidv4 } = require('uuid');

let tursoClient = null;
let memStore = null;

function getTurso() {
  if (tursoClient) return tursoClient;
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) return null;
  try {
    const { createClient } = require('@libsql/client');
    const url = process.env.TURSO_URL.replace('libsql://', 'https://');
    tursoClient = createClient({ url, authToken: process.env.TURSO_TOKEN });
    console.log('Connected to Turso');
    return tursoClient;
  } catch(e) {
    console.log('Turso failed:', e.message);
    return null;
  }
}

function getMemStore() {
  if (memStore) return memStore;
  memStore = { requirements: [], vendors: [], quotations: [], rfq_emails: [] };
  seedData(memStore);
  return memStore;
}

async function initTurso(client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, title TEXT NOT NULL, client TEXT, bdm TEXT, tech TEXT, type TEXT, status TEXT DEFAULT 'Pending', date TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT, tech TEXT, city TEXT, type TEXT DEFAULT 'Company', contact TEXT, blacklisted INTEGER DEFAULT 0, blacklist_reason TEXT, blacklisted_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS quotations (id TEXT PRIMARY KEY, requirement_id TEXT, vendor_id TEXT, vendor_name TEXT, amount TEXT, num_developers TEXT, hours TEXT, timeline TEXT, notes TEXT, is_winner INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS rfq_emails (id TEXT PRIMARY KEY, requirement_id TEXT, vendor_emails TEXT, subject TEXT, body TEXT, status TEXT, attachment_name TEXT, error_message TEXT, sent_at TEXT DEFAULT (datetime('now')))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT)`);
}

async function seedTurso(client) {
  const store = { requirements: [], vendors: [], quotations: [] };
  seedData(store);
  for (const v of store.vendors) {
    try { await client.execute({ sql: 'INSERT OR IGNORE INTO vendors (id,name,company,email,tech,city,type,contact,blacklisted,blacklist_reason) VALUES (?,?,?,?,?,?,?,?,0,?)', args: [v.id,v.name,v.company,v.email,v.tech,v.city,v.type,v.contact,''] }); } catch(e) {}
  }
  for (const r of store.requirements) {
    try { await client.execute({ sql: 'INSERT OR IGNORE INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)', args: [r.id,r.title,r.client,r.bdm,r.tech,r.type,r.status,r.date,r.description] }); } catch(e) {}
  }
  for (const q of store.quotations) {
    try { await client.execute({ sql: 'INSERT OR IGNORE INTO quotations (id,requirement_id,vendor_name,amount,num_developers,hours,timeline,notes,is_winner) VALUES (?,?,?,?,?,?,?,?,?)', args: [q.id,q.requirement_id,q.vendor_name,q.amount,q.num_developers,q.hours,q.timeline,q.notes,q.is_winner?1:0] }); } catch(e) {}
  }
  const vc = await client.execute('SELECT COUNT(*) as c FROM vendors');
  const rc = await client.execute('SELECT COUNT(*) as c FROM requirements');
  console.log(`Seeded: ${vc.rows[0].c} vendors, ${rc.rows[0].c} reqs`);
}

async function query(sql, args = []) {
  const client = getTurso();
  if (client) {
    const result = await client.execute({ sql, args });
    return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
  }
  const store = getMemStore();
  if (sql.includes('FROM requirements')) {
    if (args.length && sql.includes('WHERE id')) return store.requirements.filter(r => r.id === args[0]);
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
  if (sql.includes('FROM rfq_emails')) return [...(store.rfq_emails||[])].sort((a,b) => new Date(b.sent_at)-new Date(a.sent_at));
  return [{ c: 0 }];
}

async function execute(sql, args = []) {
  const client = getTurso();
  if (client) { await client.execute({ sql, args }); return; }
  const store = getMemStore();
  if (sql.startsWith('INSERT INTO requirements')) {
    store.requirements.unshift({ id:args[0],title:args[1],client:args[2],bdm:args[3],tech:args[4],type:args[5],status:args[6],date:args[7],description:args[8],created_at:new Date().toISOString() });
  } else if (sql.startsWith('INSERT INTO vendors')) {
    store.vendors.push({ id:args[0],name:args[1],company:args[2],email:args[3],tech:args[4],city:args[5],type:args[6],contact:args[7],blacklisted:false,blacklist_reason:'',created_at:new Date().toISOString() });
  } else if (sql.startsWith('INSERT INTO quotations')) {
    store.quotations.push({ id:args[0],requirement_id:args[1],vendor_id:args[2],vendor_name:args[3],amount:args[4],num_developers:args[5],hours:args[6],timeline:args[7],notes:args[8],is_winner:args[9]===1,created_at:new Date().toISOString() });
  } else if (sql.startsWith('INSERT INTO rfq_emails')) {
    (store.rfq_emails=store.rfq_emails||[]).push({ id:args[0],requirement_id:args[1],vendor_emails:args[2],subject:args[3],body:args[4],status:args[5],attachment_name:args[6]||'',error_message:args[7]||'',sent_at:new Date().toISOString() });
  } else if (sql.startsWith('UPDATE requirements')) {
    const id=args[args.length-1]; const r=store.requirements.find(x=>x.id===id);
    if(r){['title','client','bdm','tech','type','status','description'].forEach((k,i)=>{if(args[i]!==undefined&&args[i]!==null)r[k]=args[i];});}
  } else if (sql.startsWith('UPDATE vendors')) {
    const id=args[args.length-1]; const v=store.vendors.find(x=>x.id===id);
    if(v){if(sql.includes('blacklisted=1')){v.blacklisted=true;v.blacklist_reason=args[0];v.blacklisted_at=args[1];}else if(sql.includes('blacklisted=0')){v.blacklisted=false;v.blacklist_reason='';v.blacklisted_at=null;}else{['name','company','email','tech','city','type','contact'].forEach((k,i)=>{if(args[i]!==undefined&&args[i]!==null)v[k]=args[i];});}}
  } else if (sql.startsWith('UPDATE quotations')) {
    if(sql.includes('is_winner = 0'))store.quotations.filter(x=>x.requirement_id===args[0]).forEach(x=>x.is_winner=false);
    const q=store.quotations.find(x=>x.id===args[args.length-1]);
    if(q&&sql.includes('is_winner = 1'))q.is_winner=true;
    if(sql.includes("status = 'Closed'")){const r=store.requirements.find(x=>x.id===args[0]);if(r)r.status='Closed';}
  } else if (sql.startsWith('DELETE FROM quotations')) {
    store.quotations=store.quotations.filter(q=>q.id!==args[0]&&q.requirement_id!==args[0]);
  } else if (sql.startsWith('DELETE FROM requirements')) {
    store.requirements=store.requirements.filter(r=>r.id!==args[0]);
    store.quotations=store.quotations.filter(q=>q.requirement_id!==args[0]);
  } else if (sql.startsWith('DELETE FROM vendors')) {
    store.vendors=store.vendors.filter(v=>v.id!==args[0]);
  }
}

async function init() {
  const client = getTurso();
  if (client) {
    await initTurso(client);
    // Check if already seeded with correct count
    const vc = await client.execute('SELECT COUNT(*) as c FROM vendors');
    const rc = await client.execute('SELECT COUNT(*) as c FROM requirements');
    const vendorCount = Number(vc.rows[0].c);
    const reqCount = Number(rc.rows[0].c);
    console.log(`Current DB: ${vendorCount} vendors, ${reqCount} reqs`);
    // If wrong counts, clean and reseed
    if (vendorCount < 70 || vendorCount > 80 || reqCount > 40 || reqCount < 30) {
      console.log('Counts wrong — cleaning and reseeding...');
      await client.execute('DELETE FROM quotations');
      await client.execute('DELETE FROM requirements');
      await client.execute('DELETE FROM vendors');
      await seedTurso(client);
    } else {
      console.log('DB looks correct — skipping reseed.');
    }
  } else {
    console.log('No Turso config — using in-memory store.');
    getMemStore();
  }
}

module.exports = { query, execute, init, uuidv4, getTurso, getMemStore };

// ── Seed Data ──────────────────────────────────────────────
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
    { name:'O2Script Web Solutions', company:'O2Script Web Solutions', email:'info@o2script.com', tech:'SQLite, MySQL, Objective-C, Swift, HTML, XML, iOS, JSON', city:'Ahmedabad', contact:'9824454581' },
    { name:'Shubham', company:'She Think', email:'shubham@shethink.in', tech:'React Native, React JS, Javascript, Bootstrap, HTML, CSS', city:'Indore', contact:'6260285959' },
    { name:'Namahsof Tech', company:'Namahsof Tech', email:'director@namahsoftech.com', tech:'React JS, Node.JS, PostgreSQL, MongoDB, HTML5, CSS3', city:'Ahmedabad', contact:'8104544899' },
    { name:'Sanju', company:'GrayCell Technologies', email:'sanju@graycelltech.com', tech:'Java, Android Development, Dart, REST APIs, SQLite', city:'Noida', contact:'9582089016' },
    { name:'Rupal Gandhi', company:'QriousTech', email:'rupal.gandhi@qrioustech.com', tech:'React Js, Node Js, MERN, Java, React Native, Flutter, Salesforce, Power BI, WordPress', city:'Ahmedabad', contact:'7990242189' },
    { name:'Sowmen', company:'IT Idol', email:'sowmen@itidoltechnologies.com', tech:'Full Stack, Mobile, Salesforce', city:'', contact:'9106833252' },
    { name:'Tapan Kumar', company:'Guardians Infotech', email:'tapan@guardiansinfotech.com', tech:'Full Stack, DevOps', city:'', contact:'9515333645' },
    { name:'Samadhan More', company:'Spiral Technolabs', email:'biz@spiraltechnolabs.com', tech:'Full Stack, Mobile, React', city:'', contact:'7984436866' },
    { name:'Greanu Shharanya', company:'CodersBrain', email:'greanu@codersbrain.com', tech:'Full Stack, Mobile, AI', city:'', contact:'8971280873' },
    { name:'Rajib Dutta', company:'Hepmade', email:'rajib@hepmade.com', tech:'Full Stack, Mobile, AI, Web', city:'', contact:'9836133368' },
    { name:'Geetimoy', company:'Confitech', email:'contact@confitechsol.com', tech:'Full Stack, Mobile, Web', city:'', contact:'9051359990' },
    { name:'Snehal Baraskar', company:'Qloron', email:'snehal.baraskar@qloron.com', tech:'Full Stack, Mobile, React, Node', city:'', contact:'9405558886' },
    { name:'Ashwin Tiwari', company:'Eliora Technology', email:'ashwin@elioratechno.com', tech:'Power BI, Data Analytics, Mobile & Web Development', city:'', contact:'8446619125' },
    { name:'Akash Thakkar', company:'Aashvi Infotech', email:'akash.thakkar@aashviinfotech.com', tech:'Full Stack, Mobile, Web', city:'', contact:'9033363180' },
    { name:'Shristy Chandgothia', company:'Sinelogix Technologies', email:'sales@sinelogixtechnologies.com', tech:'PHP, Laravel, Magento, Shopify, WordPress, React JS, Flutter, Android, iOS, Java', city:'Vadodara', contact:'8980898451' },
    { name:'Sambita Mohapatra', company:'Kudos Technolabs', email:'sambita.m@kudostechnolabs.com', tech:'Full Stack, React, Node', city:'', contact:'7847864280' },
    { name:'Raunak Mitra', company:'Influcon Digitals', email:'magento2.aditya@gmail.com', tech:'WordPress, Shopify, SEO, Magento', city:'', contact:'7439918045' },
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
    { name:'Adil Khan', tech:'Java, Android Studio, HTML5, React JS, Angular, Bootstrap, Spring Boot, MySQL', city:'Noida', contact:'9873648143', email:'adilkhant0666@gmail.com' },
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
    { title:'Market Index Project — .NET Redesign', client:'Gaurav', bdm:'Gaurav', tech:'.NET, React, Mobile App', type:'FC', status:'Pending', date:'2025-05-21', description:'Redesign of marketindex.com.au — website + mobile app.' },
    { title:'CS Cart Multi-Vendor — PHP/Smarty', client:'Dave', bdm:'Dave', tech:'PHP, Smarty, CS Cart', type:'FD', status:'CV Shared', date:'2025-05-01', description:'CS Cart Multi-Vendor Ultimate. PHP, Smarty, hooks troubleshooting.' },
    { title:'Python and AI/ML Developers', client:'Payel', bdm:'Payel', tech:'Python, AI, ML', type:'FD', status:'CV Shared', date:'2025-05-02', description:'Python and AI/ML developers needed.' },
    { title:'.NET Angular — Welspun', client:'Manojit', bdm:'Manojit', tech:'.NET, Angular', type:'FD', status:'CV Shared', date:'2025-05-03', description:'.NET and Angular developers for Welspun client.' },
    { title:'SAP PP QM Consultant (10+ yrs)', client:'Manojit', bdm:'Manojit', tech:'SAP PP, SAP QM', type:'FD', status:'CV Shared', date:'2025-05-07', description:'SAP PP QM consultant. WFH. Budget 1,40,000/month.' },
    { title:'Salesforce DevOps Engineer', client:'Manojit', bdm:'Manojit', tech:'Salesforce, DevOps', type:'FD', status:'CV Shared', date:'2025-05-08', description:'Salesforce DevOps Engineer required.' },
    { title:'BIM Developer', client:'Manojit', bdm:'Manojit', tech:'BIM, Autodesk', type:'TM', status:'Closed', date:'2025-05-12', description:'BIM developer needed. Debanjan Pal selected.' },
    { title:'GenAI Developer', client:'Manojit', bdm:'Manojit', tech:'GenAI, Python, LLM', type:'TM', status:'CV Shared', date:'2025-05-14', description:'Generative AI developer for project work.' },
    { title:'AI-powered Sponsorship Platform', client:'Monojit', bdm:'Monojit', tech:'AI, Full Stack', type:'FC', status:'Estimation given', date:'2025-05-17', description:'AI-powered sponsorship platform development.' },
    { title:'Odoo Developer — Kolkata', client:'Bikash', bdm:'Bikash', tech:'Odoo, Python', type:'TM', status:'Lost', date:'2025-06-01', description:'Odoo developer needed in Kolkata.' },
    { title:'AI/ML Developer', client:'Bikash', bdm:'Bikash', tech:'AI, ML, Python', type:'FD', status:'Closed', date:'2025-06-10', description:'Python AI/ML developer. Budget around 1 Lakh/month.' },
    { title:'Shopify — Golazzo', client:'Monojit', bdm:'Monojit', tech:'Shopify', type:'FC', status:'Closed', date:'2025-06-03', description:'Shopify development for Golazzo client.' },
    { title:'Python + React Developer', client:'Bikash', bdm:'Bikash', tech:'Python, React', type:'FD', status:'CV Shared', date:'2025-06-06', description:'Python and React developer needed.' },
    { title:'Salesforce — Onsite USA', client:'Manojit', bdm:'Manojit', tech:'Salesforce', type:'FD', status:'Pending', date:'2025-06-24', description:'Salesforce developer onsite in USA. Green card holders only.' },
    { title:'ServiceNow — Sukolpo', client:'Bikash', bdm:'Bikash', tech:'ServiceNow', type:'FD', status:'Pending', date:'2025-08-01', description:'ServiceNow resources needed.' },
    { title:'Shopify + React — Pivotee', client:'Manojit', bdm:'Manojit', tech:'Shopify, React', type:'FD', status:'Closed', date:'2025-09-04', description:'Full-time Shopify + React developers for Pivotee.' },
    { title:'Full Stack Java/React + QA + DevOps', client:'Manojit', bdm:'Manojit', tech:'Java, Spring Boot, React, QA, DevOps', type:'FD', status:'CV Shared', date:'2025-09-09', description:'Full Stack 2, QA 2, DevOps 1. Hyderabad.' },
    { title:'French Speaking Unity Developer', client:'Bikash', bdm:'Bikash', tech:'Unity, C#', type:'FD', status:'CV Shared', date:'2025-09-10', description:'French speaking Unity developer required.' },
    { title:'Python Backend Developer (6-8 yrs)', client:'Azhar', bdm:'Azhar', tech:'Python, Flask, FastAPI, Django, AWS, MongoDB', type:'FD', status:'CV Shared', date:'2025-10-01', description:'6-8 years Python backend. Noida/Pune/Bangalore hybrid.' },
    { title:'Network Engineer + Tableau + Python', client:'Amritendu', bdm:'Amritendu', tech:'Network, Tableau, Python', type:'FD', status:'CV Shared', date:'2025-10-09', description:'Network Engineer, Senior Tableau Developer, Sr. Python Engineer.' },
    { title:'Data Scientist — Networking & Graph', client:'Sweety', bdm:'Sweety', tech:'Data Science, Python, NetworkX, PySpark, Azure', type:'FD', status:'CV Shared', date:'2025-11-24', description:'Data Scientist specializing in network design, graph-based modeling.' },
    { title:'Project/Delivery Manager — PMO', client:'Manojit', bdm:'Manojit', tech:'PMO, Jira, Agile, PRINCE2', type:'FD', status:'CV Shared', date:'2025-12-01', description:'Project/Delivery Manager with IT governance, PMO best practices.' },
    { title:'.NET + Azure Developer', client:'Manojit', bdm:'Manojit', tech:'.NET, Azure', type:'FD', status:'CV Shared', date:'2025-12-02', description:'.NET and Azure developer required.' },
    { title:'Senior Python Developer — Welspun', client:'Manojit', bdm:'Manojit', tech:'Python, Full Stack', type:'FD', status:'CV Shared', date:'2025-12-03', description:'Senior Python developer for Welspun client.' },
    { title:'Senior Angular Developer (7+ yrs)', client:'Amritendu', bdm:'Amritendu', tech:'Angular 7+', type:'FD', status:'Closed', date:'2025-12-10', description:'7+ yrs Angular developer, budget 1.2 LPM, remote.' },
    { title:'Senior AI Engineer (7+ yrs)', client:'Amritendu', bdm:'Amritendu', tech:'AI, ML, Python, LLM', type:'FD', status:'CV Shared', date:'2025-12-11', description:'Senior AI Engineer, 7+ years, budget 1.4 LPM, remote.' },
    { title:'RPA + Power Automate Developer', client:'Manojit', bdm:'Manojit', tech:'RPA, Power Automate', type:'FD', status:'CV Shared', date:'2026-01-05', description:'RPA profile with Power Automate desktop knowledge.' },
    { title:'Python + Azure Developer — Ashok Kumar', client:'Manojit', bdm:'Manojit', tech:'Python, Azure', type:'FD', status:'CV Shared', date:'2026-01-10', description:'Python + Azure developer for Ashok Kumar Jalda.' },
    { title:'Full Stack React + .NET Core + SQL', client:'Manojit', bdm:'Manojit', tech:'React, .NET Core, SQL', type:'FD', status:'Pending', date:'2026-02-01', description:'3 Full Stack Developers for Welspun.' },
    { title:'Swift/SwiftUI iOS Developer', client:'Azhar', bdm:'Azhar', tech:'Swift, SwiftUI, UIKit, iOS', type:'FD', status:'CV Shared', date:'2026-02-05', description:'Swift/SwiftUI/UIKit: 5+ years.' },
    { title:'Shopify Developer', client:'Manojit', bdm:'Manojit', tech:'Shopify', type:'FD', status:'CV Shared', date:'2026-03-01', description:'Shopify developer required.' },
    { title:'AI Architect (10+ yrs) — RAG/RLHF', client:'Amritendu', bdm:'Amritendu', tech:'AI, RAG, RLHF, Python, AWS, GCP, Azure', type:'FD', status:'CV Shared', date:'2026-03-04', description:'AI Architect 10+ years. RAG, RLHF, Python, AWS, GCP, Azure.' },
    { title:'AI/ML Engineer — Production Grade', client:'Amritendu', bdm:'Amritendu', tech:'AI, ML, Python, RAG, RLHF, AWS', type:'FD', status:'CV Shared', date:'2026-03-05', description:'AI/ML Engineers for production-grade AI systems.' },
    { title:'Backend .NET Core + MongoDB (3 positions)', client:'Bikash', bdm:'Bikash', tech:'.NET Core, MongoDB, Vue.js', type:'FD', status:'Pending', date:'2026-04-01', description:'3 Backend devs + 1 Vue.js UI developer. Healthcare domain.' },
    { title:'Sukolpo — DevOps + AI', client:'Bikash', bdm:'Bikash', tech:'DevOps, AI', type:'FD', status:'CV Shared', date:'2026-04-02', description:'DevOps + AI developer for Sukolpo project.' },
    { title:'Prabhat — AI LLM Developer', client:'Bikash', bdm:'Bikash', tech:'AI, LLM, Python', type:'FD', status:'CV Shared', date:'2026-04-03', description:'AI LLM developer needed.' },
  ];
  for (const r of reqs) store.requirements.push({ id:uuidv4(), ...r, created_at:new Date().toISOString() });
}
