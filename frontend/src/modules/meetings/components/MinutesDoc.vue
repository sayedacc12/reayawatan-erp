<script setup lang="ts">
import { fmtDate, timeText, type Snapshot } from '../lib';

/** نص المحضر كما يُجمَّد عند الإصدار (يُعرض في الطباعة وصفحة التوقيع) */
defineProps<{ m: Snapshot; draft?: boolean }>();
</script>

<template>
  <article class="mt-doc">
    <header>
      <div style="font-size: .9rem; color: #475569">{{ m.organization }}</div>
      <h2>محضر اجتماع {{ m.body }}</h2>
      <div><b>{{ m.title }}</b></div>
      <div style="font-size: .85rem; color: #475569">رقم <span dir="ltr">{{ m.refNo }}</span> · الإصدار {{ m.version }} · اجتماع {{ m.type }} · {{ m.mode }}</div>
      <div v-if="draft" class="draft">مسودة لم تصدر للتوقيع</div>
    </header>
    <p>عُقد الاجتماع بتاريخ <b>{{ fmtDate(m.date) }}</b> الساعة <b>{{ timeText(m.startTime) }}</b><template v-if="m.endTime"> حتى {{ timeText(m.endTime) }}</template><template v-if="m.location"> في {{ m.location }}</template>.
      حضر {{ m.quorum.present }} من {{ m.quorum.voting }} عضوًا لهم حق التصويت، والنصاب المطلوب {{ m.quorum.required }}%،
      <b>{{ m.quorum.met === null ? '' : m.quorum.met ? 'فكان النصاب مكتملًا' : 'ولم يكتمل النصاب' }}</b>.</p>
    <p v-if="m.opening" style="white-space: pre-line">{{ m.opening }}</p>
    <h3>الحضور</h3>
    <table>
      <thead><tr><th>#</th><th>الاسم</th><th>الصفة</th><th>الحضور</th></tr></thead>
      <tbody><tr v-for="(a, i) in m.attendees" :key="i"><td>{{ i + 1 }}</td><td>{{ a.name }}<small v-if="a.title"> ({{ a.title }})</small></td><td>{{ a.guest ? 'مدعو' : a.role }}</td><td>{{ a.attendance }}</td></tr></tbody>
    </table>
    <h3>جدول الأعمال وما دار فيه</h3>
    <section v-for="it in m.items" :key="it.seq" style="margin-bottom: 14px">
      <b>البند {{ it.seq }}: {{ it.title }}</b><small v-if="it.presenter" style="color: #64748b"> (عرض: {{ it.presenter }})</small>
      <p v-if="it.status === 'deferred'" style="margin: 4px 0; color: #b45309">أُجّل هذا البند.</p>
      <p v-if="it.discussion" style="margin: 4px 0; white-space: pre-line">{{ it.discussion }}</p>
      <div v-for="r in it.recommendations" :key="r.seq" class="rec">
        <b>{{ r.kind }} {{ it.seq }}.{{ r.seq }}:</b> {{ r.text }}
        <div style="font-size: .82rem; color: #475569">
          <template v-if="r.owner">المسؤول: {{ r.owner }}</template><template v-if="r.supporters.length"> · المساندون: {{ r.supporters.join('، ') }}</template>
          <template v-if="r.dueDate"> · الموعد: {{ fmtDate(r.dueDate) }}</template>
          <template v-if="r.votes"> · التصويت: موافق {{ r.votes.for }}، معارض {{ r.votes.against }}، ممتنع {{ r.votes.abstain }}</template>
        </div>
      </div>
    </section>
    <p v-if="m.closing" style="white-space: pre-line">{{ m.closing }}</p>
    <slot />
  </article>
</template>
