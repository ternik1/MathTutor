// server.js
// Zaženi:
//   $env:MONGODB_URI="mongodb+srv://..."
//   node server.js

const express = require('express');
const cors = require('cors');
const path = require('path');
const PDFDocument = require('pdfkit');
const { MongoClient } = require('mongodb');
const { TOPICS } = require('./tasks');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

if (!process.env.MONGODB_URI) console.error('❌ MONGODB_URI ni nastavljen!');

/* ============================================================
   POMOŽNE
   ============================================================ */
function parseNumberString(raw) {
  if (raw === null || raw === undefined) return NaN;
  let s = String(raw).trim().replace(',', '.');
  // Odstrani enote
  s = s.replace(/\s*(cm²|cm³|m²|m³|cm|mm|dm|km|kg|mg|ml|l|t|€|°|%|m|g)\s*$/i, '');
  // Odstrani presledke (npr. tisočice)
  s = s.replace(/\s/g, '');
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

function numbersEqual(a, b, tol = 0.01) {
  if (isNaN(a) || isNaN(b)) return false;
  return Math.abs(a - b) <= tol;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[čć]/g, 'c').replace(/[š]/g, 's').replace(/[ž]/g, 'z').replace(/[đ]/g, 'd').replace(/[^a-z0-9]/g, '');
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
   SHRAMBA
   ============================================================ */
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient = null;
let db = null;
let DATA = { users: {}, chapters: [], stats: {}, analyses: {}, sessions: {}, recentTasks: {} };

async function connectDB() {
  if (!MONGODB_URI) { console.error('❌ MONGODB_URI ni nastavljen.'); process.exit(1); }
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
      DATA.users['ucitelj'] = { firstName: 'Učitelj', lastName: '', grade: null, password: 'ucitelj123', role: 'admin' };
      await saveData();
      console.log('✅ Ustvarjen učiteljski račun.');
    }
  } catch (err) { console.error('❌ Napaka pri povezavi na MongoDB:', err.message); process.exit(1); }
}

