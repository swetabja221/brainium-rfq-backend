const path = require('path');
const { v4: uuidv4 } = require('uuid');

let db;
let useFile = false;

function getDb() {
  if (db) return db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(path.join(__dirname, 'brainium.db'));
    useFile = true;
    console.log('Using better-sqlite3');
  } catch(e) {
    try {
      const { Database } = require('node-sqlite3-wasm');
      db = new Database(path.join(__dirname, 'brainium.db'));
      useFile = true;
      console.log('Using node-sqlite3-wasm');
    } catch(e2) {
      console.log('Using in-memory store');
      db = createMemoryDb();
    }
  }
  if (useFile) initSchema();
  return db;
}

function createMemoryDb() {
  const store = { requirements: [], vendors: [], quotations: [], rfq_emails: [] };
  seedData(store);
  const memDb = {
    run: () => {},
    all: (sql, params = []) => {
      if (sql.includes('FROM requirements')) {
        if (params.length && sql.includes('WHERE id')) return store.requirements.filter(r => r.id === params[0]);
        return store.requirements;
      }
      if (sql.includes('FROM vendors')) {
        if (params.length && sql.includes('WHERE id')) return store.vendors.filter(v => v.id === params[0]);
        return [...store.vendors].sort((a,b) => a.name.localeCompare(b.name));
      }
      if (sql.includes('FROM quotations')) {
        if (params.length) return store.quotations.filter(q => q.requirement_id === params[0] || q.id === params[0]);
        return store.quotations;
      }
      if (sql.includes('COUNT(*)')) return [{ c: 0 }];
      return [];
    },
    _store: store,
  };
  return memDb;
}

