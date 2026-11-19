<script setup lang="ts">
/** نتيجة إضافة البيانات التجريبية: ما أُضيف، وحسابات الموظفين والبوابة التجريبية (كلمات المرور تظهر مرة واحدة) */
export interface SampleResult {
  records: number;
  systems: { system: string; count: number }[];
  staffPassword: string;
  staff: { role: string; email: string }[];
  portalPassword: string;
  portalUsers: { fullName: string; nationalId: string }[];
  supplierPortal?: { url: string; users: { supplier: string; status: string; fullName: string; email: string }[] };
}
defineProps<{ result: SampleResult; slug: string }>();
const origin = location.origin;
</script>

<template>
  <div class="sample-result">
    <p class="lead">أُضيف <b>{{ result.records.toLocaleString('ar-SA') }}</b> سجلًا تجريبيًا مترابطًا في الأنظمة التالية:</p>
    <ul class="chips">
      <li v-for="s in result.systems" :key="s.system">{{ s.system }} <small>{{ s.count.toLocaleString('ar-SA') }}</small></li>
    </ul>
    <h4>موظفون تجريبيون لتجربة كل دور</h4>
    <p class="muted small">انسخ كلمة المرور الآن، فلن تظهر مرة أخرى. يدخلون من <code dir="ltr">{{ origin }}/o/{{ slug }}</code></p>
    <div class="table-wrap">
      <table class="table">
        <tr v-for="s in result.staff" :key="s.email"><td>{{ s.role }}</td><td dir="ltr"><code>{{ s.email }}</code></td></tr>
        <tr><td>كلمة المرور للكل</td><td dir="ltr"><code>{{ result.staffPassword }}</code></td></tr>
      </table>
    </div>
    <h4>مستفيدون تجريبيون في بوابة المستفيدين</h4>
    <p class="muted small">يدخلون من <code dir="ltr">{{ origin }}/portal/{{ slug }}</code> برقم الهوية</p>
    <div class="table-wrap">
      <table class="table">
        <tr v-for="p in result.portalUsers" :key="p.nationalId"><td>{{ p.fullName }}</td><td dir="ltr"><code>{{ p.nationalId }}</code></td></tr>
        <tr><td>كلمة المرور للكل</td><td dir="ltr"><code>{{ result.portalPassword }}</code></td></tr>
      </table>
    </div>
    <template v-if="result.supplierPortal?.users.length">
      <h4>موردون تجريبيون في بوابة الموردين</h4>
      <p class="muted small">يدخلون من <code dir="ltr">{{ origin }}/supplier/{{ slug }}</code> بالبريد الإلكتروني</p>
      <div class="table-wrap">
        <table class="table">
          <tr v-for="u in result.supplierPortal.users" :key="u.email"><td>{{ u.supplier }} <small class="muted">({{ u.status }})</small></td><td dir="ltr"><code>{{ u.email }}</code></td></tr>
          <tr><td>كلمة المرور للكل</td><td dir="ltr"><code>{{ result.portalPassword }}</code></td></tr>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.lead { margin: 0 0 10px; }
.chips { list-style: none; padding: 0; margin: 0 0 14px; display: flex; flex-wrap: wrap; gap: 6px; }
.chips li { background: var(--primary-soft); color: var(--primary); border-radius: 99px; padding: 4px 12px; font-size: .88rem; }
.chips small { opacity: .7; margin-inline-start: 4px; }
h4 { margin: 14px 0 4px; }
.small { font-size: .86rem; }
code { word-break: break-all; }
</style>
