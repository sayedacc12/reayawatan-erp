<script setup lang="ts">
import ReportsHub from '../../../components/reports/ReportsHub.vue';
import SubscriptionsOverview from './SubscriptionsOverview.vue';
</script>

<template>
  <ReportsHub module="platform" system="إدارة المنصة" :overview="SubscriptionsOverview" overview-label="لوحة الاشتراكات"
    intro="تقارير الجمعيات والاشتراكات والطلبات والعقود، قابلة للتصدير إلى PDF وExcel، مع لوحة مؤشرات الاشتراكات." />
</template>
