<script setup lang="ts">
import { openProtectedFile } from '../../../api';
import { useToast } from '../../../stores/toast';
import { age, fmtDate, label, money } from '../labels';
import type { CaseFile } from '../types';

/** ملف المستفيد كاملًا داخل صفحة الطلب، حتى يقرر المسؤول دون الانتقال لشاشة أخرى */
const props = defineProps<{ beneficiaryId: string; file: CaseFile; nationalId: string | null; phone: string | null }>();
const toast = useToast();
async function openDoc(docId: string) {
  try {
    await openProtectedFile(`/beneficiaries/${props.beneficiaryId}/documents/${docId}/file`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <section class="card block casefile">
    <h2>ملف المستفيد كاملًا <RouterLink :to="`/beneficiaries/files/${beneficiaryId}`" class="small open">فتح الملف ↗</RouterLink></h2>
    <dl class="facts-grid">
      <div><dt>رقم الهوية</dt><dd dir="ltr">{{ nationalId || '—' }}</dd></div>
      <div><dt>الجوال</dt><dd dir="ltr">{{ phone || '—' }}<template v-if="file.altPhone"> · {{ file.altPhone }}</template></dd></div>
      <div><dt>الجنس والعمر</dt><dd>{{ label('gender', file.gender) }}<template v-if="file.birthDate"> · {{ age(file.birthDate) }} سنة</template></dd></div>
      <div><dt>الجنسية</dt><dd>{{ file.nationality || '—' }}<template v-if="file.residency"> · {{ label('residency', file.residency) }}</template></dd></div>
      <div><dt>الحالة الاجتماعية</dt><dd>{{ label('marital', file.maritalStatus) }}</dd></div>
      <div><dt>المدينة والعنوان</dt><dd>{{ [file.city, file.address].filter(Boolean).join(' · ') || '—' }}</dd></div>
      <div><dt>دخل المستفيد</dt><dd>{{ money(file.monthlyIncome) }}<template v-if="file.incomeSource"> · {{ file.incomeSource }}</template></dd></div>
      <div><dt>دخل الأسرة الإجمالي</dt><dd><b>{{ money(file.householdIncome) }}</b> شهريًا</dd></div>
      <div><dt>السكن</dt><dd>{{ label('housing', file.housingType) }}<template v-if="file.monthlyRent"> · إيجار {{ money(file.monthlyRent) }}</template></dd></div>
      <div v-if="file.healthStatus"><dt>الحالة الصحية</dt><dd>{{ file.healthStatus }}</dd></div>
    </dl>
    <p v-if="file.notes" class="muted small pre">{{ file.notes }}</p>

    <h3>أفراد الأسرة ({{ file.family.length }})</h3>
    <table v-if="file.family.length" class="table">
      <thead><tr><th>الاسم</th><th>الصلة</th><th>العمر</th><th>العمل أو الدراسة</th><th>الدخل</th></tr></thead>
      <tbody>
        <tr v-for="m in file.family" :key="m.id">
          <td>{{ m.fullName }}</td><td>{{ m.relation }}</td><td>{{ m.birthDate ? age(m.birthDate) : '—' }}</td>
          <td>{{ m.occupation || '—' }}<span v-if="m.healthStatus" class="muted"> · {{ m.healthStatus }}</span></td><td>{{ money(m.monthlyIncome) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="muted small">لا يوجد أفراد مسجلون.</p>

    <h3>المستندات ({{ file.documents.length }})</h3>
    <ul v-if="file.documents.length" class="docs">
      <li v-for="d in file.documents" :key="d.id">
        <button type="button" class="linkbtn" @click="openDoc(d.id)">📄 {{ d.title }}</button>
        <span class="muted small">{{ label('doc', d.docType) }} · {{ fmtDate(d.createdAt) }}</span>
      </li>
    </ul>
    <p v-else class="muted small">لا توجد مستندات مرفوعة.</p>

    <h3>المساعدات السابقة <span class="muted small">({{ file.aidCount }} بإجمالي {{ money(file.aidTotal) }})</span></h3>
    <table v-if="file.aids.length" class="table">
      <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>البيان</th></tr></thead>
      <tbody>
        <tr v-for="a in file.aids" :key="a.id"><td>{{ fmtDate(a.disbursedOn) }}</td><td>{{ label('aid', a.aidType) }}</td><td>{{ money(a.amount) }}</td><td>{{ a.description || '—' }}<span v-if="a.referenceNo" class="muted"> · {{ a.referenceNo }}</span></td></tr>
      </tbody>
    </table>
    <p v-else class="muted small">لم يحصل على مساعدات من قبل.</p>

    <h3>طلباته الأخرى ({{ file.otherRequests.length }})</h3>
    <ul v-if="file.otherRequests.length" class="others">
      <li v-for="o in file.otherRequests" :key="o.id">
        <RouterLink :to="`/beneficiaries/requests/${o.id}`">طلب {{ o.requestNo }}</RouterLink>
        <span>{{ o.projectName }}</span>
        <span class="muted small">{{ label('request', o.status) }} · {{ fmtDate(o.createdAt) }}</span>
      </li>
    </ul>
    <p v-else class="muted small">لا توجد طلبات أخرى.</p>
  </section>
</template>

<style scoped>
.casefile h2 { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.casefile h3 { font-size: .92rem; margin: 18px 0 8px; color: var(--primary); }
.open { font-weight: 500; }
.facts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 16px; margin: 0; }
.facts-grid dt { font-size: .76rem; color: var(--muted); }
.facts-grid dd { margin: 2px 0 0; font-size: .9rem; }
.docs, .others { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.docs li, .others li { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
.linkbtn { background: none; border: 0; padding: 0; color: var(--primary); cursor: pointer; font: inherit; }
.pre { white-space: pre-wrap; }
.table { font-size: .86rem; }
</style>
