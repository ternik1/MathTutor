// server.js
// Zaženi:
//   $env:GROQ_API_KEY="gsk_..."
//   $env:MONGODB_URI="mongodb+srv://..."
//   node server.js

const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const path = require('path');
const PDFDocument = require('pdfkit');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

if (!process.env.GROQ_API_KEY) console.warn('⚠️  GROQ_API_KEY ni nastavljen.');
if (!process.env.MONGODB_URI) console.error('❌ MONGODB_URI ni nastavljen!');

/* ============================================================
   POMOŽNE
   ============================================================ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeLatex(s) {
  if (!s) return s;
  let t = String(s);
  t = t.replace(/\\\\/g, '\\');
  t = t.replace(/\\text\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\mathrm\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\mbox\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\text/g, '');
  return t;
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

function numbersEqual(a, b, tolerance = 1e-9) {
  if (isNaN(a) || isNaN(b)) return false;
  const diff = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff <= tolerance * scale;
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

/* ============================================================
   PREVERJANJE SKICE
   ============================================================ */
function textHasNumbers(text) {
  if (!text) return false;
  const cleaned = String(text).replace(/^\s*\d+[.)]\s*/, '');
  return /-?\d+(?:[.,]\d+)?/.test(cleaned);
}

function sketchHasNumbers(sketch) {
  if (!sketch || typeof sketch !== 'object') return false;
  const data = sketch.data || {};
  for (const key of Object.keys(data)) {
    if (key === 'unit') continue;
    const v = data[key];
    if (typeof v === 'number' && !isNaN(v)) return true;
    if (typeof v === 'string' && /-?\d+(?:[.,]\d+)?/.test(v)) return true;
  }
  return false;
}

function hasSketchData(sketch) { return !!(sketch && sketch.type); }

function validateSketch(question, sketch) {
  if (!sketch || !sketch.type) return { ok: true };
  const data = sketch.data || {};
  if (sketchHasNumbers(sketch) && textHasNumbers(question)) {
    return { ok: false, reason: 'Skica in besedilo hkrati vsebujeta številke (podvajanje podatkov).' };
  }
  if (sketch.type === 'triangle') {
    const isEquilateral = /enakostran|enakostrani/i.test(question);
    const a = parseFloat(data.a), b = parseFloat(data.b), c = parseFloat(data.c);
    if (!isNaN(a) && !isNaN(b) && !isNaN(c) && a === b && b === c && !isEquilateral) {
      return { ok: false, reason: 'Skica prikazuje trikotnik z enakimi stranicami, vendar besedilo ne navaja "enakostranični trikotnik".' };
    }
  }
  return { ok: true };
}

/* ============================================================
   UČNI NAČRT – RAZŠIRJEN S PRIMERI NALOG (brez RAG)
   ============================================================ */
