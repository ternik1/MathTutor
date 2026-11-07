// server.js
// Zaženi:
//   $env:GROQ_API_KEY="gsk_..."
//   $env:MONGODB_URI="mongodb+srv://..."
//   node server.js

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️  GROQ_API_KEY ni nastavljen.');
}
if (!process.env.MONGODB_URI) {
  console.error('❌ MONGODB_URI ni nastavljen!');
}

/* ============================================================
   POMOŽNE
   ============================================================ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeLatex(s) {
  if (!s) return s;
  return String(s).replace(/\\\\/g, '\\');
}

function parseNumberString(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim().replace(/\s+/g, '').replace(',', '.');
  if (s === '') return NaN;
  const frac = s.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) {
    const a = parseFloat(frac[1]); const b = parseFloat(frac[2]);
    if (isNaN(a) || isNaN(b) || b === 0) return NaN;
    return a / b;
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function extractNumbers(text) {
  if (!text) return [];
  const nums = [];
  const fracRe = /\\frac\{(-?\d+(?:[.,]\d+)?)\}\{(-?\d+(?:[.,]\d+)?)\}/g;
  let m;
  while ((m = fracRe.exec(text)) !== null) {
    const a = parseFloat(m[1].replace(',', '.'));
    const b = parseFloat(m[2].replace(',', '.'));
    if (!isNaN(a)) nums.push(a);
    if (!isNaN(b)) nums.push(b);
  }
  const cleaned = text.replace(fracRe, ' ');
  const numRe = /-?\d+(?:[.,]\d+)?/g;
  while ((m = numRe.exec(cleaned)) !== null) {
    const n = parseFloat(m[0].replace(',', '.'));
    if (!isNaN(n)) nums.push(n);
  }
  return nums;
}
function extractOps(text) {
  if (!text) return '';
  const ops = [];
  if (/\+/.test(text)) ops.push('+');
  if (/-|−/.test(text)) ops.push('-');
  if (/\\cdot|·|\*|\\times/.test(text)) ops.push('*');
  if (/\/|:|\\div/.test(text)) ops.push('/');
  if (/\\sqrt/.test(text)) ops.push('sqrt');
  if (/\^/.test(text)) ops.push('^');
  return ops.sort().join('');
}
function numbersOverlap(a, b) {
  if (!a.length || !b.length) return false;
  const setA = new Set(a.map(x => Math.abs(x).toFixed(4)));
  const setB = new Set(b.map(x => Math.abs(x).toFixed(4)));
  let common = 0;
  setA.forEach(x => { if (setB.has(x)) common++; });
  const minSize = Math.min(setA.size, setB.size);
  return minSize > 0 && common / minSize >= 0.75;
}
function isTooSimilar(newTask, recentTasks) {
  if (!newTask || !newTask.question) return false;
  const newNums = extractNumbers(newTask.question);
  const newOps = extractOps(newTask.question);
  for (const t of recentTasks) {
    if (!t || !t.question) continue;
    const oldNums = extractNumbers(t.question);
    const oldOps = extractOps(t.question);
    if (newOps === oldOps && numbersOverlap(newNums, oldNums)) return true;
  }
  return false;
}

function slug(s) {
  return String(s).toLowerCase()
    .replace(/[čć]/g, 'c').replace(/[š]/g, 's').replace(/[ž]/g, 'z').replace(/[đ]/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}
function generateUsername(firstName, lastName, existing) {
  const base = slug(firstName.charAt(0) + lastName);
  let candidate = base; let i = 1;
  while (existing[candidate]) { candidate = base + i; i++; }
  return candidate;
}
function generatePassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 6; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return p;
}

/* ============================================================
   GROQ ODJEMALEC
   ============================================================ */
const groqClient = new OpenAI({
  apiKey: process.env.GROQ_API_KEY || 'manjka-groq',
  baseURL: 'https://api.groq.com/openai/v1'
});

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

/* ============================================================
   SHRAMBA – MongoDB Atlas
   ============================================================ */
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient = null;
let db = null;

let DATA = {
  users: {}, chapters: [], stats: {}, analyses: {}, autoAnalyzed: {}, sessions: {},
  recentTasks: {}
};

async function connectDB() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI ni nastavljen. Strežnik se ne more zagnati.');
    process.exit(1);
  }
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db('matematicni-tutor');
    console.log('✅ Povezan na MongoDB Atlas.');

    const usersDocs = await db.collection('users').find({}).toArray();
    usersDocs.forEach(d => { DATA.users[d._id] = d.value; });

    const chapterDocs = await db.collection('chapters').find({}).toArray();
    DATA.chapters = chapterDocs.map(d => d.value);

    const statsDocs = await db.collection('stats').find({}).toArray();
    statsDocs.forEach(d => { DATA.stats[d._id] = d.value; });

    const analysesDocs = await db.collection('analyses').find({}).toArray();
    analysesDocs.forEach(d => { DATA.analyses[d._id] = d.value; });

    const sessionsDocs = await db.collection('sessions').find({}).toArray();
    sessionsDocs.forEach(d => { DATA.sessions[d._id] = d.value; });

    const recentDocs = await db.collection('recentTasks').find({}).toArray();
    recentDocs.forEach(d => { DATA.recentTasks[d._id] = d.value; });

    if (!DATA.users['ucitelj']) {
      DATA.users['ucitelj'] = {
        firstName: 'Učitelj', lastName: '', grade: null,
        password: 'ucitelj123', role: 'admin'
      };
      await saveData();
      console.log('✅ Ustvarjen učiteljski račun.');
    }
  } catch (err) {
    console.error('❌ Napaka pri povezavi na MongoDB:', err.message);
    process.exit(1);
  }
}

async function saveData() {
  if (!db) return;
  try {
    for (const [key, val] of Object.entries(DATA.users)) {
      await db.collection('users').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    }
    for (const ch of DATA.chapters) {
      await db.collection('chapters').updateOne({ _id: ch.id }, { $set: { value: ch } }, { upsert: true });
    }
    for (const [key, val] of Object.entries(DATA.stats)) {
      await db.collection('stats').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    }
    for (const [key, val] of Object.entries(DATA.analyses)) {
      await db.collection('analyses').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    }
    for (const [key, val] of Object.entries(DATA.sessions)) {
      await db.collection('sessions').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    }
    for (const [key, val] of Object.entries(DATA.recentTasks)) {
      await db.collection('recentTasks').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    }
  } catch (err) {
    console.warn('Napaka pri shranjevanju v MongoDB:', err.message);
  }
}

