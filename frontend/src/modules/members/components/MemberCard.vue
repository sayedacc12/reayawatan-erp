<script setup lang="ts">
import BrandMark from '../../../components/BrandMark.vue';
import { fmtDate, type CardData } from '../lib';

/** بطاقة العضوية (للعرض والطباعة) */

defineProps<{ card: CardData; photo?: string | null }>();
</script>

<template>
  <div :class="['mb-card', { invalid: !card.valid }]" :style="{ '--c': card.typeColor }">
    <div class="top">
      <div style="display: flex; gap: 10px; align-items: center"><BrandMark :size="30" /><div><div class="org">{{ card.orgName }}</div><div class="ttl">{{ card.title }}</div></div></div>
      <img v-if="photo" :src="photo" class="photo" alt="" />
      <span v-else class="type">{{ card.typeName }}</span>
    </div>
    <div>
      <div class="name">{{ card.fullName }}</div>
      <div class="no">{{ String(card.memberNo).padStart(5, '0') }}</div>
    </div>
    <div class="row">
      <span>نوع العضوية<b>{{ card.typeName }}</b></span>
      <span>عضو منذ<b>{{ fmtDate(card.joinedOn) }}</b></span>
      <span>صالحة حتى<b>{{ fmtDate(card.endDate) }}</b></span>
    </div>
    <div class="row" style="align-items: center">
      <span>{{ card.valid ? (card.voting ? 'له حق التصويت' : 'عضوية سارية') : card.statusLabel }}</span>
      <span>رمز التحقق <b style="display: inline; direction: ltr; font-family: ui-monospace, monospace">{{ card.cardCode }}</b></span>
    </div>
  </div>
</template>