function seedData(store) {
  // ── COMPANIES (from Vendor List tab) ──────────────────────
  const companies = [
    { name:'Santhosh Gupta', company:'Deltacubes.us', email:'santhosh.gupta3@deltacubes.us', tech:'ReactJS, NodeJS, Angular, AWS Lambda, PHP, Laravel', city:'Bengaluru', contact:'9963219974' },
    { name:'Prateek Saluja', company:'RESILIENCESOFT', email:'prateek@resiliencesoft.com', tech:'Core PHP, Codeignitor, Laravel, Angular JS, MySQL', city:'Bilaspur', contact:'9981424199' },
    { name:'Priya K', company:'Techy Geeks', email:'Priya.k@techygeeksit.com', tech:'VR, AR, Mobile App, 3D Modeling, Game Development, UI/UX', city:'Puducherry', contact:'9488611933' },
    { name:'Ravi', company:'eDelta Enterprise Solutions', email:'ravi@edeltaes.com', tech:'Angular JS, Angular 2, Ionic, AWS, Node.JS, Express.js', city:'Ahmedabad', contact:'9624300546' },
    { name:'Goutam', company:'Top Talent Hunt', email:'gautam@toptalenthunt.com', tech:'React JS, Bootstrap, CSS, HTML, MySQL, Angular, Node JS', city:'Pune', contact:'9625447855' },
    { name:'Shubham Atre', company:'Sourcebae', email:'info@sourcebae.com', tech:'Angular, PHP, Node.js, Java, Laravel, React JS, React Native, Vue.js, Flutter, Django, .NET, Python, Kotlin', city:'Indore', contact:'6232091754' },
    { name:'Akshay Rathi', company:'TechSierra.in', email:'akshay@techsierra.in', tech:'React.js, Angular, Node.js, PHP (Laravel), AWS, Azure, MySQL, MongoDB, React Native, .NET', city:'Mumbai', contact:'9819783891' },
    { name:'Atul Parihar', company:'WitArist IT Services Pvt. Ltd.', email:'atul.parihar@witarist.com', tech:'Full Stack', city:'Noida', contact:'09971842701' },
    { name:'Shalini Rathore', company:'Webority Technologies', email:'shalini@webority.com', tech:'WordPress, Shopify, Magento, Drupal, SEO, Android, iOS, Flutter, Xamarin, Cloud', city:'Gurgaon', contact:'9811938666' },
    { name:'O2Script Web Solutions', company:'O2Script Web Solutions', email:'info@o2script.com', tech:'SQLite, MySQL, Objective-C, Swift, HTML, XML, iOS, JSON', city:'Ahmedabad', contact:'9824454581' },
    { name:'Shubham', company:'She Think', email:'shubham@shethink.in', tech:'React Native, React JS, Javascript, Bootstrap, HTML, CSS', city:'Indore', contact:'6260285959' },
    { name:'Namahsof Tech', company:'Namahsof Tech', email:'director@namahsoftech.com', tech:'React JS, Node.JS, PostgreSQL, MongoDB, HTML5, CSS3', city:'Ahmedabad', contact:'8104544899' },
    { name:'Sanju', company:'GrayCell Technologies', email:'sanju@graycelltech.com', tech:'Java, Android Development, Dart, REST APIs, SQLite', city:'Noida', contact:'9582089016' },
    { name:'Bhargav', company:'TechnoThumb LLP', email:'bhargav@technothumb.com', tech:'Full Stack', city:'Ahmedabad', contact:'8866006401' },
    { name:'Rupal Gandhi', company:'QriousTech', email:'rupal.gandhi@qrioustech.com', tech:'React Js, Node Js, MERN Stack, Java, React Native, Flutter, Salesforce, Power BI, Xamarin, WordPress, Android, QA', city:'Ahmedabad', contact:'7990242189' },
    { name:'Sowmen', company:'IT Idol', email:'sowmen@itidoltechnologies.com', tech:'Full Stack, Mobile, Salesforce', city:'', contact:'91068 33252' },
    { name:'Tapan Kumar', company:'Guardians Infotech', email:'tapan@guardiansinfotech.com', tech:'Full Stack', city:'', contact:'9515333645' },
    { name:'Samadhan More', company:'Spiral Technolabs', email:'biz@spiraltechnolabs.com', tech:'Full Stack, Mobile', city:'', contact:'79844 36866' },
    { name:'Greanu Shharanya', company:'CodersBrain', email:'greanu@codersbrain.com', tech:'Full Stack, Mobile', city:'', contact:'8971280873' },
    { name:'Rajib Dutta', company:'Hepmade', email:'rajib@hepmade.com', tech:'Full Stack, Mobile, AI', city:'', contact:'98361 33368' },
    { name:'Geetimoy', company:'Confitech', email:'contact@confitechsol.com', tech:'Full Stack, Mobile', city:'', contact:'90513 59990' },
    { name:'Snehal Baraskar', company:'Qloron', email:'snehal.baraskar@qloron.com', tech:'Full Stack, Mobile, React', city:'', contact:'94055 58886' },
    { name:'Yugvin Dhamdhere', company:'Skedgroup Innovations', email:'yugvin.dhamdhere@skedgroup.in', tech:'Full Stack', city:'', contact:'88179 86931' },
    { name:'Mansi Pawar', company:'LDT Technology', email:'growth@ldttechnology.com', tech:'Full Stack', city:'', contact:'90564 21433' },
    { name:'Ashwin Tiwari', company:'Eliora Technology', email:'ashwin@elioratechno.com', tech:'Power BI, Data Analytics, Mobile & Web Development', city:'', contact:'8446619125' },
    { name:'Tausif Kovadiya', company:'Emaad Infotech', email:'tausif@emaadinfotech.com', tech:'Full Stack, PHP, React', city:'', contact:'91760014526' },
    { name:'Sanchika Mendiratta', company:'Nirag Infotech', email:'sanchika.mendiratta@niraginfotech.com', tech:'Full Stack', city:'', contact:'' },
    { name:'Akash Thakkar', company:'Aashvi Infotech', email:'akash.thakkar@aashviinfotech.com', tech:'Full Stack', city:'', contact:'90333-63180' },
    { name:'Shristy Chandgothia', company:'Sinelogix Technologies', email:'sales@sinelogixtechnologies.com', tech:'PHP, Laravel, Magento, Shopify, WordPress, React JS, Flutter, Android, iOS, Java, SEO', city:'Vadodara', contact:'8980898451' },
    { name:'Sambita Mohapatra', company:'Kudos Technolabs', email:'sambita.m@kudostechnolabs.com', tech:'Full Stack, React, Node', city:'', contact:'7847864280' },
    { name:'Raunak Mitra', company:'Influcon Digitals', email:'magento2.aditya@gmail.com', tech:'WordPress, Shopify, SEO', city:'', contact:'7439918045' },
    { name:'Raunak Agrawal', company:'Protribe Global', email:'raunak.agrawal@protribe-global.com', tech:'Full Stack, Backend, Frontend, Mobile, DevOps, Cloud, AI/ML', city:'', contact:'9106842996' },
  ];

  // ── DIRECT FREELANCERS (from Direct Freelancers tab) ──────
  const freelancers = [
    { name:'Kaustuv Basak', tech:'Java, Spring Boot, Node.JS, Python, Django, React JS, React Native', city:'Bengaluru', contact:'9384852305', email:'kbasak51903@gmail.com' },
    { name:'Kalyan Saha', tech:'ASP.NET MVC, C#.NET, Angular, React JS, Power Center, HTML5, MySQL', city:'Kolkata', contact:'9734557385', email:'kalyansaharana@rediffmail.com' },
    { name:'Jigish C', tech:'Drupal, PHP, WordPress, .Net, Javascript, HTML, CSS, Vue.JS', city:'Ahmedabad', contact:'9625447855', email:'vidhi.addweb@gmail.com' },
    { name:'Prosenjit Ghosh', tech:'Azure Data Factory, Java, Python, Data Warehousing, ETL, BI Tools, Spring Boot', city:'Kolkata', contact:'9831740771', email:'proghosh123@outlook.com' },
    { name:'Baljeet Singh', tech:'Java, Spring Boot, Microservices, AWS', city:'Mohali', contact:'8437979305', email:'beetengg@gmail.com' },
    { name:'Priyansh Purwar', tech:'Java, AWS, Spring Boot, Spring MVC', city:'Gautam Buddha Nagar', contact:'9873885880', email:'purwar.priyansh@gmail.com' },
    { name:'Hiren Patel', tech:'Java, Spring Boot, AWS, Hibernate, Microservices', city:'Ahmedabad', contact:'9427668282', email:'mca.hiren@gmail.com' },
    { name:'Dibyendu Rakshit', tech:'Java, Spring Boot, Docker, Kubernetes, Kafka, Elastic Search, AWS, MongoDB, MySQL', city:'Bengaluru', contact:'6361276886', email:'dibyendu.rakshit.83@gmail.com' },
    { name:'Ratnesh Kumar', tech:'Java, Spring Boot, Hibernate, Oracle, Postgres, AWS, Bootstrap, Android', city:'Mumbai', contact:'9920831441', email:'ratnesh.mca@gmail.com' },
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
    { name:'Raghvendra Raghuvanshi', tech:'Core Java, JavaScript, Selenium WebDriver, TestNG, Cucumber BDD, REST Assured, Jenkins, Docker', city:'Noida', contact:'9340217143', email:'raghvendrar015@gmail.com' },
    { name:'Akhilesh Jain', tech:'MongoDB, Golang, Kafka, Cassandra, Docker, Zookeeper, SQL, PostgreSQL', city:'Pune', contact:'8796435818', email:'akhileshjain19@gmail.com' },
    { name:'Arun Kumaar S', tech:'Golang, Go, AWS, Serverless, Python, SQL, NoSQL', city:'Bengaluru', contact:'9791601406', email:'arunthuvini@gmail.com' },
    { name:'Nishant Hiremath', tech:'Golang, PostgreSQL, MongoDB, Git, Microservices', city:'Mumbai', contact:'7738500286', email:'nishire27@gmail.com' },
    { name:'Provat Das', tech:'PHP, Laravel, HTML, CSS, Node, Vue, Angular', city:'Kolkata', contact:'9832996894', email:'' },
    { name:'Surajit Datta', tech:'HTML, CSS, JavaScript, React, Redux, Node.js, Express, MongoDB', city:'', contact:'7908216496', email:'bubuldatta91314@gmail.com' },
    { name:'Ritik Kohar', tech:'Remix, ReactJS, Node JS, Full Stack', city:'', contact:'93063 32262', email:'ritikkochar2@gmail.com' },
    { name:'Deepansh Tandon', tech:'Next.js, React, JavaScript, Java, SpringBoot, Microservices, PostgreSQL, CI/CD, Docker', city:'', contact:'9123090375', email:'Deepansh.tandon@gmail.com' },
    { name:'Palvin Muthesh', tech:'React Native, Ionic, Flutter, MEAN, MERN, JS Frameworks', city:'Remote', contact:'96293 17140', email:'rrabbit2121@gmail.com' },
    { name:'Abhishek Kumar Ram', tech:'Python, Machine Learning, Deep Learning, AI, Generative AI, LLMs, Power BI, Data Science', city:'', contact:'9123082964', email:'' },
    { name:'Sairam', tech:'Boomi Developer', city:'', contact:'90004 88840', email:'' },
    { name:'Anirban Patra', tech:'Data Science', city:'', contact:'8159071050', email:'anirbanpatra79@gmail.com' },
    { name:'Pranav Singhal', tech:'Blockchain, Cloud, Product Management, Visualization', city:'Hyderabad', contact:'8861200127', email:'pranavrox92@gmail.com' },
    { name:'Abhrajyoti Sen', tech:'Blockchain, MERN Stack, Hyperledger Fabric, Python, Go, NodeJS, AWS', city:'Kolkata', contact:'9038928864', email:'abhrajyoti700@gmail.com' },
  ];

  for (const v of companies) {
    store.vendors.push({ id: uuidv4(), name: v.name, company: v.company, email: v.email || '', tech: v.tech, city: v.city || '', type: 'Company', contact: v.contact || '', created_at: new Date().toISOString() });
  }
  for (const v of freelancers) {
    store.vendors.push({ id: uuidv4(), name: v.name, company: 'Freelancer', email: v.email || '', tech: v.tech, city: v.city || '', type: 'Freelancer', contact: v.contact || '', created_at: new Date().toISOString() });
  }

  // ── REQUIREMENTS ──────────────────────────────────────────
  const reqs = [
    { title:'Market Index Project — .NET Redesign', client:'Brainium (Gaurav)', bdm:'Gaurav', tech:'.NET, React, Mobile App', type:'FC', status:'Pending', date:'2025-05-21', description:'Redesign of https://www.marketindex.com.au/ — website + mobile app. Need price quote separately for web and app.' },
    { title:'Senior Angular Developer (7+ yrs)', client:'Amritendu', bdm:'Amritendu', tech:'Angular 7+', type:'FD', status:'CV Shared', date:'2025-12-10', description:'7+ yrs Angular developer, budget ₹1.2 LPM, remote, immediately available.' },
    { title:'AI/ML Developer', client:'Bikash', bdm:'Bikash', tech:'AI, ML, Python', type:'FD', status:'Closed', date:'2025-06-10', description:'Python AI/ML developer for project delivery. Budget around 1 Lakh/month.' },
    { title:'Backend .NET Core + MongoDB (3 positions)', client:'Bikash', bdm:'Bikash', tech:'.NET Core, MongoDB, Vue.js', type:'FD', status:'Pending', date:'2026-04-01', description:'3 Backend devs (3-6 yrs) + 1 Vue.js UI developer. Healthcare domain preferred, 1-3 months.' },
    { title:'Shopify + React — Pivotee', client:'Manojit', bdm:'Manojit', tech:'Shopify, React', type:'FD', status:'Closed', date:'2025-09-04', description:'Full-time Shopify + React developers needed for Pivotee client.' },
  ];

  for (const r of reqs) {
    store.requirements.push({ id: uuidv4(), ...r, created_at: new Date().toISOString() });
  }

  // Seed quotes for first requirement
  store.quotations.push(
    { id: uuidv4(), requirement_id: store.requirements[0].id, vendor_name: 'Tanmoy Mondal', amount: '₹27 Lakh', num_developers: '8', hours: '2500 hrs', timeline: '5-6 months', notes: 'Includes PM, TL, 2 backend, 2 frontend, 1 mobile, 1 QA', created_at: new Date().toISOString() },
    { id: uuidv4(), requirement_id: store.requirements[0].id, vendor_name: 'Qloron', amount: '₹25-40 Lakh', num_developers: '4', hours: '—', timeline: '—', notes: 'Website ₹25L, Website+App ₹40L', created_at: new Date().toISOString() },
    { id: uuidv4(), requirement_id: store.requirements[1].id, vendor_name: 'Qloron', amount: '₹1.40 LPM', num_developers: '1', hours: '—', timeline: 'Ongoing', notes: 'Profile: Proparna, notice 15 days', created_at: new Date().toISOString() },
  );
}