/* ============================================================
   STROGA LESTVICA TEŽAVNOSTI
   ============================================================ */
function strictLevelRules(grade, topic) {
  const t = (topic || '').toLowerCase();
  const isCelaStevila = t.includes('celo') || t.includes('cela') || t.includes('negativ') || t.includes('predznak');
  const isUlomki = t.includes('ulom');
  const isDecimalna = t.includes('decimal');
  const isPotence = t.includes('potenc') || t.includes('koren');
  const isOdstotki = t.includes('odstot');
  const isEnacbe = t.includes('enačb') || t.includes('enacb');
  const isGeometrija = t.includes('geometr') || t.includes('pitagor') || t.includes('krog') || t.includes('kot') || t.includes('trikot') || t.includes('lik') || t.includes('telo') || t.includes('koordinat');

  if (isCelaStevila) {
    return {
      1: 'seštevanje in odštevanje ENOMESTNIH celih števil (npr. 3 + (−4), −2 + 5). Števila od −9 do 9.',
      2: 'seštevanje in odštevanje DVOMESTNIH celih števil (npr. 23 + (−14), −45 + 12). Števila od −99 do 99.',
      3: 'množenje ali deljenje enomestnih celih števil (npr. (−3) · 4, −20 : 5). Rezultat naj bo celo število.',
      4: 'kombinacija dveh operacij z dvomestnimi celimi števili (npr. −12 + 3 · (−4)).',
      5: 'besedilna naloga z več koraki, cela števila do 100.'
    };
  }
  if (isUlomki) {
    return {
      1: 'ulomki z ENAKIM imenovalcem, seštevanje (npr. 1/4 + 2/4).',
      2: 'ulomki z ENAKIM imenovalcem, odštevanje in krajšanje.',
      3: 'ulomki z RAZLIČNIMI imenovalci (npr. 1/2 + 1/3).',
      4: 'množenje ali deljenje ulomkov, kombinacija s celimi števili.',
      5: 'besedilna naloga z ulomki, več korakov.'
    };
  }
  if (isDecimalna) {
    return {
      1: 'decimalna števila z ENO decimalko, seštevanje (npr. 0,3 + 0,4).',
      2: 'decimalna števila z ENO decimalko, odštevanje.',
      3: 'decimalna števila z DVEMA decimalkama, seštevanje in odštevanje.',
      4: 'množenje ali deljenje decimalnih števil z 10, 100.',
      5: 'besedilna naloga z decimalnimi števili.'
    };
  }
  if (isPotence) {
    return {
      1: 'kvadrat ENOMESTNEGA števila (npr. 3², 5²).',
      2: 'kvadrat DVOMESTNEGA števila ali kub enomestnega.',
      3: 'kvadratni koren popolnega kvadrata (npr. √25, √81).',
      4: 'potence z negativnim eksponentom ali kombinacija.',
      5: 'besedilna naloga s potencami ali koreni.'
    };
  }
  if (isOdstotki) {
    return {
      1: '10 % od okroglega števila (npr. 10 % od 50).',
      2: '1 % in 10 % od števila.',
      3: 'poljuben odstotek od števila (npr. 25 % od 80).',
      4: 'odstotek, če poznamo delež (npr. 20 % je 40, koliko je celota).',
      5: 'besedilna naloga z odstotki.'
    };
  }
  if (isEnacbe) {
    return {
      1: 'enačba z ENO operacijo (npr. x + 3 = 7).',
      2: 'enačba z DVEMA operacijama (npr. 2x = 8).',
      3: 'enačba z neznanko na obeh straneh (npr. 2x + 1 = x + 5).',
      4: 'enačba z oklepaji.',
      5: 'besedilna naloga, ki vodi v enačbo.'
    };
  }
  if (isGeometrija) {
    return {
      1: 'osnovni pojem (npr. prepoznaj lik, izmeri dolžino, obseg kvadrata).',
      2: 'enostaven izračun (npr. obseg pravokotnika, ploščina kvadrata).',
      3: 'Pitagorov izrek z enostavnimi števili ali ploščina trikotnika.',
      4: 'Pitagorov izrek v besedilni nalogi ali ploščina zahtevnejšega lika.',
      5: 'kombinirana geometrijska naloga (npr. prostornina telesa, več korakov).'
    };
  }

  const gradeBase = { 6: 'do 1000', 7: 'do 1000', 8: 'do 10 000', 9: 'do 100 000' }[grade] || 'do 1000';
  return {
    1: 'enomestna števila, ena operacija (npr. 3 + 4, 9 − 2).',
    2: 'dvomestna števila brez prehoda čez desetico (npr. 23 + 14).',
    3: 'dvomestna števila s prehodom čez desetico, dve operaciji.',
    4: 'trimestna števila, dve operaciji.',
    5: 'števila ' + gradeBase + ', besedilna naloga.'
  };
}

function levelDescriptionsForGrade(grade) {
  const base = {
    6: ['zelo enostavna naloga za 6. razred', 'enostavna naloga za 6. razred', 'srednje zahtevna naloga za 6. razred', 'zahtevnejša naloga za 6. razred', 'najzahtevnejša naloga za 6. razred'],
    7: ['zelo enostavna naloga za 7. razred', 'enostavna naloga za 7. razred', 'srednje zahtevna naloga za 7. razred', 'zahtevnejša naloga za 7. razred', 'najzahtevnejša naloga za 7. razred'],
    8: ['zelo enostavna naloga za 8. razred', 'enostavna naloga za 8. razred', 'srednje zahtevna naloga za 8. razred', 'zahtevnejša naloga za 8. razred', 'najzahtevnejša naloga za 8. razred'],
    9: ['zelo enostavna naloga za 9. razred', 'enostavna naloga za 9. razred', 'srednje zahtevna naloga za 9. razred', 'zahtevnejša naloga za 9. razred', 'najzahtevnejša naloga za 9. razred']
  };
  const arr = base[grade] || base[8];
  return { 1: arr[0], 2: arr[1], 3: arr[2], 4: arr[3], 5: arr[4] };
}

