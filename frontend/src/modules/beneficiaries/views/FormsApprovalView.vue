<script setup lang="ts">
import FormsPane from '../components/settings/FormsPane.vue';
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h1>اعتماد النماذج</h1>
        <p class="muted sub">مسار ضبط الوثائق (ISO 9001): إنشاء ← مراجعة الجودة ← اعتماد مدير الشاشة</p>
      </div>
    </div>
    <FormsPane mode="approval" />
  </div>
</template>
