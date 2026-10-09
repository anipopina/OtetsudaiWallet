<script setup lang="ts">
import accountBalance from "../assets/material-icons/account_balance.svg?raw";
import accountBalanceWallet from "../assets/material-icons/account_balance_wallet.svg?raw";
import sync from "../assets/material-icons/sync.svg?raw";

import savings from "../assets/material-icons/savings.svg?raw";

const icons = {
  savings,
  account_balance: accountBalance,
  account_balance_wallet: accountBalanceWallet,
  sync,
};
defineProps<{ name: keyof typeof icons }>();
</script>

<template>
  <!-- Only bundled Google SVG assets are rendered; icons are decorative. -->
  <span class="material-icon" aria-hidden="true" v-html="icons[name]"></span>
</template>

<style scoped>
.material-icon {
  display: inline-flex;
  width: 1em;
  height: 1em;
  flex-shrink: 0;
  vertical-align: -0.15em;
}
.material-icon :deep(svg) {
  width: 100%;
  height: 100%;
  fill: currentColor;
}
</style>