function taskTypeAllowed(question, topic) {
  const t = (topic || '').toLowerCase();
  const q = (question || '').toLowerCase();
  const allowsFractions = t.includes('ulom');
  const allowsDecimal = t.includes('decimal') || t.includes('odstot') || t.includes('koren') || t.includes('potenc');
  const isCelaStevila = t.includes('celo') || t.includes('cela') || t.includes('negativ') || t.includes('predznak');

  if (!allowsFractions && /\\frac/.test(q)) return false;
  if (!allowsDecimal && /[0-9],[0-9]|[0-9]\.[0-9]/.test(q)) return false;
  if (!t.includes('potenc') && !t.includes('koren') && /\^/.test(q)) {
    if (!allowsDecimal) return false;
  }
  if (isCelaStevila && /\\frac/.test(q)) return false;
  return true;
}

/* ============================================================
   KVOTA IN RETRY (Groq)
   ============================================================ */
let lastKnownQuota = { remainingRequests: null, resetRequestsMs: null, remainingTokens: null, resetTokensMs: null, lastUpdated: 0 };
function parseResetTime(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^([\d.]+)(ms|s|m|h)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]); const u = m[2] || 's';
  if (u === 'ms') return v; if (u === 's') return v * 1000;
  if (u === 'm') return v * 60 * 1000; if (u === 'h') return v * 3600 * 1000;
  return null;
}
function updateQuotaFromHeaders(headers) {
  if (!headers) return;
  const g = n => (headers.get ? headers.get(n) : headers[n]);
  const rr = g('x-ratelimit-remaining-requests'), rt = g('x-ratelimit-remaining-tokens');
  const srr = g('x-ratelimit-reset-requests'), srt = g('x-ratelimit-reset-tokens');
  if (rr != null) lastKnownQuota.remainingRequests = parseInt(rr, 10);
  if (rt != null) lastKnownQuota.remainingTokens = parseInt(rt, 10);
  if (srr) lastKnownQuota.resetRequestsMs = parseResetTime(srr);
  if (srt) lastKnownQuota.resetTokensMs = parseResetTime(srt);
  lastKnownQuota.lastUpdated = Date.now();
}
async function waitIfQuotaLow() {
  if (lastKnownQuota.remainingRequests !== null && lastKnownQuota.remainingRequests <= 1) {
    const w = lastKnownQuota.resetRequestsMs || 5000; await sleep(w + 200);
  }
  if (lastKnownQuota.remainingTokens !== null && lastKnownQuota.remainingTokens <= 300) {
    const w = lastKnownQuota.resetTokensMs || 5000; await sleep(w + 200);
  }
}

async function callAI(prompt, maxAttempts = 6) {
  let lastErr;
  for (let a = 1; a <= maxAttempts; a++) {
    await waitIfQuotaLow();
    try {
      const r = await groqClient.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 1000
      });
      if (r && r._response && r._response.headers) updateQuotaFromHeaders(r._response.headers);
      return r;
    } catch (err) {
      lastErr = err;
      const st = err.status || (err.response && err.response.status);
      if (st === 401 || st === 403) throw err;
      let w = Math.min(2000 * Math.pow(2, a - 1), 30000);
      if (st === 429) {
        const h = err.response && err.response.headers;
        const ra = h && (h.get ? h.get('retry-after') : h['retry-after']);
        if (ra) { const sec = parseFloat(ra); if (!isNaN(sec)) w = Math.max(w, sec * 1000 + 500); }
      }
      if (a < maxAttempts) {
        console.warn(`⚠️  Groq napaka (${st}), poskus ${a}/${maxAttempts}, čakam ${Math.round(w)}ms ...`);
        await sleep(w);
      }
    }
  }
  throw lastErr;
}

/* ============================================================
   API: PRIJAVA
   ============================================================ */
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Manjka username ali password.' });
  const u = DATA.users[username];
  if (!u || u.password !== password) return res.status(401).json({ error: 'Napačno uporabniško ime ali geslo.' });
  res.json({ username, role: u.role, firstName: u.firstName, lastName: u.lastName, grade: u.grade });
});

/* ============================================================
   API: UČENCI (admin)
   ============================================================ */
function requireAdmin(req, res, next) {
  const adminUsername = req.headers['x-admin-user'] || (req.body && req.body._admin) || req.query['x-admin-user'];
  if (!adminUsername || !DATA.users[adminUsername] || DATA.users[adminUsername].role !== 'admin') {
    return res.status(403).json({ error: 'Samo učitelj.' });
  }
  next();
}

app.get('/api/students', requireAdmin, (req, res) => {
  const list = Object.keys(DATA.users)
    .filter(u => DATA.users[u].role === 'student')
    .map(u => ({
      username: u, firstName: DATA.users[u].firstName, lastName: DATA.users[u].lastName,
      grade: DATA.users[u].grade, password: DATA.users[u].password
    }));
  res.json(list);
});

app.post('/api/students', requireAdmin, async (req, res) => {
  const { firstName, lastName, grade } = req.body || {};
  if (!firstName || !lastName || !grade) return res.status(400).json({ error: 'Manjka ime, priimek ali razred.' });
  const g = parseInt(grade, 10);
  if (![6, 7, 8, 9].includes(g)) return res.status(400).json({ error: 'Razred 6–9.' });
  const username = generateUsername(firstName, lastName, DATA.users);
  const password = generatePassword();
  DATA.users[username] = { firstName, lastName, grade: g, password, role: 'student' };
  await saveData();
  res.json({ username, password, firstName, lastName, grade: g });
});

