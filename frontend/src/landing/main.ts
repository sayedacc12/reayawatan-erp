import './landing.css';

/**
 * الصفحة التعريفية لسنابل (sanabelerp.com): صفحة ثابتة سريعة ومهيأة لمحركات البحث،
 * وهذا الملف يضيف المؤثرات ونموذج الطلب وبيانات التواصل التي يحددها مدير المنصة.
 */

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SERVICES = [
  { code: 'digital', name: 'التحول الرقمي' },
  { code: 'governance', name: 'الحوكمة والالتزام' },
  { code: 'risk_audit', name: 'المخاطر والمراجعة الداخلية' },
  { code: 'impact', name: 'قياس الأثر الاجتماعي' },
  { code: 'sustainability', name: 'الاستدامة المالية' },
  { code: 'strategy_quality', name: 'التخطيط الاستراتيجي والجودة' },
  { code: 'capacity', name: 'بناء القدرات' },
];
const ORDINALS = ['الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة'];

// ---------- الشريط العلوي ----------
const nav = $('.nav')!;
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

const burger = $('[data-burger]')!;
burger.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  burger.setAttribute('aria-expanded', String(open));
});
$$('.links a').forEach((a) => a.addEventListener('click', () => {
  nav.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
}));

// ---------- ظهور العناصر عند التمرير ----------
const revealer = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    e.target.classList.add('in');
    revealer.unobserve(e.target);
  }
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
$$('.reveal').forEach((el, i) => {
  // تأخير متدرج للعناصر المتجاورة
  const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.classList.contains('reveal')) : [];
  el.style.setProperty('--d', `${Math.min(siblings.indexOf(el), 8) * 80}ms`);
  if (reduce) el.classList.add('in');
  else revealer.observe(el);
  void i;
});

// ---------- عدادات الأرقام ----------
const counter = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    counter.unobserve(e.target);
    const el = e.target as HTMLElement;
    const target = Number(el.dataset.count);
    const plus = el.dataset.plus !== undefined ? '+' : '';
    if (reduce) continue;
    const start = performance.now();
    const dur = 1400;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = `${Math.round(target * eased)}${plus}`;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}, { threshold: 0.6 });
$$('[data-count]').forEach((el) => counter.observe(el));

// ---------- السنبلة: تضيء الحبات واحدة تلو الأخرى، وكل حبة خدمة ----------
const grains = $$<HTMLElement>('.grain');
const grainNo = $('#grainNo')!;
const grainName = $('#grainName')!;
let active = 0;
let grainTimer = 0;
function lightGrain(i: number) {
  active = i;
  grains.forEach((g, j) => {
    g.classList.toggle('lit', j <= i);
    g.classList.toggle('current', j === i);
  });
  grainNo.textContent = `السنبلة ${ORDINALS[i]}`;
  grainName.textContent = SERVICES[i].name;
  $$('.svc[data-service]').forEach((card) => card.classList.toggle('glow', card.dataset.service === SERVICES[i].code));
}
function cycleGrains() {
  window.clearInterval(grainTimer);
  if (reduce) return;
  grainTimer = window.setInterval(() => lightGrain((active + 1) % grains.length), 2200);
}
grains.forEach((g, i) => {
  g.addEventListener('pointerenter', () => { window.clearInterval(grainTimer); lightGrain(i); });
  g.addEventListener('pointerleave', cycleGrains);
  g.addEventListener('click', () => $(`.svc[data-service="${SERVICES[i].code}"]`)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }));
});
lightGrain(reduce ? grains.length - 1 : 0);
cycleGrains();

// ---------- بقعة ضوء تتبع المؤشر في البطاقات ----------
$$('.svc, .why-card, .form-inner').forEach((card) => {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  });
});

// ميلان خفيف للسنبلة مع حركة المؤشر
const stalkWrap = $('.stalk-wrap');
if (stalkWrap && !reduce && window.matchMedia('(pointer: fine)').matches) {
  window.addEventListener('pointermove', (e) => {
    const x = (e.clientX / window.innerWidth - 0.5) * 2;
    const y = (e.clientY / window.innerHeight - 0.5) * 2;
    stalkWrap.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
    stalkWrap.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
  }, { passive: true });
}

// ---------- حلقة الأنظمة حول شعار المنصة ----------
const orbitItems = $$('.orbit-list li');
orbitItems.forEach((li, i) => li.style.setProperty('--a', `${(360 / orbitItems.length) * i}deg`));
const orbit = $('.orbit');
const sizeOrbit = () => orbit?.style.setProperty('--r', `${Math.round(orbit.clientWidth * (orbit.clientWidth < 420 ? 0.36 : 0.42))}px`);
sizeOrbit();
window.addEventListener('resize', sizeOrbit);

