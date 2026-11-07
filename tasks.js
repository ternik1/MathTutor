// tasks.js
// Kurirana knjižnica matematičnih nalog.
// Vsaka naloga ima programsko izračunan pravilen odgovor in razlago po korakih.

function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }
function lcm(a, b) { return Math.abs(a * b) / gcd(a, b); }
function simplify(n, d) { const g = gcd(n, d); return { num: n / g, den: d / g }; }
function frac(n, d) { return d === 1 ? String(n) : `\\frac{${n}}{${d}}`; }
function fmt(n) {
  if (typeof n !== 'number' || isNaN(n)) return String(n);
  if (Number.isInteger(n)) return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return String(n).replace('.', ',');
}

const NAMES = ['Ana', 'Miha', 'Luka', 'Neja', 'Žiga', 'Eva', 'Nik', 'Sara', 'Jan', 'Zoja', 'Tjaša', 'Matic', 'Lana', 'Tim', 'Nika', 'Rok', 'Lea', 'Pia'];
const ITEMS = ['jabolk', 'hrušk', 'bonbonov', 'zvezdic', 'svinčnikov', 'kock', 'gumbov', 'knjig', 'piškotov'];

function pickNames() {
  const i = ri(0, NAMES.length - 1);
  let j = ri(0, NAMES.length - 1);
  while (j === i) j = ri(0, NAMES.length - 1);
  return [NAMES[i], NAMES[j]];
}

/* ============================================================
   6. RAZRED
   ============================================================ */

function gen_sestevanje_odstevanje_6(level) {
  if (level === 1) {
    const a = ri(2, 9);
    const b = ri(2, 9);
    if (Math.random() < 0.5 && a + b <= 10) {
      return { question: `Izračunaj: ${a} + ${b}`,
        answers: [{ label: 'Rezultat', value: a + b, latex: String(a + b) }],
        steps: [`Seštej ${a} in ${b}.`, `Rezultat: ${a + b}.`] };
    }
    const big = Math.max(a, b), small = Math.min(a, b);
    return { question: `Izračunaj: ${big} − ${small}`,
      answers: [{ label: 'Rezultat', value: big - small, latex: String(big - small) }],
      steps: [`Odštej ${small} od ${big}.`, `Rezultat: ${big - small}.`] };
  }
  if (level === 2) {
    const a = ri(15, 89);
    const b = ri(15, 89);
    if (Math.random() < 0.5) {
      return { question: `Izračunaj: ${a} + ${b}`,
        answers: [{ label: 'Rezultat', value: a + b, latex: String(a + b) }],
        steps: [`Seštej enice: ${a%10} + ${b%10}.`, `Seštej desetice: ${Math.floor(a/10)} + ${Math.floor(b/10)}.`, `${a} + ${b} = ${a + b}.`] };
    }
    const big = Math.max(a, b), small = Math.min(a, b);
    return { question: `Izračunaj: ${big} − ${small}`,
      answers: [{ label: 'Rezultat', value: big - small, latex: String(big - small) }],
      steps: [`Odštej enice in desetice.`, `${big} − ${small} = ${big - small}.`] };
  }
  const [n1] = pickNames();
  const start = ri(150, 600);
  const spent = ri(50, 150);
  const got = ri(80, 200);
  const ans = start - spent + got;
  return { question: `${n1} je imel ${fmt(start)} €. Kupil je igračo za ${fmt(spent)} € in od babice prejel ${fmt(got)} €. Koliko evrov ima zdaj?`,
    answers: [{ label: 'Rezultat', value: ans, latex: String(ans) + ' €' }],
    steps: [`Najprej odštejemo nakup: ${start} − ${spent} = ${start - spent}.`, `Nato prištejemo darilo: ${start - spent} + ${got} = ${ans}.`, `Odgovor: ${ans} €.`] };
}

function gen_mnozenje_deljenje_6(level) {
  if (level === 1) {
    const a = ri(2, 9), b = ri(2, 9);
    if (Math.random() < 0.5) {
      return { question: `Izračunaj: ${a} · ${b}`,
        answers: [{ label: 'Rezultat', value: a * b, latex: String(a * b) }],
        steps: [`Zmnoži ${a} in ${b}.`, `Rezultat: ${a * b}.`] };
    }
    const product = a * b;
    return { question: `Izračunaj: ${product} : ${a}`,
      answers: [{ label: 'Rezultat', value: b, latex: String(b) }],
      steps: [`Vprašaj se: ${a} krat koliko je ${product}?`, `Ker je ${a} · ${b} = ${product}, je rezultat ${b}.`] };
  }
  if (level === 2) {
    const a = ri(2, 12), b = ri(2, 9), c = ri(2, 20);
    if (Math.random() < 0.5) {
      return { question: `Izračunaj: ${a} · ${b} + ${c}`,
        answers: [{ label: 'Rezultat', value: a * b + c, latex: String(a * b + c) }],
        steps: [`Najprej množenje: ${a} · ${b} = ${a * b}.`, `Nato prištej: ${a * b} + ${c} = ${a * b + c}.`] };
    }
    const diff = a * b - c;
    if (diff < 0) return gen_mnozenje_deljenje_6(2);
    return { question: `Izračunaj: ${a} · ${b} − ${c}`,
      answers: [{ label: 'Rezultat', value: diff, latex: String(diff) }],
      steps: [`Najprej množenje: ${a} · ${b} = ${a * b}.`, `Nato odštej: ${a * b} − ${c} = ${diff}.`] };
  }
  const [n1] = pickNames();
  const price = ri(2, 15);
  const qty = ri(3, 8);
  return { question: `${n1} kupi ${qty} zvezkov. Vsak stane ${price} €. Koliko plača skupaj?`,
    answers: [{ label: 'Skupaj', value: price * qty, latex: String(price * qty) + ' €' }],
    steps: [`Zmnožimo število zvezkov s ceno: ${qty} · ${price}.`, `${qty} · ${price} = ${price * qty}.`, `Odgovor: ${price * qty} €.`] };
}