app.put('/api/students/:username', requireAdmin, async (req, res) => {
  const oldUsername = req.params.username;
  if (!DATA.users[oldUsername] || DATA.users[oldUsername].role !== 'student') {
    return res.status(404).json({ error: 'Učenec ne obstaja.' });
  }

  const { firstName, lastName, grade, password, newUsername } = req.body || {};

  if (grade !== undefined && grade !== null && grade !== '') {
    const g = parseInt(grade, 10);
    if (![6, 7, 8, 9].includes(g)) return res.status(400).json({ error: 'Razred 6–9.' });
  }

  let finalUsername = oldUsername;
  if (newUsername && newUsername.trim() !== '' && newUsername.trim() !== oldUsername) {
    const candidate = newUsername.trim();
    if (!/^[a-z0-9]+$/i.test(candidate)) {
      return res.status(400).json({ error: 'Uporabniško ime lahko vsebuje le črke in številke.' });
    }
    if (DATA.users[candidate]) {
      return res.status(400).json({ error: 'To uporabniško ime je že zasedeno.' });
    }
    finalUsername = candidate;
  }

  const updated = Object.assign({}, DATA.users[oldUsername]);
  if (firstName !== undefined && firstName !== '') updated.firstName = firstName;
  if (lastName !== undefined && lastName !== '') updated.lastName = lastName;
  if (grade !== undefined && grade !== null && grade !== '') updated.grade = parseInt(grade, 10);
  if (password !== undefined && password !== '') updated.password = password;

  if (finalUsername !== oldUsername) {
    DATA.users[finalUsername] = updated;
    delete DATA.users[oldUsername];

    if (DATA.stats[oldUsername]) {
      DATA.stats[finalUsername] = DATA.stats[oldUsername];
      delete DATA.stats[oldUsername];
    }
    if (DATA.sessions[oldUsername]) {
      DATA.sessions[finalUsername] = DATA.sessions[oldUsername];
      delete DATA.sessions[oldUsername];
    }
    if (DATA.recentTasks[oldUsername]) {
      DATA.recentTasks[finalUsername] = DATA.recentTasks[oldUsername];
      delete DATA.recentTasks[oldUsername];
    }

    if (db) {
      await db.collection('users').deleteOne({ _id: oldUsername });
      await db.collection('stats').deleteOne({ _id: oldUsername });
      await db.collection('sessions').deleteOne({ _id: oldUsername });
      await db.collection('recentTasks').deleteOne({ _id: oldUsername });
    }
  } else {
    DATA.users[oldUsername] = updated;
  }

  await saveData();
  res.json({ ok: true, username: finalUsername, user: DATA.users[finalUsername] });
});

app.delete('/api/students/:username', requireAdmin, async (req, res) => {
  const un = req.params.username;
  if (!DATA.users[un] || DATA.users[un].role !== 'student') return res.status(404).json({ error: 'Učenec ne obstaja.' });
  delete DATA.users[un];
  delete DATA.stats[un];
  delete DATA.sessions[un];
  if (DATA.recentTasks[un]) delete DATA.recentTasks[un];
  if (db) {
    await db.collection('users').deleteOne({ _id: un });
    await db.collection('stats').deleteOne({ _id: un });
    await db.collection('sessions').deleteOne({ _id: un });
    await db.collection('recentTasks').deleteOne({ _id: un });
  }
  res.json({ ok: true });
});

app.post('/api/students/:username/reset-password', requireAdmin, async (req, res) => {
  const un = req.params.username;
  if (!DATA.users[un] || DATA.users[un].role !== 'student') return res.status(404).json({ error: 'Učenec ne obstaja.' });
  DATA.users[un].password = generatePassword();
  await saveData();
  res.json({ password: DATA.users[un].password });
});

app.get('/api/students/pdf/:grade', requireAdmin, (req, res) => {
  const grade = parseInt(req.params.grade, 10);
  if (![6, 7, 8, 9].includes(grade)) return res.status(400).json({ error: 'Razred 6–9.' });
  const students = Object.keys(DATA.users)
    .filter(u => DATA.users[u].role === 'student' && DATA.users[u].grade === grade)
    .map(u => ({ username: u, ...DATA.users[u] }))
    .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="ucenci_' + grade + '_razred.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Učenci ' + grade + '. razreda', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#666').text('Datum: ' + new Date().toLocaleString('sl-SI'), { align: 'center' });
  doc.moveDown(2);

  const cols = [
    { label: 'Ime in priimek', x: 50, w: 180 },
    { label: 'Uporabniško ime', x: 240, w: 130 },
    { label: 'Geslo', x: 380, w: 100 }
  ];
  doc.fillColor('#333').fontSize(11).font('Helvetica-Bold');
  let y = doc.y;
  cols.forEach(c => doc.text(c.label, c.x, y, { width: c.w }));
  y += 20;
  doc.moveTo(50, y).lineTo(545, y).stroke('#999');
  y += 6;
  doc.font('Helvetica').fontSize(11).fillColor('#000');
  if (!students.length) {
    doc.text('Ni učencev v tem razredu.', 50, y);
  } else {
    students.forEach(s => {
      if (y > 780) { doc.addPage(); y = 50; }
      doc.text(s.firstName + ' ' + s.lastName, 50, y, { width: 180 });
      doc.text(s.username, 240, y, { width: 130 });
      doc.text(s.password, 380, y, { width: 100 });
      y += 20;
    });
  }
  doc.end();
});

/* ============================================================
   API: POGLAVJA
   ============================================================ */
app.get('/api/chapters', (req, res) => {
  const grade = req.query.grade ? parseInt(req.query.grade, 10) : null;
  if (grade) return res.json(DATA.chapters.filter(c => c.grade === grade));
  res.json(DATA.chapters);
});

app.get('/api/chapters/:id', (req, res) => {
  const ch = DATA.chapters.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  res.json(ch);
});

app.post('/api/chapters', requireAdmin, async (req, res) => {
  const { title, desc, type, grade, category, deadline, topic } = req.body || {};
  if (!title || !type || !grade || !category) return res.status(400).json({ error: 'Manjka polje.' });
  if (category === 'domaca' && !deadline) return res.status(400).json({ error: 'Za domačo rok obvezen.' });
  const ch = {
    id: 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    title, desc: desc || '', type,
    grade: parseInt(grade, 10), category,
    deadline: deadline || null, topic: topic || null,
    createdAt: Date.now()
  };
  DATA.chapters.push(ch);
  await saveData();
  res.json(ch);
});

app.put('/api/chapters/:id', requireAdmin, async (req, res) => {
  const ch = DATA.chapters.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  const { title, desc, type, grade, category, deadline, topic } = req.body || {};
  if (title !== undefined) ch.title = title;
  if (desc !== undefined) ch.desc = desc;
  if (type !== undefined) ch.type = type;
  if (grade !== undefined) ch.grade = parseInt(grade, 10);
  if (category !== undefined) ch.category = category;
  if (deadline !== undefined) ch.deadline = deadline || null;
  if (topic !== undefined) ch.topic = topic;
  await saveData();
  res.json(ch);
});

