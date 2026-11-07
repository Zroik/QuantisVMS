<template>
  <div v-if="socketStore.systemAlerts.length > 0" class="sys-alerts" role="region" aria-label="Peringatan Sistem">
    <div
      v-for="alert in socketStore.systemAlerts"
      :key="alert.id"
      class="sys-alert-banner"
      :class="alert.level"
      role="alert"
    >
      <div class="sys-alert-body">
        <strong>[{{ alert.type }}]</strong>
        <span>{{ alert.message }}</span>
      </div>
      <button type="button" class="sys-alert-close" @click="socketStore.dismissAlert(alert.id)" aria-label="Tutup">
        ×
      </button>
    </div>
  </div>
  <router-view />
</template>

<script setup lang="ts">
import { useSocketStore } from "./stores/socket.js";

const socketStore = useSocketStore();
</script>

<style scoped>
.sys-alerts {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 420px;
}
.sys-alert-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(24, 24, 28, 0.94);
  color: #f8fafc;
  border: 1px solid rgba(245, 158, 11, 0.45);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  font-size: 13px;
}
.sys-alert-banner.critical,
.sys-alert-banner.error {
  border-color: rgba(239, 68, 68, 0.65);
}
.sys-alert-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sys-alert-close {
  background: transparent;
  border: 0;
  color: #94a3b8;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}
</style>