function gen_ulomki_osnove_6(level) {
  if (level === 1) {
    const den = pick([2, 3, 4, 5]);
    const num = ri(1, den - 1);
    const total = den * ri(2, 6);
    const part = (total / den) * num;
    return { question: `Koliko je ${frac(num, den)} od ${total}?`,
      answers: [{ label: 'Rezultat', value: part, latex: String(part) }],
      steps: [`En ${den}-ti del od ${total} je ${total} : ${den} = ${total / den}.`, `Vzamemo ${num} takih delov: ${num} · ${total / den} = ${part}.`] };
  }
  if (level === 2) {
    const den = pick([3, 4, 5, 6, 8, 10]);
    let a = ri(1, den - 1), b = ri(1, den - 1);
    while (a === b) b = ri(1, den - 1);
    const bigger = Math.max(a, b), smaller = Math.min(a, b);
    return { question: `Kateri ulomek je večji: ${frac(a, den)} ali ${frac(b, den)}? Vpiši števec večjega ulomka.`,
      answers: [{ label: 'Števec večjega', value: bigger, latex: String(bigger) }],
      steps: [`Ulomka imata enak imenovalec (${den}), zato je večji tisti z večjim števcem.`, `Ker je ${bigger} > ${smaller}, je večji ulomek ${frac(bigger, den)}.`] };
  }
  const den = pick([4, 5, 6, 8, 10]);
  const a = ri(1, den - 2);
  const b = ri(1, den - a - 1);
  const num = a + b;
  const s = simplify(num, den);
  return { question: `Izračunaj: ${frac(a, den)} + ${frac(b, den)}`,
    answers: [{ label: 'Vsota', value: s.num / s.den, latex: frac(s.num, s.den) }],
    steps: [`Enak imenovalec → seštejemo števce: ${a} + ${b} = ${num}.`, `Rezultat: ${frac(num, den)}.`,
      num === den ? `Ulomek je enak 1.` : (s.den !== den ? `Okrajšamo: ${frac(s.num, s.den)}.` : '')].filter(Boolean) };
}

function gen_decimalna_6(level) {
  if (level === 1) {
    const a = ri(1, 9) + ri(1, 9) / 10;
    const b = ri(1, 9) + ri(1, 9) / 10;
    const ans = Math.round((a + b) * 100) / 100;
    return { question: `Izračunaj: ${fmt(a)} + ${fmt(b)}`,
      answers: [{ label: 'Rezultat', value: ans, latex: fmt(ans) }],
      steps: [`Seštej enice in desetice.`, `${fmt(a)} + ${fmt(b)} = ${fmt(ans)}.`] };
  }
  if (level === 2) {
    const big = ri(3, 9) + ri(2, 9) / 10;
    const small = ri(1, 2) + ri(1, 8) / 10;
    const ans = Math.round((big - small) * 100) / 100;
    return { question: `Izračunaj: ${fmt(big)} − ${fmt(small)}`,
      answers: [{ label: 'Rezultat', value: ans, latex: fmt(ans) }],
      steps: [`Odštej enice in desetice.`, `${fmt(big)} − ${fmt(small)} = ${fmt(ans)}.`] };
  }
  const [n1] = pickNames();
  const a = Math.round((ri(10, 40) + ri(1, 9) / 10) * 10) / 10;
  const b = Math.round((ri(1, 30) + ri(1, 9) / 10) * 10) / 10;
  const ans = Math.round((a + b) * 10) / 10;
  return { question: `${n1} je kupil ${fmt(a)} kg jabolk in ${fmt(b)} kg hrušk. Koliko sadja je kupil skupaj?`,
    answers: [{ label: 'Skupaj', value: ans, latex: fmt(ans) + ' kg' }],
    steps: [`Seštej količini: ${fmt(a)} + ${fmt(b)}.`, `Rezultat: ${fmt(ans)} kg.`] };
}

function gen_obseg_ploscina_6(level) {
  if (level === 1) {
    const a = ri(3, 12), b = ri(3, 12);
    const o = 2 * (a + b);
    return { question: `Pravokotnik ima stranici a = ${a} cm in b = ${b} cm. Izračunaj obseg.`,
      answers: [{ label: 'Obseg', value: o, latex: String(o) + ' cm' }],
      steps: [`Formula: o = 2 · (a + b).`, `o = 2 · (${a} + ${b}) = 2 · ${a + b} = ${o} cm.`],
      sketch: { type: 'rectangle', data: { a, b, unit: 'cm' } } };
  }
  if (level === 2) {
    const a = ri(3, 15), b = ri(3, 15);
    const p = a * b;
    return { question: `Pravokotnik ima stranici a = ${a} cm in b = ${b} cm. Izračunaj ploščino.`,
      answers: [{ label: 'Ploščina', value: p, latex: String(p) + ' cm²' }],
      steps: [`Formula: p = a · b.`, `p = ${a} · ${b} = ${p} cm².`],
      sketch: { type: 'rectangle', data: { a, b, unit: 'cm' } } };
  }
  const a = ri(4, 12);
  const p = a * a;
  return { question: `Kvadratno dvorišče ima stranico a = ${a} m. Izračunaj ploščino dvorišča.`,
    answers: [{ label: 'Ploščina', value: p, latex: String(p) + ' m²' }],
    steps: [`Formula: p = a · a.`, `p = ${a} · ${a} = ${p} m².`],
    sketch: { type: 'square', data: { a, unit: 'm' } } };
}

function gen_merjenje_6(level) {
  if (level === 1) {
    const km = ri(2, 15);
    return { question: `Pretvori ${km} km v metre.`,
      answers: [{ label: 'Metri', value: km * 1000, latex: fmt(km * 1000) + ' m' }],
      steps: [`1 km = 1000 m.`, `${km} km = ${km} · 1000 = ${fmt(km * 1000)} m.`] };
  }
  if (level === 2) {
    const kg = ri(2, 15);
    return { question: `Pretvori ${kg} kg v grame.`,
      answers: [{ label: 'Grami', value: kg * 1000, latex: fmt(kg * 1000) + ' g' }],
      steps: [`1 kg = 1000 g.`, `${kg} kg = ${kg} · 1000 = ${fmt(kg * 1000)} g.`] };
  }
  const t = ri(2, 9);
  return { question: `Tovornjak nosi ${t} t tovora. Koliko kilogramov je to?`,
    answers: [{ label: 'Kilogrami', value: t * 1000, latex: fmt(t * 1000) + ' kg' }],
    steps: [`1 t = 1000 kg.`, `${t} t = ${t} · 1000 = ${fmt(t * 1000)} kg.`] };
}

/* ============================================================
   7. RAZRED
   ============================================================ */

function primeFactorize(n) {
  const f = []; let x = n;
  for (let d = 2; d * d <= x; d++) while (x % d === 0) { f.push(d); x /= d; }
  if (x > 1) f.push(x);
  return f.join(' · ');
}