function initSchema() {
  db.run(`CREATE TABLE IF NOT EXISTS requirements (id TEXT PRIMARY KEY, title TEXT NOT NULL, client TEXT, bdm TEXT, tech TEXT, type TEXT, status TEXT DEFAULT 'Pending', date TEXT, description TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, email TEXT, tech TEXT, city TEXT, type TEXT DEFAULT 'Company', contact TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS quotations (id TEXT PRIMARY KEY, requirement_id TEXT, vendor_id TEXT, vendor_name TEXT, amount TEXT, num_developers TEXT, hours TEXT, timeline TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')))`);
  db.run(`CREATE TABLE IF NOT EXISTS rfq_emails (id TEXT PRIMARY KEY, requirement_id TEXT, vendor_emails TEXT, subject TEXT, body TEXT, sent_at TEXT DEFAULT (datetime('now')), status TEXT)`);
  const count = db.all('SELECT COUNT(*) as c FROM vendors')[0].c;
  if (count === 0) {
    const mem = createMemoryDb()._store;
    for (const v of mem.vendors) db.run('INSERT INTO vendors (id,name,company,email,tech,city,type,contact) VALUES (?,?,?,?,?,?,?,?)', [v.id,v.name,v.company,v.email,v.tech,v.city,v.type,v.contact]);
    for (const r of mem.requirements) db.run('INSERT INTO requirements (id,title,client,bdm,tech,type,status,date,description) VALUES (?,?,?,?,?,?,?,?,?)', [r.id,r.title,r.client,r.bdm,r.tech,r.type,r.status,r.date,r.description]);
    for (const q of mem.quotations) db.run('INSERT INTO quotations (id,requirement_id,vendor_name,amount,num_developers,hours,timeline,notes) VALUES (?,?,?,?,?,?,?,?)', [q.id,q.requirement_id,q.vendor_name,q.amount,q.num_developers,q.hours,q.timeline,q.notes]);
  }
}

module.exports = { getDb };