app.delete('/api/chapters/:id', requireAdmin, async (req, res) => {
  DATA.chapters = DATA.chapters.filter(c => c.id !== req.params.id);
  if (db) await db.collection('chapters').deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

/* ============================================================
   API: SEJA
   ============================================================ */
app.post('/api/start-session', (req, res) => {
  const { username, chapterId, reset } = req.body || {};
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka username ali chapterId.' });
  const user = DATA.users[username];
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Samo učenec.' });
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.grade !== user.grade) return res.status(403).json({ error: 'Poglavje ni za tvoj razred.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) {
    return res.status(403).json({ error: 'Rok je potekel.' });
  }
  if (reset) {
    DATA.sessions[username] = DATA.sessions[username] || {};
    DATA.sessions[username][chapterId] = {
      level: 1, correct: 0, attempts: 0, currentTask: null,
      finished: false, awaitingNext: false, history: [], updatedAt: Date.now()
    };
    saveData();
  }
  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  if (!DATA.sessions[username][chapterId]) {
    DATA.sessions[username][chapterId] = {
      level: 1, correct: 0, attempts: 0,
      currentTask: null, finished: false,
      awaitingNext: false, history: [], updatedAt: Date.now()
    };
  }
  const sess = DATA.sessions[username][chapterId];
  res.json({
    ok: true, level: sess.level, correct: sess.correct, attempts: sess.attempts,
    finished: sess.finished, target: 5, grade: ch.grade,
    hasCurrentTask: !!sess.currentTask && !sess.finished,
    currentTask: sess.currentTask && !sess.finished ? {
      question: sess.currentTask.question,
      sketch: sess.currentTask.sketch || null,
      level: sess.currentTask.level,
      awaitingNext: sess.awaitingNext
    } : null
  });
});

/* ============================================================
   API: GENERIRANJE
   ============================================================ */
app.post('/api/generate-task', async (req, res) => {
  const { username, chapterId, isRetry } = req.body || {};
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka username ali chapterId.' });

  const user = DATA.users[username];
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Samo učenec.' });
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.grade !== user.grade) return res.status(403).json({ error: 'Napačen razred.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) {
    return res.status(403).json({ error: 'Rok je potekel.' });
  }

  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  if (!DATA.sessions[username][chapterId]) {
    DATA.sessions[username][chapterId] = {
      level: 1, correct: 0, attempts: 0,
      currentTask: null, finished: false,
      awaitingNext: false, history: [], updatedAt: Date.now()
    };
  }
  const sess = DATA.sessions[username][chapterId];
  if (sess.finished) {
    return res.json({ finished: true, correct: sess.correct, attempts: sess.attempts, level: sess.level });
  }

  const level = sess.level;
  const grade = ch.grade;
  const topicLower = (ch.topic || ch.title || '').toLowerCase();
  const isGeometry = topicLower.includes('geometr') || topicLower.includes('pitagor') ||
                     topicLower.includes('krog') || topicLower.includes('kot') ||
                     topicLower.includes('trikot') || topicLower.includes('lik') ||
                     topicLower.includes('telo') || topicLower.includes('koordinat');

  const strictRules = strictLevelRules(grade, ch.topic || ch.title);
  const levelDesc = strictRules[level] || strictRules[3];
  const seed = username + '_' + Date.now() + '_' + Math.random();

  if (!DATA.recentTasks[username]) DATA.recentTasks[username] = {};
  if (!DATA.recentTasks[username][chapterId]) DATA.recentTasks[username][chapterId] = [];
  const recent = DATA.recentTasks[username][chapterId];

  const recentList = recent.slice(-15).map((t, i) => `${i + 1}. ${t.question}`).join('\n');
  const recentNumbers = recent.slice(-10).flatMap(t => extractNumbers(t.question));
  const recentNumsList = recentNumbers.length
    ? Array.from(new Set(recentNumbers.map(n => n.toFixed(2)))).join(', ')
    : '(še ni bilo nalog)';

  let sketchInstruction = '';
  if (isGeometry) {
    sketchInstruction = `
⚠️ SKICA (za to temo je skica SMISELNA):
- Naloga naj bo takšna, da jo je mogoče narisati.
- V polje "sketch" vrni JSON objekt z opisom skice. Možni tipi:
  * {"type":"right_triangle","data":{"a":8,"b":15,"unit":"cm"}} – pravokotni trikotnik s katetama a in b.
  * {"type":"triangle","data":{"a":5,"b":6,"c":7,"unit":"cm"}} – trikotnik s tremi stranicami.
  * {"type":"rectangle","data":{"a":5,"b":3,"unit":"cm"}} – pravokotnik.
  * {"type":"square","data":{"a":4,"unit":"cm"}} – kvadrat.
  * {"type":"circle","data":{"r":5,"unit":"cm"}} – krožnica s polmerom r.
  * {"type":"angle","data":{"alpha":45,"beta":60,"unit":"°"}} – kot.
- Če skica ni smiselna za to nalogo, vrni "sketch": null.
- Podatki v "data" naj ustrezajo besedilu naloge.
`;
  } else {
    sketchInstruction = `- Za to temo skica ni potrebna. Vrni "sketch": null.`;
  }

  let prompt = `Si matematični tutor za učence ${grade}. razreda OŠ v Sloveniji.
USTVARJAŠ NALOGO ZA KONKRETNEGA UČENCA (uporabniško ime: ${username}, seme: ${seed}).
Tema sklopa: "${ch.topic || ch.title}".
Kategorija: ${ch.category === 'domaca' ? 'domača naloga' : 'utrjevanje'}.
Raven: ${level}/5.

⚠️ ZELO POMEMBNO – PRIMERNOST ZA RAZRED ${grade}:
- Naloga MORA biti ustrezna za ${grade}. razred osnovne šole po slovenskem učnem načrtu.
- Zgleduj se po slovenskih i-učbenikih za matematiko (npr. i-učbenik Matematika 8, poglavja o Pitagorovem izreku, krožnici, kotih) in po tipičnih nalogah, ki jih učenci ${grade}. razreda rešujejo.
- Naloga naj ima jasno besedilo, ne le goli račun, kadar je to smiselno.
- Naloga mora ustrezati ravni ${level}/5: ${levelDesc}.

${sketchInstruction}

⚠️ STROGO PRAVILO O TIPU NALOGE:
- Tip naloge mora ustrezati temi "${ch.topic || ch.title}".
- Če tema vsebuje "cela števila", NE uporabi ulomkov ali decimalnih števil.
- Če tema vsebuje "ulomke", uporabi ulomke.
- Če tema vsebuje "decimalna števila", uporabi decimalna števila.
- Če tema vsebuje "potence" ali "korene", uporabi potence ali korene.
- Če tema vsebuje "odstotke", uporabi odstotke.
- Ne mešaj tipov nalog, ki ne sodijo v temo.

⚠️ RAZNOLIKOST:
- Naloga mora biti RAZLIČNA od vseh spodaj naštetih prejšnjih nalog.
- Prepovedano je uporabiti ISTA ŠTEVILA kot v katerikoli prejšnji nalogi.
- Znotraj istega sklopa naj bodo naloge čim bolj raznolike.

PREJŠNJE NALOGE (izogibaj se jim):
${recentList || '(še ni bilo nalog)'}

ŠTEVILA, KI SO BILA ŽE UPORABLJENA (ne uporabi jih znova):
${recentNumsList}

PRAVILA ZA NALOGO:
- Generiraj NATANKO ENO nalogo, edinstveno za tega učenca.
- Uporabi LaTeX za matematične izraze: ulomki kot \\frac{a}{b}, potence kot x^{2}, koreni kot \\sqrt{x}, decimalna vejica kot 0{,}5.
- V polju "answer_latex" uporabi ENAK zapis kot v besedilu naloge (en backslash pred \\frac).
- Naloga naj bo v slovenščini, primerna ${grade}. razredu.
- Odgovor naj bo enolično določljiv in zapisan kot ŠTEVILO.

Vrni izključno JSON:
{
  "question": "kratek prikaz naloge v LaTeX/tekstu",
  "answer": 0.75,
  "answer_latex": "\\\\frac{3}{4}",
  "sketch": null
}`;

  if (isRetry && sess.currentTask) {
    prompt += `\n\nUčenec je prejšnjo nalogo rešil NAPAČNO. Generiraj PODOBNO nalogo ISTE ravni (${level}/5), a z DRUGAČNIMI ŠTEVILI kot v prejšnji nalogi (prejšnja: "${sess.currentTask.question}").`;
  }

  try {
    let finalData = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await callAI(prompt);
      const data = JSON.parse(response.choices[0].message.content);
      if (typeof data.question !== 'string' || data.answer === undefined) {
        prompt += `\n\nOPOZORILO: Neveljavna struktura. Vrni veljaven JSON.`;
        continue;
      }
      const ansNum = typeof data.answer === 'number' ? data.answer : parseNumberString(data.answer);
      if (isNaN(ansNum)) {
        prompt += `\n\nOPOZORILO: Odgovor ni število. Vrni številski odgovor.`;
        continue;
      }
      const candidate = {
        question: normalizeLatex(data.question),
        answer: ansNum,
        answerRaw: normalizeLatex(data.answer_latex || String(data.answer)),
        sketch: data.sketch || null
      };

      if (!taskTypeAllowed(candidate.question, ch.topic || ch.title)) {
        prompt += `\n\nOPOZORILO: Naloga vsebuje napačen tip. Uporabi SAMO tip, ki ustreza temi "${ch.topic || ch.title}".`;
        continue;
      }
      if (isTooSimilar(candidate, recent.slice(-10))) {
        prompt += `\n\nOPOZORILO: Prejšnji poskus je bil preveč podoben že rešeni nalogi. Uporabi POPOLNOMA DRUGAČNA števila.`;
        continue;
      }
      finalData = candidate;
      break;
    }

    if (!finalData) {
      const response = await callAI(prompt);
      const data = JSON.parse(response.choices[0].message.content);
      const ansNum = typeof data.answer === 'number' ? data.answer : parseNumberString(data.answer);
      finalData = {
        question: normalizeLatex(data.question),
        answer: ansNum,
        answerRaw: normalizeLatex(data.answer_latex || String(data.answer)),
        sketch: data.sketch || null
      };
    }

    sess.currentTask = {
      question: finalData.question,
      answer: finalData.answer,
      answerRaw: finalData.answerRaw,
      sketch: finalData.sketch,
      level
    };
    sess.awaitingNext = false;
    recent.push({ question: finalData.question, answer: finalData.answer });
    if (recent.length > 30) recent.splice(0, recent.length - 30);
    await saveData();

    res.json({
      question: finalData.question,
      sketch: finalData.sketch,
      level, correct: sess.correct, target: 5, grade
    });
  } catch (err) {
    console.error('Groq napaka:', err.message);
    const st = err.status || (err.response && err.response.status);
    let msg = 'Napaka pri generiranju.';
    if (st === 429) msg = 'Preveč zahtev. Počakaj minuto.';
    else if (st === 401) msg = 'Neveljaven API ključ.';
    else if (st === 404) msg = 'Model ni dosegljiv.';
    res.status(500).json({ error: msg });
  }
});

/* ============================================================
   API: PREVERJANJE
   ============================================================ */
app.post('/api/check-answer', async (req, res) => {
  const { username, userAnswer } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Manjka username.' });
  const user = DATA.users[username];
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Samo učenec.' });

  let chapterId = null;
  if (DATA.sessions[username]) {
    Object.keys(DATA.sessions[username]).forEach(cid => {
      if (DATA.sessions[username][cid].currentTask && !DATA.sessions[username][cid].finished) {
        chapterId = cid;
      }
    });
  }
  if (!chapterId) return res.status(400).json({ error: 'Ni aktivne naloge.' });

  const sess = DATA.sessions[username][chapterId];
  if (sess.awaitingNext) return res.status(400).json({ error: 'Najprej klikni gumb.' });

  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) {
    sess.finished = true; saveData();
    return res.status(403).json({ error: 'Rok je potekel.' });
  }

  let userNum = parseNumberString(userAnswer);
  let isCorrect = false;

  if (!isNaN(userNum)) {
    isCorrect = Math.abs(userNum - sess.currentTask.answer) < 1e-9;
  } else {
    try {
      const prompt = `Si matematični tutor. Učenec je odgovoril na naslednjo nalogo:
NALOGA: ${sess.currentTask.question}
PRAVILEN ODGOVOR: ${sess.currentTask.answer} (zapis: ${sess.currentTask.answerRaw || sess.currentTask.answer})
UČENČEV ODGOVOR: "${userAnswer}"

Ugotovi, ali je učenčev odgovor pravilen (vključno z enakovrednimi zapisi, npr. "pol", "ena polovica", "1/2", "0.5").
Vrni JSON:
{ "is_correct": true/false, "normalized_answer": "številski zapis", "reason": "kratka razlaga" }`;
      const response = await callAI(prompt);
      const aiEval = JSON.parse(response.choices[0].message.content);
      isCorrect = !!aiEval.is_correct;
      if (aiEval.normalized_answer) userNum = parseNumberString(aiEval.normalized_answer);
    } catch (e) {
      return res.status(500).json({ error: 'Napaka pri ocenjevanju odgovora.' });
    }
  }

  sess.attempts++;
  if (!DATA.stats[username]) DATA.stats[username] = {};
  if (!DATA.stats[username][chapterId]) {
    DATA.stats[username][chapterId] = {
      total: 0, correct: 0, correctFirst: 0, wrong: 0,
      byType: {}, history: [], errors: []
    };
  }
  const st = DATA.stats[username][chapterId];
  st.total++;
  if (isCorrect) { st.correct++; if (sess.attempts === 1) st.correctFirst++; }
  else {
    st.wrong++;
    const existing = st.errors.find(e => e.question === sess.currentTask.question);
    if (existing) existing.count++;
    else st.errors.push({
      question: sess.currentTask.question, userAns: String(userAnswer),
      correctAns: sess.currentTask.answerRaw || String(sess.currentTask.answer),
      count: 1, level: sess.currentTask.level
    });
    if (st.errors.length > 100) st.errors = st.errors.slice(-100);
  }
  const t = sess.currentTask.type || 'llm';
  if (!st.byType[t]) st.byType[t] = { total: 0, correct: 0 };
  st.byType[t].total++;
  if (isCorrect) st.byType[t].correct++;
  st.history.push({ ts: Date.now(), question: sess.currentTask.question, ok: isCorrect, attempt: sess.attempts, level: sess.currentTask.level });
  if (st.history.length > 300) st.history = st.history.slice(-300);
  await saveData();

  if (isCorrect) {
    sess.correct++;
    if (sess.correct >= 5) {
      sess.finished = true; saveData();
      return res.json({
        correct: true, finished: true,
        correctCount: sess.correct, attempts: sess.attempts,
        message: 'Bravo! Rešil si vseh 5 nalog. 🎉'
      });
    }
    sess.level = Math.min(5, sess.level + 1);
    sess.awaitingNext = false; saveData();
    return res.json({
      correct: true, finished: false,
      correctCount: sess.correct, target: 5, nextLevel: sess.level,
      message: 'Odlično! Pravilno.'
    });
  } else {
    let steps = [];
    try {
      const prompt = `Si izkušen, prijazen učitelj matematike v slovenski osnovni šoli. Učenec (${ch.grade}. razred) je napačno rešil nalogo in potrebuje KRATKO razlago.

NALOGA: ${sess.currentTask.question}
PRAVILEN ODGOVOR: ${sess.currentTask.answerRaw || sess.currentTask.answer}
UČENČEV NAPAČNI ODGOVOR: "${userAnswer}"

RAZLAGA MORA BITI:
- Napisana v ZELO PREPROSTEM SLOVENSKEM JEZIKU, primernem ${ch.grade}. razredu OŠ.
- Kratka: največ 3 alineje, vsaka največ 1–2 kratka stavka.
- Brez težkih besed, brez teorije, brez uvodov.
- Uporabi POSTOPEK, ki se uporablja v slovenskih šolah pri tej temi.
- Osredotoči se na tisto, kar bo učencu pomagalo pri NASLEDNJI podobni nalogi.
- Uporabi LaTeX za matematične izraze (en backslash pred \\frac).
- Zadnja alineja naj bo pravilen rezultat v obliki: "Rezultat: <latex>".

Vrni JSON: { "steps": ["korak 1", "korak 2", "Rezultat: ..."] }`;
      const response = await callAI(prompt);
      const data = JSON.parse(response.choices[0].message.content);
      steps = Array.isArray(data.steps) ? data.steps.map(normalizeLatex) : [];
    } catch (e) {
      steps = ['Rezultat: ' + normalizeLatex(sess.currentTask.answerRaw || sess.currentTask.answer)];
    }
    sess.awaitingNext = true; saveData();
    return res.json({
      correct: false, finished: false,
      correctCount: sess.correct, target: 5,
      correctAnswer: sess.currentTask.answer,
      correctAnswerRaw: normalizeLatex(sess.currentTask.answerRaw || ''),
      steps: steps,
      message: 'Ni pravilno. Preberi kratko razlago in nato klikni "Poskusi s podobno nalogo".'
    });
  }
});