function gen_deljivost_7(level) {
  if (level === 1) {
    const a = ri(10, 60), b = ri(10, 60);
    const g = gcd(a, b);
    return { question: `Izračunaj največji skupni delitelj (NSD) števil ${a} in ${b}.`,
      answers: [{ label: 'NSD', value: g, latex: String(g) }],
      steps: [`Razstavimo: ${a} = ${primeFactorize(a)}.`, `${b} = ${primeFactorize(b)}.`, `Skupni prafaktorji: NSD = ${g}.`] };
  }
  if (level === 2) {
    const a = ri(2, 12), b = ri(2, 12);
    const l = lcm(a, b);
    return { question: `Izračunaj najmanjši skupni večkratnik (NSV) števil ${a} in ${b}.`,
      answers: [{ label: 'NSV', value: l, latex: String(l) }],
      steps: [`NSV(a, b) = a · b / NSD(a, b).`, `NSD(${a}, ${b}) = ${gcd(a, b)}.`, `NSV = ${a} · ${b} / ${gcd(a, b)} = ${l}.`] };
  }
  const a = ri(3, 8), b = ri(3, 8);
  const g = gcd(a, b);
  return { question: `Imamo ${a * 5} rdečih in ${b * 5} modrih kroglic. Želimo jih razdeliti v enake skupine tako, da ima vsaka skupina enako število rdečih in enako število modrih kroglic. Koliko skupin lahko naredimo največ?`,
    answers: [{ label: 'Največ skupin', value: g, latex: String(g) }],
    steps: [`Iščemo NSD(${a * 5}, ${b * 5}).`, `NSD(${a * 5}, ${b * 5}) = ${g}.`, `Odgovor: največ ${g} skupin.`] };
}

function gen_ulomki_sestevanje_7(level) {
  if (level === 1) {
    const den = pick([4, 5, 6, 8, 10]);
    let a = ri(1, den - 2), b = ri(1, den - a - 1);
    const num = a + b;
    const s = simplify(num, den);
    return { question: `Izračunaj: ${frac(a, den)} + ${frac(b, den)}`,
      answers: [{ label: 'Vsota', value: s.num / s.den, latex: frac(s.num, s.den) }],
      steps: [`Enak imenovalec → seštejemo števce: ${a} + ${b} = ${num}.`, `Rezultat: ${frac(num, den)}.`, s.den !== den ? `Okrajšamo: ${frac(s.num, s.den)}.` : ''].filter(Boolean) };
  }
  const pairs = [[2, 4], [2, 6], [3, 6], [2, 8], [4, 8], [3, 9], [2, 10], [5, 10]];
  const p = pick(pairs);
  const [d1, d2] = p;
  const common = d2;
  if (level === 2) {
    const a = ri(1, d1 - 1), b = ri(1, d2 - 1);
    const num = a * (common / d1) + b;
    const s = simplify(num, common);
    return { question: `Izračunaj: ${frac(a, d1)} + ${frac(b, d2)}`,
      answers: [{ label: 'Vsota', value: s.num / s.den, latex: frac(s.num, s.den) }],
      steps: [`Skupni imenovalec je ${common}.`, `${frac(a, d1)} = ${frac(a * (common / d1), common)}.`, `${frac(a * (common / d1), common)} + ${frac(b, common)} = ${frac(num, common)}.`, s.den !== common ? `Okrajšamo: ${frac(s.num, s.den)}.` : ''].filter(Boolean) };
  }
  let a = ri(1, d1 - 1), b = ri(1, d2 - 1);
  if (a * (common / d1) <= b) return gen_ulomki_sestevanje_7(3);
  const num = a * (common / d1) - b;
  const s = simplify(num, common);
  return { question: `Izračunaj: ${frac(a, d1)} − ${frac(b, d2)}`,
    answers: [{ label: 'Razlika', value: s.num / s.den, latex: frac(s.num, s.den) }],
    steps: [`Skupni imenovalec je ${common}.`, `${frac(a, d1)} = ${frac(a * (common / d1), common)}.`, `${frac(a * (common / d1), common)} − ${frac(b, common)} = ${frac(num, common)}.`, s.den !== common ? `Okrajšamo: ${frac(s.num, s.den)}.` : ''].filter(Boolean) };
}

function gen_ulomki_mnozenje_7(level) {
  if (level === 1) {
    const den = pick([3, 4, 5, 6]);
    const a = ri(1, den - 1);
    const n = ri(2, 5);
    const num = a * n;
    const s = simplify(num, den);
    return { question: `Izračunaj: ${frac(a, den)} · ${n}`,
      answers: [{ label: 'Rezultat', value: s.num / s.den, latex: frac(s.num, s.den) }],
      steps: [`Pomnoži števec z ${n}: ${a} · ${n} = ${num}.`, `Rezultat: ${frac(num, den)}.`, s.den !== den ? `Okrajšamo: ${frac(s.num, s.den)}.` : ''].filter(Boolean) };
  }
  if (level === 2) {
    const d1 = pick([2, 3, 4, 5]), d2 = pick([2, 3, 4, 5]);
    const a = ri(1, d1 - 1), b = ri(1, d2 - 1);
    const num = a * b, den = d1 * d2;
    const s = simplify(num, den);
    return { question: `Izračunaj: ${frac(a, d1)} · ${frac(b, d2)}`,
      answers: [{ label: 'Produkt', value: s.num / s.den, latex: frac(s.num, s.den) }],
      steps: [`Zmnoži števce in imenovalce: ${a}·${b} = ${num}, ${d1}·${d2} = ${den}.`, `Rezultat: ${frac(num, den)}.`, s.den !== den ? `Okrajšamo: ${frac(s.num, s.den)}.` : ''].filter(Boolean) };
  }
  const d1 = pick([2, 3, 4, 5]), d2 = pick([2, 3, 4, 5]);
  const a = ri(1, d1 - 1), b = ri(1, d2 - 1);
  const num = a * d2, den = d1 * b;
  const s = simplify(num, den);
  return { question: `Izračunaj: ${frac(a, d1)} : ${frac(b, d2)}`,
    answers: [{ label: 'Kvocient', value: s.num / s.den, latex: frac(s.num, s.den) }],
    steps: [`Deljenje z ulomkom = množenje z obratnim ulomkom.`, `${frac(a, d1)} : ${frac(b, d2)} = ${frac(a, d1)} · ${frac(d2, b)}.`, `= ${frac(num, den)}.`, s.den !== den ? `Okrajšamo: ${frac(s.num, s.den)}.` : ''].filter(Boolean) };
}