async function saveData() {
  if (!db) return;
  try {
    for (const [k, v] of Object.entries(DATA.users)) await db.collection('users').updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
    for (const ch of DATA.chapters) await db.collection('chapters').updateOne({ _id: ch.id }, { $set: { value: ch } }, { upsert: true });
    for (const [k, v] of Object.entries(DATA.stats)) await db.collection('stats').updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
    for (const [k, v] of Object.entries(DATA.analyses)) await db.collection('analyses').updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
    for (const [k, v] of Object.entries(DATA.sessions)) await db.collection('sessions').updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
    for (const [k, v] of Object.entries(DATA.recentTasks)) await db.collection('recentTasks').updateOne({ _id: k }, { $set: { value: v } }, { upsert: true });
  } catch (err) { console.warn('Napaka pri shranjevanju:', err.message); }
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
   API: UČENCI
   ============================================================ */
function requireAdmin(req, res, next) {
  const adminUsername = req.headers['x-admin-user'] || (req.body && req.body._admin) || req.query['x-admin-user'];
  if (!adminUsername || !DATA.users[adminUsername] || DATA.users[adminUsername].role !== 'admin') return res.status(403).json({ error: 'Samo učitelj.' });
  next();
}
function isAdminRequest(req) {
  const adminUsername = req.headers['x-admin-user'] || (req.body && req.body._admin) || req.query['x-admin-user'];
  return !!(adminUsername && DATA.users[adminUsername] && DATA.users[adminUsername].role === 'admin');
}

app.get('/api/students', requireAdmin, (req, res) => {
  const list = Object.keys(DATA.users).filter(u => DATA.users[u].role === 'student').map(u => ({ username: u, firstName: DATA.users[u].firstName, lastName: DATA.users[u].lastName, grade: DATA.users[u].grade, password: DATA.users[u].password }));
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
  const old = req.params.username;
  if (!DATA.users[old] || DATA.users[old].role !== 'student') return res.status(404).json({ error: 'Učenec ne obstaja.' });
  const { firstName, lastName, grade, password, newUsername } = req.body || {};
  if (grade !== undefined && grade !== null && grade !== '') { const g = parseInt(grade, 10); if (![6, 7, 8, 9].includes(g)) return res.status(400).json({ error: 'Razred 6–9.' }); }
  let final = old;
  if (newUsername && newUsername.trim() !== '' && newUsername.trim() !== old) {
    const c = newUsername.trim();
    if (!/^[a-z0-9]+$/i.test(c)) return res.status(400).json({ error: 'Uporabniško ime: le črke in številke.' });
    if (DATA.users[c]) return res.status(400).json({ error: 'Ime zasedeno.' });
    final = c;
  }
  const upd = Object.assign({}, DATA.users[old]);
  if (firstName) upd.firstName = firstName;
  if (lastName) upd.lastName = lastName;
  if (grade !== undefined && grade !== '' && grade !== null) upd.grade = parseInt(grade, 10);
  if (password) upd.password = password;
  if (final !== old) {
    DATA.users[final] = upd; delete DATA.users[old];
    if (DATA.stats[old]) { DATA.stats[final] = DATA.stats[old]; delete DATA.stats[old]; }
    if (DATA.sessions[old]) { DATA.sessions[final] = DATA.sessions[old]; delete DATA.sessions[old]; }
    if (DATA.recentTasks[old]) { DATA.recentTasks[final] = DATA.recentTasks[old]; delete DATA.recentTasks[old]; }
    if (db) { await db.collection('users').deleteOne({ _id: old }); await db.collection('stats').deleteOne({ _id: old }); await db.collection('sessions').deleteOne({ _id: old }); await db.collection('recentTasks').deleteOne({ _id: old }); }
  } else DATA.users[old] = upd;
  await saveData();
  res.json({ ok: true, username: final, user: DATA.users[final] });
});

app.delete('/api/students/:username', requireAdmin, async (req, res) => {
  const un = req.params.username;
  if (!DATA.users[un] || DATA.users[un].role !== 'student') return res.status(404).json({ error: 'Učenec ne obstaja.' });
  delete DATA.users[un]; delete DATA.stats[un]; delete DATA.sessions[un];
  if (DATA.recentTasks[un]) delete DATA.recentTasks[un];
  if (db) { await db.collection('users').deleteOne({ _id: un }); await db.collection('stats').deleteOne({ _id: un }); await db.collection('sessions').deleteOne({ _id: un }); await db.collection('recentTasks').deleteOne({ _id: un }); }
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
  const students = Object.keys(DATA.users).filter(u => DATA.users[u].role === 'student' && DATA.users[u].grade === grade).map(u => ({ username: u, ...DATA.users[u] })).sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="ucenci_' + grade + '.pdf"');
  doc.pipe(res);
  doc.fontSize(18).text('Učenci ' + grade + '. razreda', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).fillColor('#666').text('Datum: ' + new Date().toLocaleString('sl-SI'), { align: 'center' });
  doc.moveDown(2);
  const cols = [{ label: 'Ime in priimek', x: 50, w: 180 }, { label: 'Uporabniško ime', x: 240, w: 130 }, { label: 'Geslo', x: 380, w: 100 }];
  doc.fillColor('#333').fontSize(11).font('Helvetica-Bold');
  let y = doc.y;
  cols.forEach(c => doc.text(c.label, c.x, y, { width: c.w }));
  y += 20;
  doc.moveTo(50, y).lineTo(545, y).stroke('#999');
  y += 6;
  doc.font('Helvetica').fontSize(11).fillColor('#000');
  if (!students.length) doc.text('Ni učencev.', 50, y);
  else students.forEach(s => {
    if (y > 780) { doc.addPage(); y = 50; }
    doc.text(s.firstName + ' ' + s.lastName, 50, y, { width: 180 });
    doc.text(s.username, 240, y, { width: 130 });
    doc.text(s.password, 380, y, { width: 100 });
    y += 20;
  });
  doc.end();
});

/* ============================================================
   API: POGLAVJA
   ============================================================ */
app.get('/api/topics', requireAdmin, (req, res) => {
  const grade = req.query.grade ? parseInt(req.query.grade, 10) : null;
  const list = Object.entries(TOPICS)
    .filter(([k, t]) => !grade || t.grade === grade)
    .map(([key, t]) => ({ key, name: t.name, grade: t.grade, description: t.description }));
  res.json(list);
});

app.get('/api/chapters', (req, res) => {
  const grade = req.query.grade ? parseInt(req.query.grade, 10) : null;
  let list = DATA.chapters;
  if (grade) list = list.filter(c => c.grade === grade);
  res.json(list);
});

app.post('/api/chapters', requireAdmin, async (req, res) => {
  const { title, topicKey, grade, category, deadline } = req.body || {};
  if (!title || !topicKey || !grade || !category) return res.status(400).json({ error: 'Manjka polje.' });
  if (!TOPICS[topicKey]) return res.status(400).json({ error: 'Neznana tema.' });
  if (category === 'domaca' && !deadline) return res.status(400).json({ error: 'Za domačo rok obvezen.' });
  const g = parseInt(grade, 10);
  if (TOPICS[topicKey].grade !== g) return res.status(400).json({ error: 'Tema ne ustreza razredu.' });
  const ch = {
    id: 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    title,
    topicKey,
    grade: g,
    category,
    deadline: deadline || null,
    createdAt: Date.now()
  };
  DATA.chapters.push(ch);
  await saveData();
  res.json(ch);
});

app.put('/api/chapters/:id', requireAdmin, async (req, res) => {
  const ch = DATA.chapters.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  const { title, topicKey, grade, category, deadline } = req.body || {};
  if (title !== undefined) ch.title = title;
  if (topicKey !== undefined) { if (!TOPICS[topicKey]) return res.status(400).json({ error: 'Neznana tema.' }); ch.topicKey = topicKey; }
  if (grade !== undefined) ch.grade = parseInt(grade, 10);
  if (category !== undefined) ch.category = category;
  if (deadline !== undefined) ch.deadline = deadline || null;
  await saveData();
  res.json(ch);
});

app.delete('/api/chapters/:id', requireAdmin, async (req, res) => {
  DATA.chapters = DATA.chapters.filter(c => c.id !== req.params.id);
  if (db) await db.collection('chapters').deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

/* ============================================================
   POMOŽNA: NOVA SEJA
   ============================================================ */
function createEmptySession() {
  return { progression: { level: 1, correctInLevel: 0 }, correct: 0, attempts: 0, currentTask: null, finished: false, awaitingNext: false, lastQuestions: [], updatedAt: Date.now() };
}
function requiredInLevel(level) { return level === 3 ? 1 : 2; }

/* ============================================================
   GENERIRANJE NALOGE
   ============================================================ */
function generateForSession(sess, topicKey) {
  const topic = TOPICS[topicKey];
  if (!topic) return null;
  const level = sess.progression.level;
  const recentQ = (sess.lastQuestions || []).slice(-8);
  let task = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = topic.generate(level);
    if (!recentQ.includes(candidate.question)) { task = candidate; break; }
  }
  if (!task) task = topic.generate(level);
  return task;
}

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
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) return res.status(403).json({ error: 'Rok je potekel.' });
  if (!ch.topicKey || !TOPICS[ch.topicKey]) return res.status(400).json({ error: 'Ta sklop še ni posodobljen. Obrnite se na učitelja.' });
  if (reset) {
    DATA.sessions[username] = DATA.sessions[username] || {};
    DATA.sessions[username][chapterId] = createEmptySession();
    saveData();
  }
  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  if (!DATA.sessions[username][chapterId]) DATA.sessions[username][chapterId] = createEmptySession();
  const sess = DATA.sessions[username][chapterId];
  res.json({
    ok: true,
    level: sess.progression.level,
    correct: sess.correct,
    attempts: sess.attempts,
    finished: sess.finished,
    progression: sess.progression,
    requiredInLevel: requiredInLevel(sess.progression.level),
    hasCurrentTask: !!sess.currentTask && !sess.finished,
    currentTask: sess.currentTask && !sess.finished ? {
      question: sess.currentTask.question,
      sketch: sess.currentTask.sketch || null,
      answers: sess.currentTask.answers.map(a => ({ label: a.label, latex: a.latex })),
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
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka podatek.' });
  const user = DATA.users[username];
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Samo učenec.' });
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.grade !== user.grade) return res.status(403).json({ error: 'Napačen razred.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) return res.status(403).json({ error: 'Rok je potekel.' });
  if (!ch.topicKey || !TOPICS[ch.topicKey]) return res.status(400).json({ error: 'Ta sklop še ni posodobljen. Obrnite se na učitelja.' });

  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  if (!DATA.sessions[username][chapterId]) DATA.sessions[username][chapterId] = createEmptySession();
  const sess = DATA.sessions[username][chapterId];
  if (sess.finished) return res.json({ finished: true, correct: sess.correct, attempts: sess.attempts, level: sess.progression.level });

  const task = generateForSession(sess, ch.topicKey);
  if (!task) return res.status(500).json({ error: 'Naloge ni mogoče pripraviti.' });

  sess.currentTask = {
    question: task.question,
    answers: task.answers,
    steps: task.steps,
    sketch: task.sketch || null,
    level: sess.progression.level
  };
  sess.awaitingNext = false;
  sess.lastQuestions = (sess.lastQuestions || []).concat([task.question]).slice(-10);
  await saveData();

  res.json({
    question: task.question,
    answers: task.answers.map(a => ({ label: a.label, latex: a.latex })),
    sketch: task.sketch || null,
    level: sess.progression.level,
    correct: sess.correct,
    progression: sess.progression,
    requiredInLevel: requiredInLevel(sess.progression.level)
  });
});

/* ============================================================
   API: PREVERJANJE
   ============================================================ */
app.post('/api/check-answer', async (req, res) => {
  const { username, userAnswers } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Manjka username.' });
  const user = DATA.users[username];
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Samo učenec.' });
  let chapterId = null;
  if (DATA.sessions[username]) Object.keys(DATA.sessions[username]).forEach(cid => {
    if (DATA.sessions[username][cid].currentTask && !DATA.sessions[username][cid].finished) chapterId = cid;
  });
  if (!chapterId) return res.status(400).json({ error: 'Ni aktivne naloge.' });
  const sess = DATA.sessions[username][chapterId];
  if (sess.awaitingNext) return res.status(400).json({ error: 'Najprej klikni gumb.' });
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) { sess.finished = true; saveData(); return res.status(403).json({ error: 'Rok je potekel.' }); }

  const expected = sess.currentTask.answers;
  let allCorrect = true;
  for (let i = 0; i < expected.length; i++) {
    const raw = (Array.isArray(userAnswers) && userAnswers[i] !== undefined) ? userAnswers[i] : '';
    const val = parseNumberString(raw);
    if (!numbersEqual(val, expected[i].value)) { allCorrect = false; break; }
  }

  sess.attempts++;
  if (!DATA.stats[username]) DATA.stats[username] = {};
  if (!DATA.stats[username][chapterId]) DATA.stats[username][chapterId] = { total: 0, correct: 0, correctFirst: 0, wrong: 0, byType: {}, history: [], errors: [] };
  const st = DATA.stats[username][chapterId];
  st.total++;
  if (allCorrect) { st.correct++; if (sess.attempts === 1) st.correctFirst++; }
  else {
    st.wrong++;
    const existing = st.errors.find(e => e.question === sess.currentTask.question);
    if (existing) existing.count++;
    else st.errors.push({ question: sess.currentTask.question, userAns: (Array.isArray(userAnswers) ? userAnswers.join(' | ') : ''), correctAns: expected.map(e => e.latex).join(' | '), count: 1, level: sess.currentTask.level });
    if (st.errors.length > 100) st.errors = st.errors.slice(-100);
  }
  const t = 'llm';
  if (!st.byType[t]) st.byType[t] = { total: 0, correct: 0 };
  st.byType[t].total++;
  if (allCorrect) st.byType[t].correct++;
  st.history.push({ ts: Date.now(), question: sess.currentTask.question, ok: allCorrect, attempt: sess.attempts, level: sess.currentTask.level });
  if (st.history.length > 300) st.history = st.history.slice(-300);
  await saveData();

  if (allCorrect) {
    sess.correct++;
    sess.progression.correctInLevel++;
    const req = requiredInLevel(sess.progression.level);
    if (sess.progression.correctInLevel >= req) {
      if (sess.progression.level < 3) { sess.progression.level++; sess.progression.correctInLevel = 0; }
      else sess.finished = true;
    }
    sess.awaitingNext = false;
    await saveData();
    if (sess.finished) return res.json({ correct: true, finished: true, correctCount: sess.correct, attempts: sess.attempts, message: 'Bravo! Rešil si vse naloge na vseh treh stopnjah! 🎉', progression: sess.progression, requiredInLevel: requiredInLevel(sess.progression.level) });
    return res.json({ correct: true, finished: false, correctCount: sess.correct, nextLevel: sess.progression.level, progression: sess.progression, requiredInLevel: requiredInLevel(sess.progression.level), message: 'Odlično! Pravilno.' });
  } else {
    sess.awaitingNext = true;
    await saveData();
    return res.json({
      correct: false, finished: false,
      correctCount: sess.correct,
      correctAnswers: expected.map(e => ({ label: e.label, value: e.value, latex: e.latex })),
      steps: sess.currentTask.steps,
      progression: sess.progression,
      requiredInLevel: requiredInLevel(sess.progression.level),
      message: 'Ni pravilno. Preberi razlago in klikni "Poskusi s podobno nalogo".'
    });
  }
});

app.post('/api/reset-session', async (req, res) => {
  const { username, chapterId } = req.body || {};
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka podatek.' });
  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  DATA.sessions[username][chapterId] = createEmptySession();
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
    const s = st[chId]; const ch = DATA.chapters.find(c => c.id === chId);
    if (!ch) return;
    const pct = s.total ? Math.round(100 * s.correct / s.total) : 0;
    const topErrors = (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 5);
    result.push({ chapterId: chId, title: ch.title, grade: ch.grade, category: ch.category, total: s.total, correct: s.correct, correctFirst: s.correctFirst, pct, topErrors, byType: [] });
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
      const s = uStats[chId]; const ch = DATA.chapters.find(c => c.id === chId);
      if (!ch) return;
      uTotal += s.total; uCorrect += s.correct;
      result.overall.total += s.total; result.overall.correct += s.correct;
      const g = ch.grade;
      if (!result.byGrade[g]) result.byGrade[g] = { total: 0, correct: 0, chapters: {} };
      result.byGrade[g].total += s.total; result.byGrade[g].correct += s.correct;
      if (!result.byGrade[g].chapters[chId]) result.byGrade[g].chapters[chId] = { total: 0, correct: 0, title: ch.title };
      result.byGrade[g].chapters[chId].total += s.total; result.byGrade[g].chapters[chId].correct += s.correct;
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
    perStudent.push({ username: u, total: s.total, correct: s.correct, correctFirst: s.correctFirst, wrong: s.wrong, pct: Math.round(100 * s.correct / s.total), topErrors: (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 5), byType: s.byType });
  });
  const total = perStudent.reduce((a, b) => a + b.total, 0);
  const correct = perStudent.reduce((a, b) => a + b.correct, 0);
  const pct = total ? Math.round(100 * correct / total) : 0;
  const errorMap = {};
  perStudent.forEach(p => (p.topErrors || []).forEach(e => {
    if (!errorMap[e.question]) errorMap[e.question] = { question: e.question, correctAns: e.correctAns, count: 0 };
    errorMap[e.question].count += e.count;
  }));
  const topClassErrors = Object.values(errorMap).sort((a, b) => b.count - a.count).slice(0, 10);
  const analysis = {
    generatedAt: Date.now(), chapterId, title: ch.title, grade: ch.grade, category: ch.category,
    deadline: ch.deadline, totalAttempts: total, correct, pct,
    activeStudents: perStudent.length, perStudent, classByType: {}, topClassErrors
  };
  DATA.analyses[chapterId] = analysis;
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
  if (!user || user.role !== 'student') return res.status(404).json({ error: 'Učenec ne obstaja.' });
  const uStats = DATA.stats[username] || {};
  const chapters = [];
  Object.keys(uStats).forEach(chId => {
    const s = uStats[chId]; const ch = DATA.chapters.find(c => c.id === chId);
    if (!ch || !s.total) return;
    const pct = Math.round(100 * s.correct / s.total);
    const topErrors = (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 10);
    const recentHistory = (s.history || []).slice(-20).reverse();
    chapters.push({ chapterId: chId, title: ch.title, grade: ch.grade, category: ch.category, deadline: ch.deadline || null, total: s.total, correct: s.correct, correctFirst: s.correctFirst, wrong: s.wrong, pct, byType: [], topErrors, recentHistory });
  });
  const totalAll = chapters.reduce((a, c) => a + c.total, 0);
  const correctAll = chapters.reduce((a, c) => a + c.correct, 0);
  const overallPct = totalAll ? Math.round(100 * correctAll / totalAll) : 0;
  res.json({ username, firstName: user.firstName, lastName: user.lastName, grade: user.grade, overall: { total: totalAll, correct: correctAll, pct: overallPct }, chapters });
});

/* ============================================================
   ZAGON
   ============================================================ */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Strežnik: http://localhost:${PORT}`);
  console.log(`   📚 ${Object.keys(TOPICS).length} tem v knjižnici`);
});
connectDB().then(() => console.log('✅ Baza pripravljena.')).catch(err => { console.error('❌ Baza ni uspela:', err.message); });
