<script setup lang="ts">
import { formatGreeting } from "./greeting";

const props = defineProps<{ name: string }>();
</script>

<template>
  <p>{{ formatGreeting(props.name) }}</p>
</template>