function gen_trikotnik_7(level) {
  if (level === 1) {
    let a, b, c;
    do { a = ri(3, 10); b = ri(3, 10); c = ri(3, 10); } while (a + b <= c || a + c <= b || b + c <= a);
    const o = a + b + c;
    return { question: `Trikotnik ima stranice a = ${a} cm, b = ${b} cm, c = ${c} cm. Izračunaj obseg.`,
      answers: [{ label: 'Obseg', value: o, latex: String(o) + ' cm' }],
      steps: [`Formula: o = a + b + c.`, `o = ${a} + ${b} + ${c} = ${o} cm.`],
      sketch: { type: 'triangle', data: { a, b, c, unit: 'cm' } } };
  }
  if (level === 2) {
    const a = ri(4, 14) * 2, v = ri(2, 10);
    const p = (a * v) / 2;
    return { question: `Trikotnik ima osnovnico a = ${a} cm in višino v = ${v} cm. Izračunaj ploščino.`,
      answers: [{ label: 'Ploščina', value: p, latex: String(p) + ' cm²' }],
      steps: [`Formula: p = (a · v) / 2.`, `p = (${a} · ${v}) / 2 = ${a * v} / 2 = ${p} cm².`] };
  }
  const a = ri(4, 14) * 2, v = ri(2, 10);
  const p = (a * v) / 2;
  const [n1] = pickNames();
  return { question: `${n1} ima trikotno znamenje z osnovnico a = ${a} cm in višino v = ${v} cm. Kolikšna je ploščina znamenja?`,
    answers: [{ label: 'Ploščina', value: p, latex: String(p) + ' cm²' }],
    steps: [`Ploščina trikotnika: p = (a · v) / 2.`, `p = (${a} · ${v}) / 2 = ${p} cm².`] };
}

function gen_odstotki_7(level) {
  if (level === 1) {
    const percent = pick([10, 20, 25, 50]);
    const base = pick([100, 200, 300, 400, 500, 1000]);
    const ans = (percent / 100) * base;
    return { question: `Koliko je ${percent} % od ${base}?`,
      answers: [{ label: 'Rezultat', value: ans, latex: String(ans) }],
      steps: [`${percent} % = ${percent}/100 = ${percent / 100}.`, `${percent / 100} · ${base} = ${ans}.`] };
  }
  if (level === 2) {
    const base = ri(20, 200);
    const percent = pick([5, 10, 15, 20, 25]);
    const ans = Math.round((percent / 100) * base * 100) / 100;
    return { question: `Koliko je ${percent} % od ${base}?`,
      answers: [{ label: 'Rezultat', value: ans, latex: fmt(ans) }],
      steps: [`${percent} % = ${percent}/100.`, `${percent}/100 · ${base} = ${fmt(ans)}.`] };
  }
  const price = pick([20, 30, 40, 50, 60, 80, 100]);
  const disc = pick([10, 20, 25, 50]);
  const newP = Math.round(price * (1 - disc / 100));
  return { question: `Izdelek stane ${price} €. Znižan je za ${disc} %. Koliko stane po znižanju?`,
    answers: [{ label: 'Nova cena', value: newP, latex: String(newP) + ' €' }],
    steps: [`Znižanje: ${disc} % od ${price} = ${fmt(disc / 100 * price)} €.`, `Nova cena: ${price} − ${fmt(disc / 100 * price)} = ${newP} €.`, `Hitreje: ${100 - disc} % od ${price} = ${newP} €.`] };
}

function gen_enacbe_7(level) {
  if (level === 1) {
    const a = ri(1, 20), x = ri(1, 20);
    return { question: `Reši enačbo: x + ${a} = ${x + a}`,
      answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
      steps: [`Obe strani odštejemo ${a}.`, `x = ${x + a} − ${a}.`, `x = ${x}.`] };
  }
  if (level === 2) {
    const a = ri(2, 9), x = ri(2, 10);
    return { question: `Reši enačbo: ${a}x = ${a * x}`,
      answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
      steps: [`Obe strani delimo z ${a}.`, `x = ${a * x} : ${a}.`, `x = ${x}.`] };
  }
  const a = ri(2, 6), x = ri(2, 10), b = ri(1, 15);
  return { question: `Reši enačbo: ${a}x + ${b} = ${a * x + b}`,
    answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
    steps: [`Odštejemo ${b}: ${a}x = ${a * x}.`, `Delimo z ${a}: x = ${x}.`] };
}

/* ============================================================
   8. RAZRED
   ============================================================ */

function gen_cela_stevila_8(level) {
  if (level === 1) {
    const a = ri(1, 15), b = ri(1, 15);
    if (Math.random() < 0.5) {
      return { question: `Izračunaj: (−${a}) + (−${b})`,
        answers: [{ label: 'Rezultat', value: -(a + b), latex: `−${a + b}` }],
        steps: [`Oba sta negativna → seštejemo absolutni vrednosti in obdržimo negativni predznak.`, `−(${a} + ${b}) = −${a + b}.`] };
    }
    const A = (Math.random() < 0.5 ? -1 : 1) * a;
    const B = (Math.random() < 0.5 ? -1 : 1) * b;
    if (A * B > 0) return gen_cela_stevila_8(1);
    const ans = A + B;
    return { question: `Izračunaj: ${A} + ${B < 0 ? `(${B})` : B}`,
      answers: [{ label: 'Rezultat', value: ans, latex: ans < 0 ? `−${Math.abs(ans)}` : String(ans) }],
      steps: [`Različna predznaka → odštejemo manjšo absolutno vrednost od večje.`, `|${A}| = ${Math.abs(A)}, |${B}| = ${Math.abs(B)}.`, `Predznak rezultata je predznak števila z večjo absolutno vrednostjo: ${ans}.`] };
  }
  if (level === 2) {
    const a = ri(2, 12), b = ri(2, 12);
    const sA = Math.random() < 0.5 ? -1 : 1;
    const sB = Math.random() < 0.5 ? -1 : 1;
    const A = sA * a, B = sB * b;
    return { question: `Izračunaj: ${A} · ${B < 0 ? `(${B})` : B}`,
      answers: [{ label: 'Rezultat', value: A * B, latex: A * B < 0 ? `−${Math.abs(A * B)}` : String(A * B) }],
      steps: [`Zmnoži absolutni vrednosti: ${a} · ${b} = ${a * b}.`, `Predznak: ${sA === sB ? 'enaka predznaka → pozitiven' : 'različna predznaka → negativen'}.`, `Rezultat: ${A * B}.`] };
  }
  const a = ri(2, 10), b = ri(2, 10), c = ri(1, 10);
  const ans = -a * b - c;
  return { question: `Izračunaj: (−${a}) · ${b} + (−${c})`,
    answers: [{ label: 'Rezultat', value: ans, latex: `−${Math.abs(ans)}` }],
    steps: [`Najprej množenje: (−${a}) · ${b} = −${a * b}.`, `Nato seštevanje: −${a * b} + (−${c}) = −${a * b + c}.`] };
}