const CURRICULUM_BY_GRADE = {
  6: {
    title: '6. razred OŠ – Matematika 6',
    source: 'https://eucbeniki.sio.si/matematika6',
    topics: [
      'Naravna števila: velika števila, urejenost, primerjanje, rimske številke, zaokroževanje, večkratniki in delitelji, pravila deljivosti, seštevanje in odštevanje, množenje in potence, deljenje, zakoni računanja, zakon o razčlenjevanju, besedilne naloge, uporaba računala',
      'Enačbe in neenačbe: izrazi s spremenljivkami, enačbe, reševanje enačb, neenačbe, besedilne naloge',
      'Geometrija v ravnini: točka, premica, daljica, pravokotnice, vzporednice, razdalja, razdalja med vzporednicama',
      'Ulomki in decimalni zapis: ulomki so deli celote, ulomki na številski premici, ulomki kot merska števila, desetiški ulomki, decimalne številke, primerjanje in urejanje, zaokroževanje',
      'Količine in merjenje: denar, merimo čas, tehtamo maso, računamo z maso, dolžine, računamo z dolžinami, ploščine, računamo s ploščinami, prostornina, računamo s prostornino',
      'Računanje z decimalnimi števili: seštevanje, odštevanje, množenje in deljenje z 10^n, množenje decimalnih števil, ulomek je količnik naravnih števil, deljenje decimalnih števil, številski izrazi brez/z oklepaji',
      'Povezanost količin: razmerje količin, sklepanje',
      'Liki in telesa: obsegi likov, ploščine likov, kvader, kocka, površina kvadra, površina kocke, prostornina kvadra in kocke',
      'Krog in kot: koti, primerjanje kotov, skladnost, vrste kotov, merjenje kotov, načrtovanje kotov, računanje s koti, krožnica, krog, premica in krožnica, tetiva, izsek, odsek',
      'Obdelava podatkov: zbiranje in urejanje podatkov, razvrščanje, preiskave, kombinatorične situacije'
    ],
    examples: [
      'Izračunaj: 3 456 + 2 789 − 1 234.',
      'Katero število je zaokroženo na stotice enako 4 500?',
      'Pravokotnik ima stranici a = 8 cm in b = 5 cm. Izračunaj obseg in ploščino.',
      'Kocka ima rob a = 3 cm. Izračunaj površino in prostornino.',
      'Koliko je 2/5 od 30?',
      'Mama je kupila 2,5 kg jabolk in 1,75 kg hrušk. Koliko sadja je kupila skupaj?',
      'Pretvori 3,5 km v metre.',
      'V košari je 12 rdečih in 8 zelenih jabolk. Koliko je vseh jabolk?'
    ]
  },
  7: {
    title: '7. razred OŠ – Matematika 7',
    source: 'https://eucbeniki.sio.si/matematika7',
    topics: [
      'Naravna števila: praštevila, največji skupni delitelj, najmanjši skupni večkratnik, naloge z besedilom',
      'Racionalna števila: ulomek je število, krajšanje, razširjanje, najmanjši skupni imenovalec, primerjanje ulomkov, desetiški in nedesetiški ulomki',
      'Transformacije ravnine: usmerjenost in orientacija, premik in zasuk, zrcaljenje čez premico, zrcaljenje čez točko, osna in središčna simetričnost, simetrala daljice, simetrala kota, dvojice kotov',
      'Seštevanje in odštevanje ulomkov: seštevanje, odštevanje, ulomki z različnimi imenovalci, lastnosti, naloge z besedilom',
      'Množenje in deljenje ulomkov: množenje ulomka z naravnim številom, množenje ulomka z ulomkom, obratna ulomka, deljenje ulomkov, lastnosti, zakon o razčlenjevanju, številski izrazi brez/z oklepaji',
      'Izrazi in enačbe: izrazi s spremenljivko, računanje s spremenljivkami, enačbe s seštevanjem in odštevanjem, enačbe z množenjem in deljenjem',
      'Trikotniki: opis trikotnika, vrste trikotnikov, načrtovanje, višina, očrtana in včrtana krožnica, težišče, obseg trikotnika, ploščina trikotnika',
      'Odstotek: zapis deleža z odstotkom, računanje z odstotki, spremembe in odstotki, računanje osnove, grafični prikaz',
      'Odvisnost količin in podatki: koordinatna mreža, odvisnost količin, zbiranje in urejanje podatkov, aritmetična sredina, kombinatorične situacije',
      'Štirikotniki: vrste štirikotnikov, načrtovanje, paralelogram, obseg in ploščina paralelograma, trapez, obseg in ploščina trapeza, deltoid, obseg in ploščina deltoida'
    ],
    examples: [
      'Izračunaj največji skupni delitelj števil 24 in 36.',
      'Izračunaj: 2/3 + 1/4.',
      'Izračunaj: 3/5 · 10/9.',
      'Reši enačbo: x + 12 = 25.',
      'Trikotnik ima stranice a = 5 cm, b = 6 cm, c = 7 cm. Izračunaj obseg.',
      'Trikotnik ima osnovnico a = 8 cm in višino v = 4 cm. Izračunaj ploščino.',
      'Koliko je 15 % od 200?',
      'Paralelogram ima osnovnico a = 6 cm in višino v = 4 cm. Izračunaj ploščino.',
      'V razredu je 25 učencev. Povprečna ocena pri matematiki je 3,8. Koliko je vsota vseh ocen?'
    ]
  },
  8: {
    title: '8. razred OŠ – Matematika 8',
    source: 'https://eucbeniki.sio.si/mat8',
    topics: [
      'Racionalna števila: cela števila, racionalna števila, absolutna in nasprotna vrednost, urejanje',
      'Računske operacije: seštevanje števil z enakimi predznaki, seštevanje števil z različnimi predznaki, odštevanje racionalnih števil, prištevanje in odštevanje izrazov, množenje racionalnih števil, deljenje racionalnih števil, zakon o razčlenjevanju',
      'Potence: potence z enako osnovo, velika in majhna števila, potence z enako stopnjo, kvadriranje, kvadratni koren, približki korenov, iracionalna in realna števila, delno korenjenje in racionalizacija',
      'Izrazi s spremenljivko: spremenljivke, množenje enočlenikov, seštevanje enočlenikov, prištevanje in odštevanje izraza, množenje enočlenika z veččlenikom, izpostavljanje skupnega faktorja',
      'Enačbe in neenačbe: enačbe, reševanje enačb, identična in ekvivalentna enačba',
      'Večkotniki: diagonale in koti večkotnika, pravilni večkotniki, obseg in ploščina večkotnikov',
      'Odvisnost količin in sorazmerja: koordinate točk, odvisnost in ponazarjanje količin, premo sorazmerje, graf premo sorazmernih količin, obratno sorazmerje, graf obratno sorazmernih količin',
      'Podatki: obdelava podatkov, aritmetična sredina, povezanost spremenljivk, preiskave',
      'Krog in krožnica: obseg kroga, ploščina kroga, krožni lok, krožni izsek',
      'Pitagorov izrek: Pitagorov izrek, dolžine stranic, pravokotnik in kvadrat, enakokraki trikotnik, enakostranični trikotnik, v rombu, v enakokrakem trapezu, v deltoidu, v koordinatnem sistemu',
      'Kocka in kvader: lastnosti, površina kocke, prostornina kocke, površina kvadra, prostornina kvadra, diagonalni preseki'
    ],
    examples: [
      'Izračunaj: (−5) + (−3).',
      'Izračunaj: (−8) · (+4).',
      'Poenostavi izraz: 3x + 5x − 2x.',
      'Reši enačbo: 3x + 7 = 22.',
      'Izračunaj kvadratni koren števila 144.',
      'Krog ima polmer r = 5 cm. Izračunaj obseg in ploščino (π ≈ 3,14).',
      'Pravokotni trikotnik ima kateti a = 3 cm in b = 4 cm. Izračunaj hipotenuzo.',
      'Kocka ima rob a = 4 cm. Izračunaj površino in prostornino.',
      'Kvader ima dimenzije a = 5 cm, b = 3 cm, c = 2 cm. Izračunaj prostornino.',
      'Preveri, ali je 0,75 enako 3/4.'
    ]
  },
  9: {
    title: '9. razred OŠ – Matematika 9',
    source: 'https://eucbeniki.sio.si/mat9',
    topics: [
      'Izrazi: množenje veččlenikov, kvadrat dvočlenika, produkt vsote in razlike, razstavljanje, algebrski ulomki',
      'Enačbe in neenačbe: linearna enačba, ekvivalentno preoblikovanje, enačbe z oklepaji, enačbe z ulomki, enačbe s kvadrati števil, formule, enačbe s parametri, neenačbe, besedilne naloge s števili, o geometriji, o starosti, uporaba enačb',
      'Geometrijski elementi v prostoru: geometrija v ravnini in prostoru, ravnina in prostor, razdalja v prostoru',
      'Linearna funkcija: koordinatni sistem, funkcija, premo sorazmerje je funkcija, obratno sorazmerje je funkcija, linearna funkcija, začetna vrednost, smerni koeficient, enačba premice, ničla linearne funkcije, presečišče premic, sistem linearnih enačb',
      'Obdelava podatkov: podatki in vprašalniki, srednje vrednosti podatkov, škatla z brki, priprava in izvedba ankete',
      'Razmerje in podobnost: razmerje količin, sorazmerje, premo sorazmerje, obratno sorazmerje, podobnost, podobni trikotniki, načrtovanje podobnih trikotnikov, Talesovi izreki, delitev daljice',
      'Oglata telesa: prizma, mreža in površina prizme, prostornina prizme, piramida, mreža in površina piramide, prostornina piramide, 4-strana in 3-strana piramida, sestavljena telesa',
      'Okrogla telesa: valj, mreža in površina valja, prostornina valja, stožec, mreža in površina stožca, prostornina stožca, sestavljena telesa, krogla',
      'Verjetnost in kombinatorika: poskus, dogodek, izid, računanje verjetnosti'
    ],
    examples: [
      'Izračunaj: (x + 3)(x − 2).',
      'Razstavi izraz: x² − 9.',
      'Reši enačbo: 2(x − 3) = 4x + 8.',
      'Reši enačbo: x/2 + 3 = 7.',
      'Linearna funkcija: y = 2x + 1. Izračunaj vrednost pri x = 3 in določi ničlo.',
      'Dani sta premici y = 2x + 1 in y = −x + 4. Poišči presečišče.',
      'Prizma ima osnovno ploskev pravokotnik s stranicama 4 cm in 3 cm, višina prizme je 5 cm. Izračunaj prostornino.',
      'Piramida ima kvadratno osnovno ploskev s stranico 4 cm in višino 6 cm. Izračunaj prostornino.',
      'Valj ima polmer r = 3 cm in višino v = 5 cm. Izračunaj prostornino (π ≈ 3,14).',
      'Krogla ima polmer r = 4 cm. Izračunaj površino in prostornino (π ≈ 3,14).',
      'V škatli je 5 rdečih in 7 modrih kroglic. Kolikšna je verjetnost, da potegnemo rdečo?'
    ]
  }
};