app.post('/api/reset-session', async (req, res) => {
  const { username, chapterId } = req.body || {};
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka username ali chapterId.' });
  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  DATA.sessions[username][chapterId] = {
    level: 1, correct: 0, attempts: 0, currentTask: null,
    finished: false, awaitingNext: false, history: [], updatedAt: Date.now()
  };
  await saveData();
  res.json({ ok: true });
});

/* ============================================================
   API: ANALIZE
   ============================================================ */
app.get('/api/student-analysis/:username', (req, res) => {
  const username = req.params.username;
  const st = DATA.stats[username] || {};
  const result = [];
  Object.keys(st).forEach(chId => {
    const s = st[chId];
    const ch = DATA.chapters.find(c => c.id === chId);
    if (!ch) return;
    const pct = s.total ? Math.round(100 * s.correct / s.total) : 0;
    const topErrors = (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 5);
    const byType = Object.keys(s.byType || {}).map(t => ({
      type: t, total: s.byType[t].total, correct: s.byType[t].correct,
      pct: s.byType[t].total ? Math.round(100 * s.byType[t].correct / s.byType[t].total) : 0
    }));
    result.push({ chapterId: chId, title: ch.title, grade: ch.grade, category: ch.category, total: s.total, correct: s.correct, correctFirst: s.correctFirst, pct, byType, topErrors });
  });
  res.json(result);
});