function gen_potence_8(level) {
  if (level === 1) {
    const a = ri(2, 9);
    return { question: `Izračunaj: ${a}²`,
      answers: [{ label: 'Rezultat', value: a * a, latex: String(a * a) }],
      steps: [`${a}² pomeni ${a} · ${a}.`, `${a} · ${a} = ${a * a}.`] };
  }
  if (level === 2) {
    const a = pick([3, 4, 5, 6, 7, 8, 9, 10]);
    return { question: `Izračunaj: √${a * a}`,
      answers: [{ label: 'Rezultat', value: a, latex: String(a) }],
      steps: [`Iščemo število, katerega kvadrat je ${a * a}.`, `${a} · ${a} = ${a * a}.`, `Zato je √${a * a} = ${a}.`] };
  }
  const a = pick([2, 3, 4, 5]), b = pick([2, 3, 4]);
  const sum = a * a + b * b;
  return { question: `Izračunaj: ${a}² + ${b}²`,
    answers: [{ label: 'Rezultat', value: sum, latex: String(sum) }],
    steps: [`${a}² = ${a * a}, ${b}² = ${b * b}.`, `${a * a} + ${b * b} = ${sum}.`] };
}

function gen_izrazi_8(level) {
  if (level === 1) {
    const a = ri(2, 9), b = ri(2, 9), c = ri(1, 5);
    return { question: `Poenostavi izraz ${a}x + ${b}x + ${c}. Vpiši koeficient pri x.`,
      answers: [{ label: 'Koeficient pri x', value: a + b, latex: `${a + b}x + ${c}` }],
      steps: [`Združimo x-člene: ${a}x + ${b}x = ${a + b}x.`, `Rezultat: ${a + b}x + ${c}.`] };
  }
  if (level === 2) {
    const a = ri(2, 6), b = ri(1, 9), c = ri(2, 6), d = ri(1, 9);
    return { question: `Poenostavi: (${a}x + ${b}) + (${c}x + ${d}). Vpiši koeficient pri x.`,
      answers: [{ label: 'Koeficient pri x', value: a + c, latex: `${a + c}x + ${b + d}` }],
      steps: [`Odstranimo oklepaje: ${a}x + ${c}x + ${b} + ${d}.`, `x-členi: ${a + c}x.`, `Konstante: ${b + d}.`, `Rezultat: ${a + c}x + ${b + d}.`] };
  }
  const a = ri(2, 5), b = ri(1, 9), c = ri(1, 9);
  return { question: `Razširi izraz ${a}(${b}x + ${c}). Vpiši koeficient pri x.`,
    answers: [{ label: 'Koeficient pri x', value: a * b, latex: `${a * b}x + ${a * c}` }],
    steps: [`Zmnožimo ${a} z vsakim členom v oklepaju.`, `${a} · ${b}x = ${a * b}x.`, `${a} · ${c} = ${a * c}.`, `Rezultat: ${a * b}x + ${a * c}.`] };
}

function gen_enacbe_8(level) {
  if (level === 1) {
    const a = ri(2, 8), x = ri(1, 10), b = ri(1, 15);
    return { question: `Reši: ${a}x + ${b} = ${a * x + b}`,
      answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
      steps: [`Odštej ${b}: ${a}x = ${a * x}.`, `Delimo z ${a}: x = ${x}.`] };
  }
  if (level === 2) {
    const a = ri(2, 8), x = ri(2, 10), b = ri(1, 15);
    return { question: `Reši: ${a}x − ${b} = ${a * x - b}`,
      answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
      steps: [`Prištej ${b}: ${a}x = ${a * x}.`, `Delimo z ${a}: x = ${x}.`] };
  }
  const a = ri(3, 9), c = ri(1, 5), x = ri(2, 10), b = ri(1, 15);
  const d = (a - c) * x + b;
  return { question: `Reši: ${a}x + ${b} = ${c}x + ${d}`,
    answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
    steps: [`Prenesi x-člene: ${a}x − ${c}x = ${d} − ${b}.`, `${a - c}x = ${d - b}.`, `x = ${x}.`] };
}

function gen_pitagora_8(level) {
  const triples = [[3, 4, 5], [6, 8, 10], [5, 12, 13], [9, 12, 15], [8, 15, 17]];
  if (level === 1) {
    const t = pick(triples);
    return { question: `Pravokotni trikotnik ima kateti a = ${t[0]} cm in b = ${t[1]} cm. Izračunaj hipotenuzo c.`,
      answers: [{ label: 'c', value: t[2], latex: String(t[2]) + ' cm' }],
      steps: [`Pitagorov izrek: a² + b² = c².`, `${t[0]}² + ${t[1]}² = ${t[0] ** 2} + ${t[1] ** 2} = ${t[2] ** 2}.`, `c = √${t[2] ** 2} = ${t[2]} cm.`],
      sketch: { type: 'right_triangle', data: { a: t[1], b: t[0], unit: 'cm' } } };
  }
  if (level === 2) {
    const t = pick(triples);
    return { question: `Pravokotni trikotnik ima hipotenuzo c = ${t[2]} cm in eno kateto b = ${t[0]} cm. Izračunaj drugo kateto a.`,
      answers: [{ label: 'a', value: t[1], latex: String(t[1]) + ' cm' }],
      steps: [`a² + b² = c² → a² = c² − b².`, `a² = ${t[2] ** 2} − ${t[0] ** 2} = ${t[2] ** 2 - t[0] ** 2}.`, `a = √${t[2] ** 2 - t[0] ** 2} = ${t[1]} cm.`] };
  }
  return { question: `Lestev dolžine 13 m je naslonjena na steno. Spodnji konec lestve je od stene oddaljen 5 m. Kako visoko sega lestev po steni?`,
    answers: [{ label: 'Višina', value: 12, latex: '12 m' }],
    steps: [`Lestev, stena in tla tvorijo pravokotni trikotnik.`, `Hipotenuza = 13 m, ena kateta = 5 m.`, `h² = 13² − 5² = 169 − 25 = 144.`, `h = √144 = 12 m.`] };
}