function curriculumForGrade(grade) {
  return CURRICULUM_BY_GRADE[grade] || CURRICULUM_BY_GRADE[7];
}

/* ============================================================
   PRAVILA GLEDE NA STOPNJO
   ============================================================ */
function allowedStepsForLevel(level) {
  if (level <= 1) return 1;
  if (level === 2) return 2;
  return 3;
}

function validateStepsRequired(level, stepsRequired) {
  if (!Array.isArray(stepsRequired) || stepsRequired.length === 0) return { ok: true };
  const allowed = allowedStepsForLevel(level);
  if (stepsRequired.length > allowed) {
    return { ok: false, reason: `Naloga zahteva ${stepsRequired.length} korakov, stopnja ${level} dovoljuje največ ${allowed}.` };
  }
  return { ok: true };
}

function validateTopicForLevel(question, level, topicRules) {
  if (!topicRules) return { ok: true };
  const rules = topicRules[level] || topicRules[3];
  if (!rules) return { ok: true };
  const q = String(question).toLowerCase();
  if (rules.forbidden) {
    for (const bad of rules.forbidden) {
      if (q.includes(bad.toLowerCase())) {
        return { ok: false, reason: `Naloga vsebuje prepovedan koncept za stopnjo ${level}: "${bad}".` };
      }
    }
  }
  return { ok: true };
}

/* ============================================================
   PROFIL UČENCA
   ============================================================ */
function buildStudentProfile(username, chapterId) {
  const stats = DATA.stats[username] && DATA.stats[username][chapterId];
  if (!stats || !stats.total) return 'Ta učenec je prvič v tem poglavju, brez preteklih podatkov.';
  const pct = Math.round(100 * stats.correct / stats.total);
  const errorTypes = Object.keys(stats.byType || {}).map(t => {
    const bt = stats.byType[t]; const wrong = bt.total - bt.correct;
    return wrong > 0 ? `${t}: ${wrong}/${bt.total} napačnih` : null;
  }).filter(Boolean).join(', ');
  const lastErrors = (stats.errors || []).slice(-3).map(e => e.question).join('; ');
  return `Učenec je v tem poglavju rešil ${stats.total} nalog, uspešnost ${pct}%.\nRazčlenitev napak po tipih: ${errorTypes || 'ni posebnih napak'}.\nZadnje 3 napake: ${lastErrors || 'brez'}.`;
}

/* ============================================================
   PRAVILA PO TEMI IN STOPNJI
   ============================================================ */
function getTopicRules(topicText) {
  const t = (topicText || '').toLowerCase();
  if ((t.includes('trikot') || t.includes('obseg') || t.includes('ploščin')) && !t.includes('pitagor')) {
    return {
      1: { forbidden: ['pitagor', 'hipotenuz', '√', 'koren', 'višina iz stranic'], note: 'Samo neposredni izračun obsega s tremi znanimi stranicami ali ploščine z znano osnovnico in višino.' },
      2: { forbidden: ['pitagor', 'hipotenuz', '√', 'koren'], note: 'Besedilne naloge z obsegom in ploščino. Brez Pitagorovega izreka.' },
      3: { forbidden: ['pitagor', 'hipotenuz'], note: 'Kombinirane naloge iz obsega in ploščine. Brez Pitagorovega izreka.' }
    };
  }
  if (t.includes('pitagor')) {
    return { 1: { forbidden: [], note: 'Prepoznaj pravokotni trikotnik.' }, 2: { forbidden: [], note: 'Pitagorov izrek s trojicami (3,4,5).' }, 3: { forbidden: [], note: 'Pitagorov izrek v besedilni nalogi.' } };
  }
  if (t.includes('celo') || t.includes('cela') || t.includes('negativ') || t.includes('predznak')) {
    return { 1: { forbidden: ['ulom', 'decimal', 'koren', 'potenc'], note: 'Seštevanje in odštevanje enomestnih celih števil.' }, 2: { forbidden: ['ulom', 'decimal'], note: 'Množenje/deljenje enomestnih celih števil.' }, 3: { forbidden: ['ulom', 'decimal'], note: 'Kombinacija dveh operacij z dvomestnimi celimi števili.' } };
  }
  if (t.includes('ulom')) {
    return { 1: { forbidden: ['decimal'], note: 'Ulomki z enakim imenovalcem, seštevanje.' }, 2: { forbidden: ['decimal'], note: 'Ulomki z enakim imenovalcem, odštevanje.' }, 3: { forbidden: [], note: 'Ulomki z različnimi imenovalci.' } };
  }
  if (t.includes('decimal')) {
    return { 1: { forbidden: ['ulom'], note: 'Decimalna števila z eno decimalko, seštevanje.' }, 2: { forbidden: ['ulom'], note: 'Decimalna števila z eno decimalko, odštevanje.' }, 3: { forbidden: ['ulom'], note: 'Decimalna števila z dvema decimalkama.' } };
  }
  return null;
}