// ---------- خلفية النجوم ----------
function particles() {
  const el = $<HTMLCanvasElement>('#particles');
  if (!el) return;
  const ctx = el.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  type P = { x: number; y: number; vx: number; vy: number; r: number; gold: boolean };
  let w = 0, h = 0, pts: P[] = [], raf = 0;
  const mouse = { x: -9999, y: -9999 };
  const resize = () => {
    w = el.clientWidth; h = el.clientHeight;
    el.width = w * dpr; el.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(90, Math.floor((w * h) / 18000));
    pts = Array.from({ length: n }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3 - 0.08,
      r: Math.random() * 1.5 + 0.5, gold: Math.random() < 0.18,
    }));
  };
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    for (const p of pts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      const dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.hypot(dx, dy);
      if (d < 120 && d > 0) { p.x += (dx / d) * 0.7; p.y += (dy / d) * 0.7; }
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < 120) {
          ctx.strokeStyle = `rgba(125, 249, 230, ${0.12 * (1 - d / 120)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const p of pts) {
      ctx.fillStyle = p.gold ? 'rgba(250, 214, 140, 0.9)' : 'rgba(190, 255, 245, 0.8)';
      ctx.shadowColor = p.gold ? 'rgba(245, 198, 107, 0.9)' : 'rgba(94, 234, 212, 0.9)';
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (!reduce && !document.hidden) raf = requestAnimationFrame(frame);
  };
  resize(); frame();
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !reduce) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
  });
}
particles();

// ---------- بيانات التواصل من إعدادات مدير المنصة ----------
interface Contact { whatsapp: string | null; whatsappMessage: string | null; email: string | null; phone: string | null }
const waLinks = [$<HTMLAnchorElement>('#waCard')!, $<HTMLAnchorElement>('#waFloat')!];
function applyContact(c: Contact) {
  if (c.whatsapp) {
    const url = `https://wa.me/${c.whatsapp}${c.whatsappMessage ? `?text=${encodeURIComponent(c.whatsappMessage)}` : ''}`;
    waLinks.forEach((a) => { a.href = url; a.target = '_blank'; });
    $('#waText')!.textContent = `+${c.whatsapp}`;
    $('#waText')!.setAttribute('dir', 'ltr');
  } else {
    // قبل تحديد الرقم: زر واتساب يفتح نموذج الطلب
    waLinks.forEach((a) => { a.href = '#contact'; a.removeAttribute('target'); });
  }
  if (c.email) {
    $<HTMLAnchorElement>('#mailCard')!.href = `mailto:${c.email}`;
    $('#mailText')!.textContent = c.email;
    const foot = $<HTMLAnchorElement>('#footMail')!;
    foot.href = `mailto:${c.email}`;
    foot.textContent = c.email;
  }
  const phoneCard = $<HTMLAnchorElement>('#phoneCard')!;
  if (c.phone) {
    phoneCard.hidden = false;
    phoneCard.href = `tel:${c.phone}`;
    $('#phoneText')!.textContent = c.phone;
  }
}
waLinks.forEach((a) => { a.href = '#contact'; a.removeAttribute('target'); });
fetch('/api/public/site/contact').then((r) => (r.ok ? r.json() : null)).then((c) => c && applyContact(c)).catch(() => {});

// ---------- نموذج الطلب ----------
type Kind = 'consultation' | 'quote' | 'demo';
const KIND_HINT: Record<Kind, string> = {
  consultation: 'جلسة تشخيص مجانية مدتها 30 دقيقة مع أحد مستشارينا.',
  quote: 'اختر الخدمة، وسنرسل لك عرضًا بالنطاق والمدة والتكلفة.',
  demo: 'جولة مباشرة في منصة سنابل ERP على بيانات جمعية تجريبية.',
};
const KIND_SUBMIT: Record<Kind, string> = { consultation: 'احجز الاستشارة المجانية', quote: 'اطلب عرض السعر', demo: 'اطلب العرض التجريبي' };
const form = $<HTMLFormElement>('#requestForm')!;
const tabs = $$<HTMLButtonElement>('.tabs [data-kind]');
const serviceSelect = $<HTMLSelectElement>('#serviceSelect')!;
const formError = $('#formError')!;
let kind: Kind = 'consultation';

function setKind(k: Kind) {
  kind = k;
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.kind === k)));
  $('#kindHint')!.textContent = KIND_HINT[k];
  $('#submitText')!.textContent = KIND_SUBMIT[k];
  if (k === 'demo' && !serviceSelect.value) serviceSelect.value = 'digital';
}
tabs.forEach((t) => t.addEventListener('click', () => setKind(t.dataset.kind as Kind)));
setKind('consultation');