function gen_krog_8(level) {
  const PI = 3.14;
  if (level === 1) {
    const r = pick([2, 3, 4, 5, 10]);
    const o = Math.round(2 * PI * r * 100) / 100;
    return { question: `Krog ima polmer r = ${r} cm. Izračunaj obseg (π ≈ 3,14).`,
      answers: [{ label: 'Obseg', value: o, latex: fmt(o) + ' cm' }],
      steps: [`o = 2 · π · r.`, `o = 2 · 3,14 · ${r} = ${fmt(o)} cm.`],
      sketch: { type: 'circle', data: { r, unit: 'cm' } } };
  }
  if (level === 2) {
    const r = pick([2, 3, 4, 5, 10]);
    const p = Math.round(PI * r * r * 100) / 100;
    return { question: `Krog ima polmer r = ${r} cm. Izračunaj ploščino (π ≈ 3,14).`,
      answers: [{ label: 'Ploščina', value: p, latex: fmt(p) + ' cm²' }],
      steps: [`p = π · r².`, `p = 3,14 · ${r}² = 3,14 · ${r * r} = ${fmt(p)} cm².`],
      sketch: { type: 'circle', data: { r, unit: 'cm' } } };
  }
  const r = pick([3, 4, 5, 10]);
  const o = Math.round(2 * PI * r * 100) / 100;
  return { question: `Krožna plošča ima premer d = ${2 * r} cm. Izračunaj obseg (π ≈ 3,14).`,
    answers: [{ label: 'Obseg', value: o, latex: fmt(o) + ' cm' }],
    steps: [`Polmer je pol premera: r = ${r} cm.`, `o = 2 · 3,14 · ${r} = ${fmt(o)} cm.`] };
}

function gen_kocka_kvader_8(level) {
  if (level === 1) {
    const a = ri(2, 8);
    const V = a ** 3;
    return { question: `Kocka ima rob a = ${a} cm. Izračunaj prostornino.`,
      answers: [{ label: 'Prostornina', value: V, latex: String(V) + ' cm³' }],
      steps: [`V = a³.`, `V = ${a}³ = ${a} · ${a} · ${a} = ${V} cm³.`] };
  }
  if (level === 2) {
    const a = ri(2, 6);
    const P = 6 * a * a;
    return { question: `Kocka ima rob a = ${a} cm. Izračunaj površino.`,
      answers: [{ label: 'Površina', value: P, latex: String(P) + ' cm²' }],
      steps: [`Kocka ima 6 enakih kvadratnih ploskev.`, `P = 6 · a² = 6 · ${a * a} = ${P} cm².`] };
  }
  const a = ri(2, 6), b = ri(2, 6), c = ri(2, 6);
  return { question: `Kvader ima dimenzije a = ${a} cm, b = ${b} cm, c = ${c} cm. Izračunaj prostornino.`,
    answers: [{ label: 'Prostornina', value: a * b * c, latex: String(a * b * c) + ' cm³' }],
    steps: [`V = a · b · c.`, `V = ${a} · ${b} · ${c} = ${a * b * c} cm³.`] };
}

/* ============================================================
   9. RAZRED
   ============================================================ */

function gen_izrazi_9(level) {
  if (level === 1) {
    const a = ri(1, 5), b = ri(1, 5);
    return { question: `Razširi (x + ${a})(x + ${b}). Vpiši koeficient pri x.`,
      answers: [{ label: 'Koeficient pri x', value: a + b, latex: `x² + ${a + b}x + ${a * b}` }],
      steps: [`Vsak člen prvega oklepaja pomnožimo z vsakim členom drugega.`, `x·x + x·${b} + ${a}·x + ${a}·${b}.`, `= x² + ${a + b}x + ${a * b}.`] };
  }
  if (level === 2) {
    const a = ri(1, 7);
    return { question: `Razširi (x + ${a})². Vpiši koeficient pri x.`,
      answers: [{ label: 'Koeficient pri x', value: 2 * a, latex: `x² + ${2 * a}x + ${a * a}` }],
      steps: [`Kvadrat dvočlenika: (x + a)² = x² + 2ax + a².`, `(x + ${a})² = x² + ${2 * a}x + ${a * a}.`] };
  }
  const a = ri(1, 7);
  return { question: `Razstavi x² − ${a * a}. Vpiši pozitivno število v faktorju (x + a).`,
    answers: [{ label: 'a', value: a, latex: `(x − ${a})(x + ${a})` }],
    steps: [`Uporabimo razliko kvadratov: x² − a² = (x − a)(x + a).`, `x² − ${a * a} = (x − ${a})(x + ${a}).`] };
}

function gen_enacbe_9(level) {
  if (level === 1) {
    const a = ri(2, 6), x = ri(2, 10), b = ri(1, 10);
    return { question: `Reši: ${a}(x + ${b}) = ${a * (x + b)}`,
      answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
      steps: [`Delimo z ${a}: x + ${b} = ${x + b}.`, `Odštejemo ${b}: x = ${x}.`] };
  }
  if (level === 2) {
    let a, c, x, b, d, attempts = 0;
    do {
      a = ri(2, 5); c = ri(2, 5); x = ri(2, 8); b = ri(1, 8);
      const rhs = (a - c) * x + a * b;
      if (c === 0) continue;
      if (rhs % c !== 0) { attempts++; continue; }
      d = rhs / c;
      if (d < 0) { attempts++; continue; }
      break;
    } while (attempts < 20);
    if (a === c) return gen_enacbe_9(2);
    return { question: `Reši: ${a}(x + ${b}) = ${c}(x + ${d})`,
      answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
      steps: [`Razširimo: ${a}x + ${a * b} = ${c}x + ${c * d}.`, `Prenesemo: (${a} − ${c})x = ${c * d} − ${a * b}.`, `${a - c}x = ${c * d - a * b}.`, `x = ${x}.`] };
  }
  const a = ri(2, 5), x = a * ri(2, 6), b = ri(1, 10);
  const c = x / a + b;
  return { question: `Reši: x/${a} + ${b} = ${c}`,
    answers: [{ label: 'x', value: x, latex: 'x = ' + x }],
    steps: [`Odštej ${b}: x/${a} = ${c - b}.`, `Pomnoži z ${a}: x = ${x}.`] };
}

