<template>
  <main class="pane">
    <div class="tools-bar">
      <button
        type="button"
        class="tb lang"
        :aria-label="t('nav.lang')"
        @click="toggleLang"
      >
        {{ locale.toUpperCase() }}
      </button>

      <button
        type="button"
        class="tb"
        id="theme"
        :aria-label="t('nav.theme')"
        @click="handleToggleTheme"
      >
        <svg class="sun" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4" />
        </svg>
        <svg class="moon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      </button>
    </div>

    <div class="bezel">
      <div class="core">
        <header class="hd rise" style="--i:0">
          <h1>{{ t('login.header') }}</h1>
          <p class="sub">{{ t('login.sub') }}</p>
        </header>

        <form id="login" novalidate @submit.prevent="handleLogin">
          <div class="fld rise" style="--i:1">
            <label class="eb" for="u">{{ t('login.username') }}</label>
            <input
              id="u"
              ref="usernameInput"
              v-model="username"
              name="username"
              type="text"
              placeholder="admin"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              enterkeyhint="next"
              :aria-invalid="isUsernameInvalid ? 'true' : undefined"
              @input="clearError"
              required
            />
          </div>

          <div class="fld rise" style="--i:2">
            <div class="lab">
              <label class="eb" for="p">{{ t('login.password') }}</label>
              <small class="caps" id="caps" :hidden="!isCapsLock">{{ t('login.capsLock') }}</small>
            </div>
            <div class="pw">
              <input
                id="p"
                ref="passwordInput"
                v-model="password"
                name="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="••••••••"
                autocomplete="current-password"
                enterkeyhint="go"
                :aria-invalid="isPasswordInvalid ? 'true' : undefined"
                @input="clearError"
                @keydown="checkCapsLock"
                @keyup="checkCapsLock"
                @blur="isCapsLock = false"
                required
              />
              <button
                type="button"
                class="eye"
                id="eye"
                :aria-label="showPassword ? t('login.hidePassword') : t('login.showPassword')"
                :aria-pressed="showPassword ? 'true' : 'false'"
                @click="showPassword = !showPassword"
              >
                <svg class="on" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />
                </svg>
                <svg class="off" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A16.6 16.6 0 002 12s3.6 7 10 7a9.7 9.7 0 004.4-1M9.9 9.9a3 3 0 004.2 4.2" />
                </svg>
              </button>
            </div>
          </div>

          <div class="act rise" style="--i:3">
            <p class="msg" id="msg" role="alert" :hidden="!errorMessage">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v4M12 16h.01" />
              </svg>
              <span id="msgt">{{ errorMessage }}</span>
            </p>
            <button
              type="submit"
              class="btn"
              id="go"
              :aria-busy="authStore.isLoading ? 'true' : 'false'"
              :aria-disabled="authStore.isLoading ? 'true' : 'false'"
            >
              <span id="lbl">{{ authStore.isLoading ? t('login.loading') : t('login.submit') }}</span>
              <span class="go" aria-hidden="true">
                <svg class="arrow" viewBox="0 0 24 24">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <svg class="spin" viewBox="0 0 24 24">
                  <path d="M12 3a9 9 0 019 9" />
                </svg>
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth.js";
import { useThemeStore } from "../stores/theme.js";
import { useI18n, type SupportedLocale } from "../i18n/index.js";

const router = useRouter();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const { t, locale, setLocale } = useI18n();

const toggleLang = () => {
  const next: SupportedLocale = locale.value === "id" ? "en" : "id";
  setLocale(next);
};

const username = ref("");
const password = ref("");
const showPassword = ref(false);
const isCapsLock = ref(false);
const errorMessage = ref("");
const isUsernameInvalid = ref(false);
const isPasswordInvalid = ref(false);

const usernameInput = ref<HTMLInputElement | null>(null);
const passwordInput = ref<HTMLInputElement | null>(null);

const handleToggleTheme = (event: MouseEvent) => {
  themeStore.toggleTheme(event);
};

const checkCapsLock = (event: KeyboardEvent) => {
  if (typeof event.getModifierState === "function") {
    isCapsLock.value = event.getModifierState("CapsLock");
  }
};

const clearError = () => {
  errorMessage.value = "";
  isUsernameInvalid.value = false;
  isPasswordInvalid.value = false;
  authStore.error = null;
};

const handleLogin = async () => {
  if (authStore.isLoading) return;
  clearError();

  const trimmedUsername = username.value.trim();
  if (!trimmedUsername) {
    errorMessage.value = t("login.enterUsername");
    isUsernameInvalid.value = true;
    usernameInput.value?.focus();
    return;
  }

  if (!password.value) {
    errorMessage.value = t("login.enterPassword");
    isPasswordInvalid.value = true;
    passwordInput.value?.focus();
    return;
  }

  const success = await authStore.login(trimmedUsername, password.value);
  if (success) {
    router.push({ name: "live" });
  } else {
    errorMessage.value = authStore.error || t("login.invalidCredentials");
    isPasswordInvalid.value = true;
    passwordInput.value?.select();
  }
};
</script>