// أزرار الطلب في كل الصفحة تفتح النموذج بالنوع والخدمة المناسبين
$$('[data-request]').forEach((btn) => btn.addEventListener('click', () => {
  setKind(btn.dataset.request as Kind);
  if (btn.dataset.svc) serviceSelect.value = btn.dataset.svc;
  showForm();
  $('#contact')!.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  window.setTimeout(() => $<HTMLInputElement>('[name="orgName"]', form)?.focus({ preventScroll: true }), reduce ? 0 : 700);
}));

function showError(msg: string) {
  formError.textContent = msg;
  formError.hidden = false;
}
function showForm() {
  $('#formSuccess')!.hidden = true;
  $('.form-inner', form)!.hidden = false;
}
$('#againBtn')!.addEventListener('click', () => { form.reset(); setKind(kind); showForm(); });

const toLatinDigits = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;
  const data = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
  const phone = toLatinDigits(data.phone ?? '').replace(/[\s-]/g, '');
  if ((data.orgName ?? '').trim().length < 3) return showError('اكتب اسم الجمعية.');
  if ((data.contactName ?? '').trim().length < 3) return showError('اكتب اسمك.');
  if (!/^\+?[0-9]{9,15}$/.test(phone)) return showError('رقم الجوال غير صحيح. اكتبه مثل 0500000000.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) return showError('البريد الإلكتروني غير صحيح.');
  if (kind === 'quote' && !data.serviceCode) return showError('اختر الخدمة التي تريد عرض سعر لها.');

  const btn = $<HTMLButtonElement>('#submitBtn')!;
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    const res = await fetch('/api/public/site/inquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, phone, kind }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) return showError('أرسلت طلبات كثيرة خلال وقت قصير. حاول بعد قليل، أو تواصل معنا عبر واتساب.');
    if (!res.ok) {
      const msg = Array.isArray(body.message) ? body.message.join('، ') : body.message;
      return showError(msg || 'تعذر إرسال الطلب. حاول مرة أخرى.');
    }
    const name = serviceSelect.selectedOptions[0]?.value ? `«${serviceSelect.selectedOptions[0].text}»` : '';
    $('#successText')!.textContent = body.number
      ? `رقم طلبك ${body.number}${name ? ` لخدمة ${name}` : ''}. سيتواصل معك فريقنا خلال يوم عمل واحد.`
      : 'سيتواصل معك فريقنا خلال يوم عمل واحد.';
    $('.form-inner', form)!.hidden = true;
    $('#formSuccess')!.hidden = false;
  } catch {
    showError('تعذر الاتصال. تحقق من الإنترنت ثم حاول مرة أخرى.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
});

// ---------- نافذة تسجيل الدخول: معرّف الجمعية ----------
const dlg = $<HTMLDialogElement>('#loginDlg')!;
const slugInput = $<HTMLInputElement>('#orgSlug')!;
const orgError = $('#orgError')!;
let lastOrg: string | null = null;
try { lastOrg = localStorage.getItem('erp.org'); } catch { /* التخزين غير متاح */ }
if (lastOrg) {
  const a = $<HTMLAnchorElement>('#lastOrg')!;
  a.hidden = false;
  a.href = `/o/${lastOrg}`;
  a.textContent = `متابعة إلى آخر جمعية دخلت منها: ${lastOrg}`;
}
$$('[data-open-login]').forEach((b) => b.addEventListener('click', () => {
  orgError.hidden = true;
  if (lastOrg) slugInput.value = lastOrg;
  dlg.showModal();
  slugInput.focus();
}));
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
$<HTMLFormElement>('#orgForm')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  orgError.hidden = true;
  // يقبل المعرف وحده أو الرابط كاملًا
  const raw = slugInput.value.trim().toLowerCase();
  const slug = (raw.match(/\/o\/([a-z0-9-]+)/)?.[1] ?? raw).replace(/^\/+|\/+$/g, '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    orgError.textContent = 'المعرف بحروف إنجليزية صغيرة وأرقام وشرطة فقط، مثل al-bir.';
    orgError.hidden = false;
    return;
  }
  const res = await fetch(`/api/auth/org/${slug}`).catch(() => null);
  if (res && res.status === 404) {
    orgError.textContent = 'لم نجد جمعية بهذا المعرف. تأكد منه مع إدارة جمعيتك.';
    orgError.hidden = false;
    return;
  }
  location.href = `/o/${slug}`;
});

$('#year')!.textContent = String(new Date().getFullYear());