function gen_linearna_funkcija_9(level) {
  if (level === 1) {
    const a = ri(1, 5), b = ri(-5, 5), x = ri(-3, 5);
    const y = a * x + b;
    const bStr = b >= 0 ? `+ ${b}` : `− ${Math.abs(b)}`;
    return { question: `f(x) = ${a}x ${bStr}. Izračunaj f(${x}).`,
      answers: [{ label: 'f(x)', value: y, latex: String(y) }],
      steps: [`Vstavi x = ${x}: f(${x}) = ${a}·(${x}) ${bStr}.`, `= ${a * x} ${bStr} = ${y}.`] };
  }
  if (level === 2) {
    const a = ri(2, 5), x0 = ri(2, 6);
    const b = a * x0;
    return { question: `f(x) = ${a}x − ${b}. Pri katerem x je f(x) = 0?`,
      answers: [{ label: 'x', value: x0, latex: 'x = ' + x0 }],
      steps: [`Postavimo ${a}x − ${b} = 0.`, `${a}x = ${b}.`, `x = ${b / a}.`] };
  }
  const a1 = ri(1, 4), b1 = ri(-3, 5), a2 = a1 + ri(1, 3);
  const x0 = ri(-3, 3);
  const y0 = a1 * x0 + b1;
  const b2 = y0 - a2 * x0;
  const s1 = b1 >= 0 ? `+ ${b1}` : `− ${Math.abs(b1)}`;
  const s2 = b2 >= 0 ? `+ ${b2}` : `− ${Math.abs(b2)}`;
  return { question: `Premici y = ${a1}x ${s1} in y = ${a2}x ${s2}. Pri katerem x se sekata?`,
    answers: [{ label: 'x', value: x0, latex: 'x = ' + x0 }],
    steps: [`V presečišču: ${a1}x ${s1} = ${a2}x ${s2}.`, `(${a1} − ${a2})x = ${b2} − ${b1}.`, `${a1 - a2}x = ${b2 - b1}.`, `x = ${x0}.`] };
}

function gen_sistemi_9(level) {
  if (level === 1) {
    const x = ri(1, 8), y = ri(1, 8);
    const s = x + y, d = x - y;
    return { question: `Reši sistem (vpiši x):\nx + y = ${s}\nx − y = ${d}`,
      answers: [{ label: 'x', value: x, latex: `x = ${x}, y = ${y}` }],
      steps: [`Seštejemo enačbi: 2x = ${s + d}.`, `x = ${x}.`, `Vstavimo: ${x} + y = ${s}, y = ${y}.`] };
  }
  if (level === 2) {
    const x = ri(2, 10), y = ri(1, 8);
    const s = x + y, d = x - y;
    return { question: `Reši sistem (vpiši x):\nx + y = ${s}\nx − y = ${d}`,
      answers: [{ label: 'x', value: x, latex: `x = ${x}, y = ${y}` }],
      steps: [`Seštej: 2x = ${s + d}, x = ${x}.`, `Odštej: 2y = ${s - d}, y = ${y}.`] };
  }
  let x, y, a, b, attempts = 0;
  do {
    x = ri(1, 8); y = ri(1, 8); a = ri(2, 4);
    b = a * x - y;
    attempts++;
  } while ((b < 0 || !Number.isInteger(b)) && attempts < 20);
  const c = x + y;
  return { question: `Reši sistem (vpiši x):\ny = ${a}x − ${b}\nx + y = ${c}`,
    answers: [{ label: 'x', value: x, latex: `x = ${x}, y = ${y}` }],
    steps: [`Vstavi y v drugo: x + (${a}x − ${b}) = ${c}.`, `${a + 1}x = ${c + b}.`, `x = ${x}.`, `y = ${a}·${x} − ${b} = ${y}.`] };
}

function gen_podobnost_9(level) {
  if (level === 1) {
    const k = pick([2, 3]);
    const a = ri(3, 10), b = ri(3, 10);
    return { question: `Trikotnika sta podobna. Prvi ima stranici a = ${a} cm in b = ${b} cm. Drugi ima a' = ${a * k} cm. Koliko je b'?`,
      answers: [{ label: "b'", value: b * k, latex: String(b * k) + ' cm' }],
      steps: [`Razmerje: a : a' = b : b'.`, `${a} : ${a * k} = ${b} : b'.`, `b' = ${b} · ${a * k} / ${a} = ${b * k} cm.`] };
  }
  if (level === 2) {
    const k = pick([2, 3, 4]);
    const a = ri(3, 10);
    return { question: `Stranica prvega trikotnika je ${a} cm, ustrezna stranica podobnega drugega pa ${a * k} cm. Kolikšen je koeficient podobnosti k?`,
      answers: [{ label: 'k', value: k, latex: 'k = ' + k }],
      steps: [`k = a' / a.`, `k = ${a * k} / ${a} = ${k}.`] };
  }
  let a, b, c, d, attempts = 0;
  do {
    a = ri(2, 6); b = ri(2, 6); c = ri(2, 8);
    d = (b * c) / a;
    attempts++;
  } while (!Number.isInteger(d) && attempts < 30);
  return { question: `Vzporedni premici sekata kraka kota. Na prvem kraku sta odseka ${a} cm in ${b} cm, na drugem pa ${c} cm in x cm. Izračunaj x.`,
    answers: [{ label: 'x', value: d, latex: String(d) + ' cm' }],
    steps: [`Talesov izrek: ${a} : ${b} = ${c} : x.`, `x = ${b} · ${c} / ${a} = ${d} cm.`] };
}

function gen_telesa_9(level) {
  const PI = 3.14;
  if (level === 1) {
    const a = ri(2, 8), b = ri(2, 8), c = ri(2, 8);
    return { question: `Prizma ima pravokotno osnovno ploskev s stranicama ${a} cm in ${b} cm, višina je ${c} cm. Izračunaj prostornino.`,
      answers: [{ label: 'Prostornina', value: a * b * c, latex: String(a * b * c) + ' cm³' }],
      steps: [`Osnovna ploskev: O = ${a} · ${b} = ${a * b} cm².`, `V = O · v = ${a * b} · ${c} = ${a * b * c} cm³.`] };
  }
  if (level === 2) {
    const r = pick([2, 3, 4, 5]);
    const v = pick([3, 4, 5, 6, 10]);
    const V = Math.round(PI * r * r * v * 100) / 100;
    return { question: `Valj ima polmer r = ${r} cm in višino v = ${v} cm. Izračunaj prostornino (π ≈ 3,14).`,
      answers: [{ label: 'Prostornina', value: V, latex: fmt(V) + ' cm³' }],
      steps: [`V = π · r² · v.`, `V = 3,14 · ${r * r} · ${v} = ${fmt(V)} cm³.`] };
  }
  const a = ri(3, 8), v = ri(3, 9);
  const V = Math.round((a * a * v / 3) * 100) / 100;
  return { question: `Piramida ima kvadratno osnovno ploskev s stranico a = ${a} cm, višina je v = ${v} cm. Izračunaj prostornino.`,
    answers: [{ label: 'Prostornina', value: V, latex: fmt(V) + ' cm³' }],
    steps: [`O = a² = ${a * a} cm².`, `V = (O · v) / 3 = (${a * a} · ${v}) / 3 = ${fmt(V)} cm³.`] };
}