app.get('/api/teacher-analysis', requireAdmin, (req, res) => {
  const result = { byGrade: {}, byStudent: {}, overall: { total: 0, correct: 0 } };
  Object.keys(DATA.stats).forEach(u => {
    if (!DATA.users[u] || DATA.users[u].role !== 'student') return;
    const uStats = DATA.stats[u];
    let uTotal = 0, uCorrect = 0;
    Object.keys(uStats).forEach(chId => {
      const s = uStats[chId];
      const ch = DATA.chapters.find(c => c.id === chId);
      if (!ch) return;
      uTotal += s.total; uCorrect += s.correct;
      result.overall.total += s.total;
      result.overall.correct += s.correct;
      const g = ch.grade;
      if (!result.byGrade[g]) result.byGrade[g] = { total: 0, correct: 0, chapters: {} };
      result.byGrade[g].total += s.total;
      result.byGrade[g].correct += s.correct;
      if (!result.byGrade[g].chapters[chId]) result.byGrade[g].chapters[chId] = { total: 0, correct: 0, title: ch.title };
      result.byGrade[g].chapters[chId].total += s.total;
      result.byGrade[g].chapters[chId].correct += s.correct;
    });
    result.byStudent[u] = { total: uTotal, correct: uCorrect };
  });
  res.json(result);
});