<style scoped>
.pane {
  min-height: 100dvh;
  display: grid;
  place-items: center;
  background: var(--bg);
  color: var(--tx);
  font-family: var(--f);
  font-size: var(--fs-md);
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  padding: calc(72px + env(safe-area-inset-top, 0px)) 16px calc(72px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}

.pane * {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

button {
  cursor: pointer;
  background: none;
  border: 0;
  font: inherit;
  color: inherit;
}

input {
  font: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--iris);
  outline-offset: 2px;
}

.eb {
  color: var(--mu);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: .06em;
  text-transform: uppercase;
}

/* Entrance: chunk per elemen, stagger, hanya opacity + transform */
.rise {
  animation: up .5s var(--ease) both;
  animation-delay: calc(var(--i, 0) * 70ms);
}

@keyframes up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

/* Floating bottom-left tools (Language & Theme toggle) */
.tools-bar {
  position: fixed;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  inset-inline-start: calc(12px + env(safe-area-inset-left, 0px));
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
}

.tb {
  width: 44px;
  height: 44px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--mu);
  font-family: var(--f);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .06em;
  transition: background-color .15s, color .15s, transform .12s;
}

.tb.lang {
  border: 1px solid var(--line);
  background: var(--card);
}

.tb:active {
  transform: scale(.96);
}

.tb svg {
  grid-area: 1/1;
  transition: opacity .2s cubic-bezier(.2, 0, 0, 1), scale .2s cubic-bezier(.2, 0, 0, 1), filter .2s cubic-bezier(.2, 0, 0, 1);
  fill: none;
  stroke: currentColor;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
  display: block;
  width: 18px;
  height: 18px;
}

.tb .moon {
  opacity: 0;
  scale: .25;
  filter: blur(4px);
}

:root[data-theme=dark] .tb .sun,
:root.dark .tb .sun {
  opacity: 0;
  scale: .25;
  filter: blur(4px);
}

:root[data-theme=dark] .tb .moon,
:root.dark .tb .moon {
  opacity: 1;
  scale: 1;
  filter: none;
}

@media (hover: hover) {
  .tb:hover {
    background: var(--well);
    color: var(--tx);
  }
}

/* Double-bezel: radius luar 30 = radius dalam 24 + padding 6 */
.bezel {
  width: 100%;
  max-width: 420px;
  padding: 6px;
  border-radius: 30px;
  background: var(--glass);
  box-shadow: 0 0 0 1px var(--rim), var(--sh);
}

.core {
  border-radius: 24px;
  background: var(--raised);
  box-shadow: 0 0 0 1px var(--line);
  padding: 28px;
}

.hd {
  display: grid;
  gap: 6px;
  margin-bottom: 28px;
}

h1 {
  font-size: var(--fs-h1);
  font-weight: 600;
  letter-spacing: -.02em;
  line-height: 1.15;
  text-wrap: balance;
  color: var(--tx);
}

.sub {
  color: var(--mu);
  font-size: var(--fs-md);
  text-wrap: pretty;
}

form {
  display: grid;
  gap: 16px;
}

.fld {
  display: grid;
  gap: 8px;
}

.lab {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.caps {
  color: var(--err);
  font-size: var(--fs-xs);
  font-weight: 600;
}

input {
  width: 100%;
  height: 48px;
  padding: 0 18px;
  border: 0;
  border-radius: 999px;
  background: var(--well);
  color: var(--tx);
  font-size: 16px;
  font-weight: 500;
  box-shadow: inset 0 0 0 1px transparent;
  transition: box-shadow .15s, background-color .15s;
}

input::placeholder {
  color: var(--mu);
  opacity: 1;
}

input[aria-invalid=true] {
  box-shadow: inset 0 0 0 1px var(--err);
}

.pw {
  position: relative;
}

.pw input {
  padding-inline-end: 56px;
}

.eye {
  position: absolute;
  inset-block: 4px;
  inset-inline-end: 4px;
  width: 40px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--mu);
  transition: background-color .15s, color .15s, transform .12s;
}

.eye:active {
  transform: scale(.96);
}

.eye svg {
  grid-area: 1/1;
  transition: opacity .2s cubic-bezier(.2, 0, 0, 1), scale .2s cubic-bezier(.2, 0, 0, 1), filter .2s cubic-bezier(.2, 0, 0, 1);
  fill: none;
  stroke: currentColor;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
  display: block;
  width: 18px;
  height: 18px;
}

.eye .off,
.eye[aria-pressed=true] .on {
  opacity: 0;
  scale: .25;
  filter: blur(4px);
}

.eye[aria-pressed=true] .off {
  opacity: 1;
  scale: 1;
  filter: none;
}

@media (hover: hover) {
  .eye:hover {
    background: var(--well);
    color: var(--tx);
  }
}

.act {
  margin-top: 8px;
}

.msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--err);
  font-size: var(--fs-sm);
  font-weight: 600;
}

.msg svg {
  width: 16px;
  height: 16px;
  margin-top: 2px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}

.btn {
  position: relative;
  width: 100%;
  height: 48px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--oi);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 52px;
  transition: transform .12s, opacity .15s;
}

.btn:active {
  transform: scale(.96);
}

.btn[aria-busy=true] {
  pointer-events: none;
  opacity: .8;
}

.go {
  position: absolute;
  inset-block: 6px;
  inset-inline-end: 6px;
  width: 36px;
  border-radius: 50%;
  background: var(--go);
  display: grid;
  place-items: center;
}

.go svg {
  grid-area: 1/1;
  transition: opacity .2s cubic-bezier(.2, 0, 0, 1), translate .15s var(--ease);
  fill: none;
  stroke: currentColor;
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
  display: block;
  width: 18px;
  height: 18px;
}

.go .spin {
  opacity: 0;
  animation: spin .8s linear infinite;
  animation-play-state: paused;
}

.btn[aria-busy=true] .go .arrow {
  opacity: 0;
}

.btn[aria-busy=true] .go .spin {
  opacity: 1;
  animation-play-state: running;
}

@media (hover: hover) {
  .btn:hover .arrow {
    translate: 2px 0;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  *, :before, :after {
    transition: none !important;
    animation: none !important;
  }
}
</style>
