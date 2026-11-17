<script setup lang="ts">
import '../modules/platform/platform.css';
import ReportsHub from '../components/reports/ReportsHub.vue';
import SupportReport from './SupportReport.vue';
</script>

<template>
  <ReportsHub module="support" system="الدعم الفني" :overview="SupportReport" overview-label="لوحة الالتزام بمستويات الخدمة"
    intro="تقارير طلبات الصيانة والالتزام بالمهل وأداء الفريق والمهام، قابلة للتصدير إلى PDF وExcel." />
</template>