function gen_verjetnost_9(level) {
  if (level === 1) {
    const total = pick([6, 10, 12, 20]);
    const fav = ri(1, total - 1);
    const p = Math.round((fav / total) * 100) / 100;
    return { question: `V škatli je ${total} kroglic, ${fav} rdečih. Kolikšna je verjetnost, da izberemo rdečo? (Vpiši decimalno število.)`,
      answers: [{ label: 'Verjetnost', value: p, latex: frac(fav, total) }],
      steps: [`P = ugodni / vsi.`, `P = ${fav}/${total} = ${fmt(p)}.`] };
  }
  if (level === 2) {
    const target = pick([1, 2, 3, 4, 5, 6]);
    return { question: `Kocko vržemo enkrat. Kolikšna je verjetnost, da pade ${target}? (Vpiši decimalno število, zaokroženo na 3 decimalke.)`,
      answers: [{ label: 'Verjetnost', value: Math.round((1 / 6) * 1000) / 1000, latex: frac(1, 6) }],
      steps: [`6 enako verjetnih izidov.`, `Ugodni izid: en sam (${target}).`, `P = 1/6 ≈ 0,167.`] };
  }
  const rdece = ri(3, 8), modre = ri(2, 8);
  const total = rdece + modre;
  const p = Math.round((rdece / total) * 1000) / 1000;
  return { question: `V vrečki je ${rdece} rdečih in ${modre} modrih kroglic. Kolikšna je verjetnost, da izvlečemo rdečo? (Vpiši decimalno število, zaokroženo na 3 decimalke.)`,
    answers: [{ label: 'Verjetnost', value: p, latex: frac(rdece, total) }],
    steps: [`Vseh kroglic: ${total}.`, `P = ${rdece}/${total} = ${fmt(p)}.`] };
}

/* ============================================================
   TOPIC LIBRARY
   ============================================================ */

const TOPICS = {
  // 6. razred
  'sestevanje_odstevanje_6': { name: 'Seštevanje in odštevanje naravnih števil', grade: 6, description: 'Vaja seštevanja in odštevanja naravnih števil.', generate: gen_sestevanje_odstevanje_6 },
  'mnozenje_deljenje_6': { name: 'Množenje in deljenje naravnih števil', grade: 6, description: 'Vaja množenja in deljenja naravnih števil.', generate: gen_mnozenje_deljenje_6 },
  'ulomki_osnove_6': { name: 'Ulomki – osnove', grade: 6, description: 'Ulomki kot deli celote, primerjanje in seštevanje.', generate: gen_ulomki_osnove_6 },
  'decimalna_6': { name: 'Decimalna števila', grade: 6, description: 'Seštevanje in odštevanje decimalnih števil.', generate: gen_decimalna_6 },
  'obseg_ploscina_6': { name: 'Obseg in ploščina pravokotnika in kvadrata', grade: 6, description: 'Obseg in ploščina pravokotnika in kvadrata.', generate: gen_obseg_ploscina_6 },
  'merjenje_6': { name: 'Pretvarjanje merskih enot', grade: 6, description: 'Pretvarjanje med kilometri, metri, kilogrami in grami.', generate: gen_merjenje_6 },
  // 7. razred
  'deljivost_7': { name: 'Deljivost (NSD in NSV)', grade: 7, description: 'Največji skupni delitelj in najmanjši skupni večkratnik.', generate: gen_deljivost_7 },
  'ulomki_sestevanje_7': { name: 'Seštevanje in odštevanje ulomkov', grade: 7, description: 'Seštevanje in odštevanje ulomkov.', generate: gen_ulomki_sestevanje_7 },
  'ulomki_mnozenje_7': { name: 'Množenje in deljenje ulomkov', grade: 7, description: 'Množenje in deljenje ulomkov.', generate: gen_ulomki_mnozenje_7 },
  'trikotnik_7': { name: 'Trikotnik – obseg in ploščina', grade: 7, description: 'Obseg in ploščina trikotnika.', generate: gen_trikotnik_7 },
  'odstotki_7': { name: 'Odstotki', grade: 7, description: 'Računanje z odstotki.', generate: gen_odstotki_7 },
  'enacbe_7': { name: 'Preproste enačbe', grade: 7, description: 'Reševanje preprostih linearnih enačb.', generate: gen_enacbe_7 },
  // 8. razred
  'cela_stevila_8': { name: 'Cela števila – računanje s predznaki', grade: 8, description: 'Seštevanje, odštevanje, množenje celih števil.', generate: gen_cela_stevila_8 },
  'potence_8': { name: 'Potence in kvadratni koren', grade: 8, description: 'Kvadriranje in kvadratni koren.', generate: gen_potence_8 },
  'izrazi_8': { name: 'Izrazi s spremenljivko', grade: 8, description: 'Poenostavljanje in razširjanje izrazov.', generate: gen_izrazi_8 },
  'enacbe_8': { name: 'Linearne enačbe', grade: 8, description: 'Reševanje linearnih enačb z eno neznanko.', generate: gen_enacbe_8 },
  'pitagora_8': { name: 'Pitagorov izrek', grade: 8, description: 'Uporaba Pitagorovega izreka.', generate: gen_pitagora_8 },
  'krog_8': { name: 'Krog in krožnica', grade: 8, description: 'Obseg in ploščina kroga.', generate: gen_krog_8 },
  'kocka_kvader_8': { name: 'Kocka in kvader', grade: 8, description: 'Površina in prostornina kocke in kvadra.', generate: gen_kocka_kvader_8 },
  // 9. razred
  'izrazi_9': { name: 'Izrazi – množenje in razstavljanje', grade: 9, description: 'Množenje veččlenikov, kvadrat dvočlenika, razlika kvadratov.', generate: gen_izrazi_9 },
  'enacbe_9': { name: 'Linearne enačbe z oklepaji in ulomki', grade: 9, description: 'Reševanje zahtevnejših linearnih enačb.', generate: gen_enacbe_9 },
  'linearna_funkcija_9': { name: 'Linearna funkcija', grade: 9, description: 'Vrednotenje linearne funkcije, ničla, presečišče premic.', generate: gen_linearna_funkcija_9 },
  'sistemi_9': { name: 'Sistemi linearnih enačb', grade: 9, description: 'Reševanje sistemov dveh linearnih enačb.', generate: gen_sistemi_9 },
  'podobnost_9': { name: 'Podobnost in Talesov izrek', grade: 9, description: 'Podobni trikotniki in Talesov izrek.', generate: gen_podobnost_9 },
  'telesa_9': { name: 'Prostornina teles', grade: 9, description: 'Prostornina prizme, valja in piramide.', generate: gen_telesa_9 },
  'verjetnost_9': { name: 'Verjetnost', grade: 9, description: 'Računanje osnovne verjetnosti.', generate: gen_verjetnost_9 }
};

module.exports = { TOPICS };
