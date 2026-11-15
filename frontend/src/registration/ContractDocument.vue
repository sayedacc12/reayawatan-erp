<script setup lang="ts">
/** عرض نص العقد النهائي: بنود مرقمة بالترتيب العربي وفقرات مرقمة داخل كل بند */
defineProps<{
  number: string;
  rendered: { title: string; paragraphs: string[] }[];
  hash?: string | null;
  signature?: { name: string | null; title: string | null; at: string | null } | null;
}>();
const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر',
  'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون'];
const ord = (i: number) => ORD[i] ?? String(i + 1);
const at = (d: string | null) => (d ? new Date(d).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'long', timeStyle: 'short' }) : '');
</script>

<template>
  <article class="doc">
    <header class="doc-head">
      <div class="seal" aria-hidden="true">
        <svg viewBox="0 0 48 48"><path d="M24 4c3 6 3 12 0 18-3-6-3-12 0-18Zm0 18c5-4 11-5 16-3-4 5-10 7-16 3Zm0 0c-5-4-11-5-16-3 4 5 10 7 16 3Zm0 6c5-4 11-5 16-3-4 5-10 7-16 3Zm0 0c-5-4-11-5-16-3 4 5 10 7 16 3Zm0 0v16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </div>
      <h1>عقد اشتراك في منصة سنابل</h1>
      <p>رقم العقد <b dir="ltr">{{ number }}</b></p>
    </header>
    <section v-for="(c, i) in rendered" :key="i" class="clause" :style="{ '--i': i }">
      <h2><span class="ord">البند {{ ord(i) }}</span> {{ c.title }}</h2>
      <ol v-if="c.paragraphs.length > 1">
        <li v-for="(p, j) in c.paragraphs" :key="j"><span class="pn">{{ i + 1 }}.{{ j + 1 }}</span> {{ p }}</li>
      </ol>
      <p v-else-if="c.paragraphs.length">{{ c.paragraphs[0] }}</p>
    </section>
    <footer v-if="signature?.at || hash" class="doc-foot">
      <div v-if="signature?.at" class="sig">
        <span class="sig-badge">✓ موقّع إلكترونيًا</span>
        <div><b>{{ signature.name }}</b> · {{ signature.title }}</div>
        <small>{{ at(signature.at) }}</small>
      </div>
      <div v-if="hash" class="hash"><small>البصمة الرقمية للنص (SHA-256)</small><code dir="ltr">{{ hash }}</code></div>
    </footer>
  </article>
</template>

<style scoped>
.doc { background: #fffdf8; border: 1px solid #eadfc8; border-radius: 16px; padding: 34px 38px; box-shadow: 0 20px 50px rgba(60, 40, 10, .08); line-height: 1.95; color: #2a2418;
  background-image: radial-gradient(circle at 100% 0, rgba(232,176,75,.10), transparent 40%), radial-gradient(circle at 0 100%, rgba(20,184,166,.07), transparent 40%); }
.doc-head { text-align: center; border-bottom: 2px double #e2d3b0; padding-bottom: 18px; margin-bottom: 18px; }
.seal { width: 58px; height: 58px; margin: 0 auto 8px; border-radius: 50%; display: grid; place-items: center; color: #b07d1e; border: 2px solid #e8c77d; background: #fff7e6; }
.seal svg { width: 32px; height: 32px; }
.doc-head h1 { font-size: 1.35rem; color: #0f5c55; }
.doc-head p { margin: 4px 0 0; color: #7a6a48; }
.clause { margin-bottom: 14px; animation: c-in .4s ease both; animation-delay: calc(min(var(--i), 12) * 35ms); }
@keyframes c-in { from { opacity: 0; transform: translateY(6px); } }
.clause h2 { font-size: 1.02rem; color: #0f5c55; margin-bottom: 4px; }
.ord { color: #b07d1e; margin-inline-end: 6px; }
.clause ol { list-style: none; padding: 0; margin: 0; }
.clause li { margin-bottom: 4px; }
.pn { color: #a08a5a; font-size: .85rem; margin-inline-end: 4px; }
.clause p { margin: 0; }
.doc-foot { margin-top: 24px; border-top: 2px double #e2d3b0; padding-top: 16px; display: flex; gap: 16px; justify-content: space-between; flex-wrap: wrap; align-items: flex-end; }
.sig-badge { display: inline-block; background: #e7f6ee; color: #067647; padding: 2px 12px; border-radius: 999px; font-weight: 600; font-size: .85rem; margin-bottom: 4px; }
.hash { max-width: 100%; }
.hash code { display: block; font-size: .72rem; color: #7a6a48; overflow-wrap: anywhere; }
@media (max-width: 640px) { .doc { padding: 22px 18px; } }
@media print { .doc { box-shadow: none; border: 0; } }
</style>