function strictLevelRules(grade, topic) {
  const t = (topic || '').toLowerCase();
  const isCela = t.includes('celo') || t.includes('cela') || t.includes('negativ') || t.includes('predznak');
  const isUlomki = t.includes('ulom');
  const isDecimal = t.includes('decimal');
  const isPotence = t.includes('potenc') || t.includes('koren');
  const isOdstotki = t.includes('odstot');
  const isEnacbe = t.includes('enačb') || t.includes('enacb');
  const isPitagora = t.includes('pitagor');
  const isGeometrija = t.includes('geometr') || isPitagora || t.includes('krog') || t.includes('kot') || t.includes('trikot') || t.includes('lik') || t.includes('telo') || t.includes('koordinat') || t.includes('obseg') || t.includes('ploščin');

  if (isPitagora) return { 1: 'prepoznaj pravokotni trikotnik.', 2: 'Pitagorov izrek s trojicami.', 3: 'Pitagorov izrek v besedilni nalogi.' };
  if (isCela) return { 1: 'seštevanje in odštevanje enomestnih celih števil.', 2: 'množenje/deljenje enomestnih celih števil.', 3: 'kombinacija dveh operacij z dvomestnimi celimi števili.' };
  if (isUlomki) return { 1: 'ulomki z enakim imenovalcem, seštevanje.', 2: 'ulomki z enakim imenovalcem, odštevanje.', 3: 'ulomki z različnimi imenovalci.' };
  if (isDecimal) return { 1: 'decimalna števila z eno decimalko, seštevanje.', 2: 'decimalna števila z eno decimalko, odštevanje.', 3: 'decimalna števila z dvema decimalkama.' };
  if (isPotence) return { 1: 'kvadrat enomestnega števila.', 2: 'kvadrat dvomestnega števila.', 3: 'kvadratni koren popolnega kvadrata.' };
  if (isOdstotki) return { 1: '10 % od okroglega števila.', 2: '1 % in 10 % od števila.', 3: 'poljuben odstotek.' };
  if (isEnacbe) return { 1: 'enačba z eno operacijo.', 2: 'enačba z dvema operacijama.', 3: 'enačba z oklepaji.' };
  if (isGeometrija) return { 1: 'obseg pravokotnika ali ploščina kvadrata.', 2: 'obseg/ploščina trikotnika s tremi znanimi stranicami.', 3: 'kombinirana geometrijska naloga brez Pitagorovega izreka.' };
  return { 1: 'enomestna števila, ena operacija.', 2: 'dvomestna števila, ena operacija.', 3: 'dvomestna števila, dve operaciji.' };
}

function taskTypeAllowed(question, topic) {
  const t = (topic || '').toLowerCase();
  const q = (question || '').toLowerCase();
  const allowsFractions = t.includes('ulom');
  const allowsDecimal = t.includes('decimal') || t.includes('odstot') || t.includes('koren') || t.includes('potenc');
  const isCela = t.includes('celo') || t.includes('cela') || t.includes('negativ') || t.includes('predznak');
  if (!allowsFractions && /\\frac/.test(q)) return false;
  if (!allowsDecimal && /[0-9],[0-9]|[0-9]\.[0-9]/.test(q)) return false;
  if (!t.includes('potenc') && !t.includes('koren') && /\^/.test(q)) { if (!allowsDecimal) return false; }
  if (isCela && /\\frac/.test(q)) return false;
  return true;
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

function chapterTopicText(ch) {
  const parts = [];
  if (ch.title) parts.push(ch.title);
  if (ch.llmPrompt) parts.push(ch.llmPrompt);
  else if (ch.instructions) parts.push(ch.instructions);
  return parts.join(' ').trim();
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
   SHRAMBA
   ============================================================ */
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient = null;
let db = null;

let DATA = { users: {}, chapters: [], stats: {}, analyses: {}, autoAnalyzed: {}, sessions: {}, recentTasks: {} };

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
    for (const [key, val] of Object.entries(DATA.users)) await db.collection('users').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    for (const ch of DATA.chapters) await db.collection('chapters').updateOne({ _id: ch.id }, { $set: { value: ch } }, { upsert: true });
    for (const [key, val] of Object.entries(DATA.stats)) await db.collection('stats').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    for (const [key, val] of Object.entries(DATA.analyses)) await db.collection('analyses').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    for (const [key, val] of Object.entries(DATA.sessions)) await db.collection('sessions').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
    for (const [key, val] of Object.entries(DATA.recentTasks)) await db.collection('recentTasks').updateOne({ _id: key }, { $set: { value: val } }, { upsert: true });
  } catch (err) { console.warn('Napaka pri shranjevanju:', err.message); }
}

/* ============================================================
   KVOTA IN RETRY
   ============================================================ */
let lastKnownQuota = { remainingRequests: null, resetRequestsMs: null, remainingTokens: null, resetTokensMs: null, lastUpdated: 0 };
function parseResetTime(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^([\d.]+)(ms|s|m|h)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]); const u = m[2] || 's';
  if (u === 'ms') return v; if (u === 's') return v * 1000; if (u === 'm') return v * 60 * 1000; if (u === 'h') return v * 3600 * 1000;
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
  if (lastKnownQuota.remainingRequests !== null && lastKnownQuota.remainingRequests <= 1) { const w = lastKnownQuota.resetRequestsMs || 5000; await sleep(w + 200); }
  if (lastKnownQuota.remainingTokens !== null && lastKnownQuota.remainingTokens <= 300) { const w = lastKnownQuota.resetTokensMs || 5000; await sleep(w + 200); }
}