app.post('/api/chapter-analysis/:chapterId', requireAdmin, async (req, res) => {
  const chapterId = req.params.chapterId;
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });

  const perStudent = [];
  Object.keys(DATA.stats).forEach(u => {
    if (!DATA.users[u] || DATA.users[u].role !== 'student') return;
    const s = DATA.stats[u] && DATA.stats[u][chapterId];
    if (!s || !s.total) return;
    perStudent.push({
      username: u, total: s.total, correct: s.correct, correctFirst: s.correctFirst, wrong: s.wrong,
      pct: Math.round(100 * s.correct / s.total),
      topErrors: (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 5),
      byType: s.byType
    });
  });

  const total = perStudent.reduce((a, b) => a + b.total, 0);
  const correct = perStudent.reduce((a, b) => a + b.correct, 0);
  const pct = total ? Math.round(100 * correct / total) : 0;

  const errorMap = {};
  perStudent.forEach(p => {
    (p.topErrors || []).forEach(e => {
      if (!errorMap[e.question]) errorMap[e.question] = { question: e.question, correctAns: e.correctAns, count: 0, levels: new Set() };
      errorMap[e.question].count += e.count;
      if (e.level) errorMap[e.question].levels.add(e.level);
    });
  });
  const topClassErrors = Object.values(errorMap).sort((a, b) => b.count - a.count).slice(0, 10)
    .map(e => ({ ...e, levels: Array.from(e.levels) }));

  const classByType = {};
  perStudent.forEach(p => {
    Object.keys(p.byType || {}).forEach(t => {
      if (!classByType[t]) classByType[t] = { total: 0, correct: 0 };
      classByType[t].total += p.byType[t].total;
      classByType[t].correct += p.byType[t].correct;
    });
  });

  let textAnalysis = null;
  try {
    const prompt = `Si učitelj matematike. Napiši kratko pedagoško analizo v slovenščini.
SKLOP: "${ch.title}" (${ch.grade}. razred, ${ch.category})
Poskusi: ${total}, pravilnih: ${correct} (${pct}%)
Aktivnih: ${perStudent.length}
Napake: ${JSON.stringify(topClassErrors.map(e => ({ q: e.question, n: e.count })))}
Po tipu: ${JSON.stringify(classByType)}
Napiši 4–6 stavkov. JSON: {"text":"..."}`;
    const response = await callAI(prompt);
    const data = JSON.parse(response.choices[0].message.content);
    textAnalysis = data.text || null;
  } catch (e) { console.warn('Analiza ni uspela:', e.message); }

  const analysis = {
    generatedAt: Date.now(), text: textAnalysis,
    chapterId, title: ch.title, grade: ch.grade, category: ch.category,
    deadline: ch.deadline, totalAttempts: total, correct, pct,
    activeStudents: perStudent.length, perStudent, classByType, topClassErrors
  };
  DATA.analyses[chapterId] = analysis;
  DATA.autoAnalyzed[chapterId] = true;
  await saveData();
  res.json(analysis);
});

app.get('/api/expired-chapters', requireAdmin, (req, res) => {
  const now = Date.now();
  const expired = DATA.chapters.filter(c => c.category === 'domaca' && c.deadline && new Date(c.deadline).getTime() < now)
    .map(c => ({ id: c.id, title: c.title, grade: c.grade, deadline: c.deadline, analyzed: !!DATA.analyses[c.id] }));
  res.json(expired);
});

/* ============================================================
   API: PODROBNA ANALIZA UČENCA
   ============================================================ */
app.get('/api/student-detail/:username', requireAdmin, (req, res) => {
  const username = req.params.username;
  const user = DATA.users[username];
  if (!user || user.role !== 'student') {
    return res.status(404).json({ error: 'Učenec ne obstaja.' });
  }

  const uStats = DATA.stats[username] || {};
  const chapters = [];

  Object.keys(uStats).forEach(chId => {
    const s = uStats[chId];
    const ch = DATA.chapters.find(c => c.id === chId);
    if (!ch) return;
    if (!s.total) return;

    const pct = Math.round(100 * s.correct / s.total);
    const byType = Object.keys(s.byType || {}).map(t => ({
      type: t, total: s.byType[t].total, correct: s.byType[t].correct,
      pct: s.byType[t].total ? Math.round(100 * s.byType[t].correct / s.byType[t].total) : 0
    }));
    const topErrors = (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 10);
    const recentHistory = (s.history || []).slice(-20).reverse();

    chapters.push({
      chapterId: chId, title: ch.title, desc: ch.desc || '',
      grade: ch.grade, category: ch.category, deadline: ch.deadline || null,
      total: s.total, correct: s.correct, correctFirst: s.correctFirst,
      wrong: s.wrong, pct, byType, topErrors, recentHistory
    });
  });

  const totalAll = chapters.reduce((a, c) => a + c.total, 0);
  const correctAll = chapters.reduce((a, c) => a + c.correct, 0);
  const overallPct = totalAll ? Math.round(100 * correctAll / totalAll) : 0;

  res.json({
    username, firstName: user.firstName, lastName: user.lastName, grade: user.grade,
    overall: { total: totalAll, correct: correctAll, pct: overallPct },
    chapters
  });
});

/* ============================================================
   ZAGON
   ============================================================ */
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`✅ Strežnik: http://localhost:${PORT}`);
  console.log(`   🤖 AI: Groq (${GROQ_MODEL})`);
});

connectDB().then(() => {
  console.log('✅ Baza pripravljena.');
}).catch(err => {
  console.error('❌ Baza ni uspela:', err.message);
});