async function callAI(messages, maxAttempts = 6) {
  let lastErr;
  for (let a = 1; a <= maxAttempts; a++) {
    await waitIfQuotaLow();
    try {
      const r = await groqClient.chat.completions.create({ model: GROQ_MODEL, messages, response_format: { type: 'json_object' }, temperature: 0.7, max_tokens: 1200 });
      if (r && r._response && r._response.headers) updateQuotaFromHeaders(r._response.headers);
      return r;
    } catch (err) {
      lastErr = err;
      const st = err.status || (err.response && err.response.status);
      if (st === 401 || st === 403) throw err;
      let w = Math.min(2000 * Math.pow(2, a - 1), 30000);
      if (st === 429) { const h = err.response && err.response.headers; const ra = h && (h.get ? h.get('retry-after') : h['retry-after']); if (ra) { const sec = parseFloat(ra); if (!isNaN(sec)) w = Math.max(w, sec * 1000 + 500); } }
      if (a < maxAttempts) { console.warn(`⚠️  Groq napaka (${st}), poskus ${a}/${maxAttempts}, čakam ${Math.round(w)}ms ...`); await sleep(w); }
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
  const oldUsername = req.params.username;
  if (!DATA.users[oldUsername] || DATA.users[oldUsername].role !== 'student') return res.status(404).json({ error: 'Učenec ne obstaja.' });
  const { firstName, lastName, grade, password, newUsername } = req.body || {};
  if (grade !== undefined && grade !== null && grade !== '') { const g = parseInt(grade, 10); if (![6, 7, 8, 9].includes(g)) return res.status(400).json({ error: 'Razred 6–9.' }); }
  let finalUsername = oldUsername;
  if (newUsername && newUsername.trim() !== '' && newUsername.trim() !== oldUsername) {
    const candidate = newUsername.trim();
    if (!/^[a-z0-9]+$/i.test(candidate)) return res.status(400).json({ error: 'Uporabniško ime lahko vsebuje le črke in številke.' });
    if (DATA.users[candidate]) return res.status(400).json({ error: 'To uporabniško ime je že zasedeno.' });
    finalUsername = candidate;
  }
  const updated = Object.assign({}, DATA.users[oldUsername]);
  if (firstName !== undefined && firstName !== '') updated.firstName = firstName;
  if (lastName !== undefined && lastName !== '') updated.lastName = lastName;
  if (grade !== undefined && grade !== null && grade !== '') updated.grade = parseInt(grade, 10);
  if (password !== undefined && password !== '') updated.password = password;
  if (finalUsername !== oldUsername) {
    DATA.users[finalUsername] = updated; delete DATA.users[oldUsername];
    if (DATA.stats[oldUsername]) { DATA.stats[finalUsername] = DATA.stats[oldUsername]; delete DATA.stats[oldUsername]; }
    if (DATA.sessions[oldUsername]) { DATA.sessions[finalUsername] = DATA.sessions[oldUsername]; delete DATA.sessions[oldUsername]; }
    if (DATA.recentTasks[oldUsername]) { DATA.recentTasks[finalUsername] = DATA.recentTasks[oldUsername]; delete DATA.recentTasks[oldUsername]; }
    if (db) { await db.collection('users').deleteOne({ _id: oldUsername }); await db.collection('stats').deleteOne({ _id: oldUsername }); await db.collection('sessions').deleteOne({ _id: oldUsername }); await db.collection('recentTasks').deleteOne({ _id: oldUsername }); }
  } else { DATA.users[oldUsername] = updated; }
  await saveData();
  res.json({ ok: true, username: finalUsername, user: DATA.users[finalUsername] });
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
  res.setHeader('Content-Disposition', 'attachment; filename="ucenci_' + grade + '_razred.pdf"');
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
  if (!students.length) { doc.text('Ni učencev v tem razredu.', 50, y); }
  else { students.forEach(s => { if (y > 780) { doc.addPage(); y = 50; } doc.text(s.firstName + ' ' + s.lastName, 50, y, { width: 180 }); doc.text(s.username, 240, y, { width: 130 }); doc.text(s.password, 380, y, { width: 100 }); y += 20; }); }
  doc.end();
});

/* ============================================================
   API: POGLAVJA
   ============================================================ */
app.get('/api/chapters', (req, res) => {
  const grade = req.query.grade ? parseInt(req.query.grade, 10) : null;
  const admin = isAdminRequest(req);
  let list = DATA.chapters;
  if (grade) list = list.filter(c => c.grade === grade);
  if (!admin) list = list.map(c => { const copy = Object.assign({}, c); delete copy.llmPrompt; return copy; });
  res.json(list);
});

app.get('/api/chapters/:id', (req, res) => {
  const ch = DATA.chapters.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (isAdminRequest(req)) return res.json(ch);
  const copy = Object.assign({}, ch); delete copy.llmPrompt; res.json(copy);
});

app.post('/api/chapters', requireAdmin, async (req, res) => {
  const { title, instructions, llmPrompt, type, grade, category, deadline } = req.body || {};
  if (!title || !type || !grade || !category) return res.status(400).json({ error: 'Manjka polje.' });
  if (category === 'domaca' && !deadline) return res.status(400).json({ error: 'Za domačo rok obvezen.' });
  const ch = { id: 'ch_' + Date.now() + '_' + Math.floor(Math.random() * 1000), title, instructions: instructions || '', llmPrompt: llmPrompt || '', type, grade: parseInt(grade, 10), category, deadline: deadline || null, createdAt: Date.now() };
  DATA.chapters.push(ch);
  await saveData();
  res.json(ch);
});

app.put('/api/chapters/:id', requireAdmin, async (req, res) => {
  const ch = DATA.chapters.find(c => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  const { title, instructions, llmPrompt, type, grade, category, deadline } = req.body || {};
  if (title !== undefined) ch.title = title;
  if (instructions !== undefined) ch.instructions = instructions;
  if (llmPrompt !== undefined) ch.llmPrompt = llmPrompt;
  if (type !== undefined) ch.type = type;
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
  return { progression: { level: 1, correctInLevel: 0 }, correct: 0, attempts: 0, currentTask: null, finished: false, awaitingNext: false, lastFailedTask: null, history: [], updatedAt: Date.now() };
}
function requiredInLevel(level) { return level === 3 ? 1 : 2; }

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
  if (reset) { DATA.sessions[username] = DATA.sessions[username] || {}; DATA.sessions[username][chapterId] = createEmptySession(); saveData(); }
  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  if (!DATA.sessions[username][chapterId]) DATA.sessions[username][chapterId] = createEmptySession();
  const sess = DATA.sessions[username][chapterId];
  res.json({ ok: true, level: sess.progression.level, correct: sess.correct, attempts: sess.attempts, finished: sess.finished, target: 5, grade: ch.grade, progression: sess.progression, requiredInLevel: requiredInLevel(sess.progression.level), hasCurrentTask: !!sess.currentTask && !sess.finished, currentTask: sess.currentTask && !sess.finished ? { question: sess.currentTask.question, sketch: sess.currentTask.sketch || null, answers: sess.currentTask.answers || null, level: sess.currentTask.level, awaitingNext: sess.awaitingNext } : null });
});

/* ============================================================
   API: GENERIRANJE (brez RAG, a z učnim načrtom + primeri)
   ============================================================ */
app.post('/api/generate-task', async (req, res) => {
  const { username, chapterId, isRetry } = req.body || {};
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka username ali chapterId.' });
  const user = DATA.users[username];
  if (!user || user.role !== 'student') return res.status(403).json({ error: 'Samo učenec.' });
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.grade !== user.grade) return res.status(403).json({ error: 'Napačen razred.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) return res.status(403).json({ error: 'Rok je potekel.' });

  if (!DATA.sessions[username]) DATA.sessions[username] = {};
  if (!DATA.sessions[username][chapterId]) DATA.sessions[username][chapterId] = createEmptySession();
  const sess = DATA.sessions[username][chapterId];
  if (sess.finished) return res.json({ finished: true, correct: sess.correct, attempts: sess.attempts, level: sess.progression.level });

  const level = sess.progression.level;
  const grade = ch.grade;
  const topicText = chapterTopicText(ch);
  const topicLower = topicText.toLowerCase();
  const isGeometry = topicLower.includes('geometr') || topicLower.includes('pitagor') || topicLower.includes('krog') || topicLower.includes('kot') || topicLower.includes('trikot') || topicLower.includes('lik') || topicLower.includes('telo') || topicLower.includes('koordinat') || topicLower.includes('obseg') || topicLower.includes('ploščin');

  const strictRules = strictLevelRules(grade, topicText);
  const levelDesc = strictRules[level] || strictRules[3];
  const topicRules = getTopicRules(topicText);

  if (!DATA.recentTasks[username]) DATA.recentTasks[username] = {};
  if (!DATA.recentTasks[username][chapterId]) DATA.recentTasks[username][chapterId] = [];
  const recent = DATA.recentTasks[username][chapterId];
  const recentList = recent.slice(-15).map((t, i) => `${i + 1}. ${t.question}`).join('\n');
  const recentNumbers = recent.slice(-10).flatMap(t => extractNumbers(t.question));
  const recentNumsList = recentNumbers.length ? Array.from(new Set(recentNumbers.map(n => n.toFixed(2)))).join(', ') : '(še ni bilo nalog)';

  let lastFailedNotice = '';
  if (sess.lastFailedTask) lastFailedNotice = `\n⚠️ PREJŠNJA NALOGA JE BILA NEUSPEŠNO GENERIRANA:\n"${sess.lastFailedTask}"\nNE PONAVLJAJ te naloge.`;

  const studentProfile = buildStudentProfile(username, chapterId);

  const curriculum = curriculumForGrade(grade);
  const curriculumText = curriculum.topics.map((t, i) => `  ${i + 1}. ${t}`).join('\n');
  const examplesText = curriculum.examples.map((e, i) => `  ${i + 1}. ${e}`).join('\n');

  let sketchInstruction = '';
  if (isGeometry) {
    sketchInstruction = `\n⚠️ SKICA (JSON objekt v polju "sketch"):\n- Možni tipi: right_triangle, triangle, rectangle, square, circle, angle.\n- Če skica ni smiselna, vrni "sketch": null.\n- STROGO: Podatki so lahko SAMO na enem mestu (besedilo ALI skica).\n- Trikotnik: če so vse stranice enake, besedilo MORA navesti "enakostranični trikotnik".`;
  } else {
    sketchInstruction = `- Za to temo skica ni potrebna. Vrni "sketch": null.`;
  }

  let systemMessage = `Si matematični tutor za slovenske osnovnošolce. Generiraš natanko eno matematično nalogo. Vrni izključno JSON objekt.

RAZRED: ${grade}
TEMA: "${topicText}"

📖 UČNI NAČRT ZA ${curriculum.title}:
${curriculumText}

📝 PRIMERI NALOG IZ TEGA UČNEGA NAČRTA (za vzor, ne kopiraj):
${examplesText}

Naloga MORA biti izključno iz zgoraj navedenega učnega načrta in v slogu primerov. NE uporabljaj konceptov, ki niso navedeni zgoraj.`;

  if (topicRules && topicRules[level] && topicRules[level].forbidden && topicRules[level].forbidden.length) {
    systemMessage += `\n\n🚫 PREPOVEDANO NA STOPNJI ${level}: ${topicRules[level].forbidden.join(', ')}\nNamig: ${topicRules[level].note || ''}`;
  } else if (topicRules && topicRules[level] && topicRules[level].note) {
    systemMessage += `\n\n📌 PRAVILO STOPNJE ${level}: ${topicRules[level].note}`;
  }

  const internalPrompt = (ch.llmPrompt && String(ch.llmPrompt).trim() !== '') ? String(ch.llmPrompt).trim() : (ch.instructions && String(ch.instructions).trim() !== '' ? String(ch.instructions).trim() : '');
  if (internalPrompt) systemMessage += `\n\n⚠️ UKAZ UČITELJA:\n${internalPrompt}`;

  systemMessage += `\n\n📊 PROFIL UČENCA:\n${studentProfile}`;

  let prompt = `Tema: "${topicText}"
Razred: ${grade}
STOPNJA: ${level}/3 – ${levelDesc}
Kategorija: ${ch.category === 'domaca' ? 'domača naloga' : 'utrjevanje'}

${sketchInstruction}

⚠️ KORAKI: V "steps_required" vrni seznam korakov (stopnja 1: max 1, stopnja 2: max 2, stopnja 3: max 3).

⚠️ VEČ ODGOVOROV: "answers" kot seznam objektov z "label", "value", "latex".

⚠️ RAZNOLIKOST: Naloga mora biti različna od prejšnjih. Prepovedano je uporabiti ista števila.

PREJŠNJE NALOGE:
${recentList || '(še ni bilo nalog)'}

ŠTEVILA, KI SO BILA ŽE UPORABLJENA: ${recentNumsList}
${lastFailedNotice}

Vrni JSON:
{
  "question": "besedilo naloge",
  "answers": [{"label":"Odgovor","value":0.75,"latex":"\\\\frac{3}{4}"}],
  "answer": 0.75,
  "answer_latex": "\\\\frac{3}{4}",
  "steps_required": ["korak 1"],
  "sketch": null
}`;

  if (isRetry && sess.currentTask) prompt += `\n\nUčenec je prejšnjo nalogo rešil NAPAČNO. Generiraj podobno nalogo iste stopnje z drugačnimi števili.`;

  try {
    let finalData = null;
    let lastRejectReason = '';
    for (let attempt = 1; attempt <= 6; attempt++) {
      const messages = [{ role: 'system', content: systemMessage }, { role: 'user', content: prompt }];
      const response = await callAI(messages);
      const data = JSON.parse(response.choices[0].message.content);
      if (typeof data.question !== 'string' || data.answer === undefined) { prompt += `\n\nOPOZORILO: Neveljavna struktura.`; continue; }
      let answersArr = [];
      if (Array.isArray(data.answers) && data.answers.length) {
        answersArr = data.answers.map(a => ({ label: String(a.label || 'Odgovor'), value: typeof a.value === 'number' ? a.value : parseNumberString(a.value), latex: normalizeLatex(a.latex || String(a.value)) })).filter(a => !isNaN(a.value));
      }
      if (!answersArr.length) {
        const ansNum = typeof data.answer === 'number' ? data.answer : parseNumberString(data.answer);
        if (isNaN(ansNum)) { prompt += `\n\nOPOZORILO: Odgovor ni število.`; continue; }
        answersArr = [{ label: 'Odgovor', value: ansNum, latex: normalizeLatex(data.answer_latex || String(data.answer)) }];
      }
      const questionSanitized = normalizeLatex(data.question);
      const sketch = data.sketch || null;
      const stepsRequired = Array.isArray(data.steps_required) ? data.steps_required : [];
      if (!taskTypeAllowed(questionSanitized, topicText)) { lastRejectReason = 'Napačen tip naloge.'; prompt += `\n\nOPOZORILO: Napačen tip.`; continue; }
      const topicCheck = validateTopicForLevel(questionSanitized, level, topicRules);
      if (!topicCheck.ok) { lastRejectReason = topicCheck.reason; prompt += `\n\nOPOZORILO: ${topicCheck.reason}`; continue; }
      const stepsCheck = validateStepsRequired(level, stepsRequired);
      if (!stepsCheck.ok) { lastRejectReason = stepsCheck.reason; prompt += `\n\nOPOZORILO: ${stepsCheck.reason}`; continue; }
      const sketchCheck = validateSketch(questionSanitized, sketch);
      if (!sketchCheck.ok) { lastRejectReason = sketchCheck.reason; prompt += `\n\nOPOZORILO: ${sketchCheck.reason}`; continue; }
      if (isTooSimilar({ question: questionSanitized }, recent.slice(-10))) { lastRejectReason = 'Preveč podobna.'; prompt += `\n\nOPOZORILO: Preveč podobna.`; continue; }
      finalData = { question: questionSanitized, answer: answersArr[0].value, answerRaw: answersArr[0].latex, answers: answersArr, sketch, stepsRequired };
      break;
    }
    if (!finalData) {
      sess.lastFailedTask = prompt.slice(-400);
      await saveData();
      return res.status(500).json({ error: 'Naloge ni bilo mogoče generirati.' + (lastRejectReason ? ' Razlog: ' + lastRejectReason : '') + ' Poskusi znova.' });
    }
    sess.currentTask = { question: finalData.question, answer: finalData.answer, answerRaw: finalData.answerRaw, answers: finalData.answers, sketch: finalData.sketch, stepsRequired: finalData.stepsRequired, level };
    sess.awaitingNext = false;
    sess.lastFailedTask = null;
    recent.push({ question: finalData.question, answer: finalData.answer });
    if (recent.length > 30) recent.splice(0, recent.length - 30);
    await saveData();
    res.json({ question: finalData.question, answers: finalData.answers, sketch: finalData.sketch, level, correct: sess.correct, target: 5, grade, progression: sess.progression, requiredInLevel: requiredInLevel(level) });
  } catch (err) {
    console.error('Groq napaka:', err.message);
    const st = err.status || (err.response && err.response.status);
    let msg = 'Napaka pri generiranju.';
    if (st === 429) msg = 'Preveč zahtev. Počakaj minuto.';
    else if (st === 401) msg = 'Neveljaven API ključ.';
    else if (st === 404) msg = 'Model ni dosegljiv.';
    else msg = 'Napaka: ' + (err.message || 'neznana');
    res.status(500).json({ error: msg });
  }
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
  if (DATA.sessions[username]) Object.keys(DATA.sessions[username]).forEach(cid => { if (DATA.sessions[username][cid].currentTask && !DATA.sessions[username][cid].finished) chapterId = cid; });
  if (!chapterId) return res.status(400).json({ error: 'Ni aktivne naloge.' });
  const sess = DATA.sessions[username][chapterId];
  if (sess.awaitingNext) return res.status(400).json({ error: 'Najprej klikni gumb.' });
  const ch = DATA.chapters.find(c => c.id === chapterId);
  if (!ch) return res.status(404).json({ error: 'Poglavje ne obstaja.' });
  if (ch.category === 'domaca' && ch.deadline && Date.now() > new Date(ch.deadline).getTime()) { sess.finished = true; saveData(); return res.status(403).json({ error: 'Rok je potekel.' }); }

  const expected = sess.currentTask.answers && sess.currentTask.answers.length ? sess.currentTask.answers : [{ label: 'Odgovor', value: sess.currentTask.answer, latex: sess.currentTask.answerRaw || String(sess.currentTask.answer) }];
  let allCorrect = true;
  const perAnswer = [];
  let aiCalls = 0;
  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const rawUser = (Array.isArray(userAnswers) && userAnswers[i] !== undefined) ? userAnswers[i] : '';
    let ok = false;
    const userNum = parseNumberString(rawUser);
    if (!isNaN(userNum)) ok = numbersEqual(userNum, exp.value, 1e-9);
    else if (String(rawUser).trim() !== '') {
      aiCalls++;
      try {
        const prompt = `Si matematični tutor. Učenec je odgovoril na nalogo:\nNALOGA: ${sess.currentTask.question}\nPODVPRAŠANJE: "${exp.label}"\nPRAVILEN ODGOVOR: ${exp.value} (zapis: ${exp.latex})\nUČENČEV ODGOVOR: "${rawUser}"\n\nUgotovi, ali je učenčev odgovor pravilen.\nVrni JSON: { "is_correct": true/false }`;
        const response = await callAI([{ role: 'user', content: prompt }]);
        const aiEval = JSON.parse(response.choices[0].message.content);
        ok = !!aiEval.is_correct;
      } catch (e) { ok = false; }
    }
    if (!ok) allCorrect = false;
    perAnswer.push({ label: exp.label, ok });
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
    else st.errors.push({ question: sess.currentTask.question, userAns: Array.isArray(userAnswers) ? userAnswers.join(' | ') : String(userAnswers), correctAns: expected.map(e => e.latex).join(' | '), count: 1, level: sess.currentTask.level });
    if (st.errors.length > 100) st.errors = st.errors.slice(-100);
  }
  const t = sess.currentTask.type || 'llm';
  if (!st.byType[t]) st.byType[t] = { total: 0, correct: 0 };
  st.byType[t].total++;
  if (allCorrect) st.byType[t].correct++;
  st.history.push({ ts: Date.now(), question: sess.currentTask.question, ok: allCorrect, attempt: sess.attempts, level: sess.currentTask.level, aiCalls });
  if (st.history.length > 300) st.history = st.history.slice(-300);
  await saveData();

  if (allCorrect) {
    sess.correct++;
    sess.progression.correctInLevel++;
    const req = requiredInLevel(sess.progression.level);
    if (sess.progression.correctInLevel >= req) {
      if (sess.progression.level < 3) { sess.progression.level++; sess.progression.correctInLevel = 0; }
      else { sess.finished = true; }
    }
    sess.awaitingNext = false;
    await saveData();
    if (sess.finished) return res.json({ correct: true, finished: true, correctCount: sess.correct, attempts: sess.attempts, message: 'Bravo! Rešil si vse naloge na vseh treh stopnjah. 🎉', progression: sess.progression, requiredInLevel: requiredInLevel(sess.progression.level), aiCalls });
    return res.json({ correct: true, finished: false, correctCount: sess.correct, target: 5, nextLevel: sess.progression.level, progression: sess.progression, requiredInLevel: requiredInLevel(sess.progression.level), message: 'Odlično! Pravilno.', aiCalls });
  } else {
    sess.lastFailedTask = sess.currentTask.question;
    let steps = [];
    try {
      const correctText = expected.map(e => e.label + ': ' + e.latex).join('; ');
      const prompt = `Si izkušen, prijazen učitelj matematike v slovenski osnovni šoli. Učenec (${ch.grade}. razred) je napačno rešil nalogo in potrebuje KRATKO razlago.\n\nNALOGA: ${sess.currentTask.question}\nPRAVILNI ODGOVORI: ${correctText}\nUČENČEVI ODGOVORI: ${Array.isArray(userAnswers) ? userAnswers.map((a, i) => (expected[i] ? expected[i].label + '=' + a : a)).join('; ') : userAnswers}\n\nRAZLAGA: največ 3 alineje, zelo preprosto, v slovenščini, z LaTeX. Zadnja alineja: "Rezultat: <latex>".\nVrni JSON: { "steps": ["korak 1", "korak 2", "Rezultat: ..."] }`;
      const response = await callAI([{ role: 'user', content: prompt }]);
      const data = JSON.parse(response.choices[0].message.content);
      steps = Array.isArray(data.steps) ? data.steps.map(normalizeLatex) : [];
    } catch (e) { steps = expected.map(e => 'Rezultat: ' + e.latex); }
    sess.awaitingNext = true;
    await saveData();
    return res.json({ correct: false, finished: false, correctCount: sess.correct, target: 5, correctAnswers: expected.map(e => ({ label: e.label, value: e.value, latex: e.latex })), perAnswer, steps, progression: sess.progression, requiredInLevel: requiredInLevel(sess.progression.level), message: 'Ni pravilno. Preberi kratko razlago in nato klikni "Poskusi s podobno nalogo".', aiCalls });
  }
});

app.post('/api/reset-session', async (req, res) => {
  const { username, chapterId } = req.body || {};
  if (!username || !chapterId) return res.status(400).json({ error: 'Manjka username ali chapterId.' });
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
    const byType = Object.keys(s.byType || {}).map(t => ({ type: t, total: s.byType[t].total, correct: s.byType[t].correct, pct: s.byType[t].total ? Math.round(100 * s.byType[t].correct / s.byType[t].total) : 0 }));
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
  perStudent.forEach(p => { (p.topErrors || []).forEach(e => { if (!errorMap[e.question]) errorMap[e.question] = { question: e.question, correctAns: e.correctAns, count: 0, levels: new Set() }; errorMap[e.question].count += e.count; if (e.level) errorMap[e.question].levels.add(e.level); }); });
  const topClassErrors = Object.values(errorMap).sort((a, b) => b.count - a.count).slice(0, 10).map(e => ({ ...e, levels: Array.from(e.levels) }));
  const classByType = {};
  perStudent.forEach(p => { Object.keys(p.byType || {}).forEach(t => { if (!classByType[t]) classByType[t] = { total: 0, correct: 0 }; classByType[t].total += p.byType[t].total; classByType[t].correct += p.byType[t].correct; }); });
  let textAnalysis = null;
  try {
    const prompt = `Si učitelj matematike. Napiši kratko pedagoško analizo v slovenščini.\nSKLOP: "${ch.title}" (${ch.grade}. razred, ${ch.category})\nPoskusi: ${total}, pravilnih: ${correct} (${pct}%)\nAktivnih: ${perStudent.length}\nNapake: ${JSON.stringify(topClassErrors.map(e => ({ q: e.question, n: e.count })))}\nPo tipu: ${JSON.stringify(classByType)}\nNapiši 4–6 stavkov. Vrni JSON: {"text":"..."}`;
    const response = await callAI([{ role: 'user', content: prompt }]);
    const data = JSON.parse(response.choices[0].message.content);
    textAnalysis = data.text || null;
  } catch (e) { console.warn('Analiza ni uspela:', e.message); }
  const analysis = { generatedAt: Date.now(), text: textAnalysis, chapterId, title: ch.title, grade: ch.grade, category: ch.category, deadline: ch.deadline, totalAttempts: total, correct, pct, activeStudents: perStudent.length, perStudent, classByType, topClassErrors };
  DATA.analyses[chapterId] = analysis; DATA.autoAnalyzed[chapterId] = true;
  await saveData();
  res.json(analysis);
});

app.get('/api/expired-chapters', requireAdmin, (req, res) => {
  const now = Date.now();
  const expired = DATA.chapters.filter(c => c.category === 'domaca' && c.deadline && new Date(c.deadline).getTime() < now).map(c => ({ id: c.id, title: c.title, grade: c.grade, deadline: c.deadline, analyzed: !!DATA.analyses[c.id] }));
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
    if (!ch) return; if (!s.total) return;
    const pct = Math.round(100 * s.correct / s.total);
    const byType = Object.keys(s.byType || {}).map(t => ({ type: t, total: s.byType[t].total, correct: s.byType[t].correct, pct: s.byType[t].total ? Math.round(100 * s.byType[t].correct / s.byType[t].total) : 0 }));
    const topErrors = (s.errors || []).slice().sort((a, b) => b.count - a.count).slice(0, 10);
    const recentHistory = (s.history || []).slice(-20).reverse();
    chapters.push({ chapterId: chId, title: ch.title, desc: ch.desc || '', grade: ch.grade, category: ch.category, deadline: ch.deadline || null, total: s.total, correct: s.correct, correctFirst: s.correctFirst, wrong: s.wrong, pct, byType, topErrors, recentHistory });
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
  console.log(`   🤖 AI: Groq (${GROQ_MODEL})`);
});
connectDB().then(() => { console.log('✅ Baza pripravljena.'); }).catch(err => { console.error('❌ Baza ni uspela:', err.message); });
