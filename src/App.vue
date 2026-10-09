<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { readKeys, saveKey, forgetKey, type SavedKey } from "./keys";
import { walletMessage } from "./wallet-language";
import donguriIcon from "./assets/acorn-icon-96.png";
import MaterialIcon from "./components/MaterialIcon.vue";
const route = useRoute(),
  router = useRouter();
const page = computed(() => route.path.slice(1) || "home"),
  key = computed(() =>
    typeof route.query.k === "string" ? route.query.k : "",
  );
const saved = ref(readKeys()),
  data = ref<any>(null),
  entries = ref<any[]>([]),
  cursor = ref<string | null>(null),
  loading = ref(false),
  busy = ref(false),
  error = ref(""),
  notice = ref("");
const bankName = ref(""),
  currencyName = ref(""),
  unit = ref(""),
  walletName = ref(""),
  toId = ref(""),
  amount = ref(""),
  memo = ref("");
const share = ref<{
  type: "bank" | "wallet";
  token: string;
  name: string;
} | null>(null);
const kanjiEnabled = computed(() => data.value?.wallet?.kanjiEnabled !== false);
const easy = computed(
  () => page.value === "wallet" && (!data.value || !kanjiEnabled.value),
);
const words = (normal: string, simple: string) =>
  easy.value ? simple : normal;
const historyBalanceMax = computed(() =>
  entries.value.reduce(
    (max, entry) => Math.max(max, entry.balanceAfter ?? 0),
    0,
  ),
);
function historyBalanceWidth(entry: { balanceAfter?: number }) {
  return historyBalanceMax.value > 0
    ? `${(Math.max(0, entry.balanceAfter ?? 0) / historyBalanceMax.value) * 100}%`
    : "0%";
}
const message = (value: string) => (easy.value ? walletMessage(value) : value);
const toast = ref("");
type ToastType = "success" | "error" | "warning" | "info";
const toastType = ref<ToastType>("success");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(message: string, type: ToastType = "success") {
  clearTimeout(toastTimer);
  toastType.value = type;
  toast.value = message;
  toastTimer = setTimeout(() => {
    toast.value = "";
  }, 3000);
}
onUnmounted(() => clearTimeout(toastTimer));
let pending: { signature: string; id: string } | null = null;
const money = (n: number) => n.toLocaleString("ja-JP");
const date = (s: string) => new Date(s).toLocaleString("ja-JP");
const url = (type: string, token: string) =>
  `${location.origin}/${type}?k=${encodeURIComponent(token)}`;
async function api(path: string, body?: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key.value ? { Authorization: `Bearer ${key.value}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "処理に失敗しました。");
  return result;
}
function remember(item: SavedKey) {
  if (!saveKey(item))
    showToast(
      "このブラウザに保存できませんでした。秘密URLをコピーして大切に保管してください。",
      "warning",
    );
  saved.value = readKeys();
}
async function history(more = false) {
  const result = await api(
    `wallet/history${more && cursor.value ? `?cursor=${encodeURIComponent(cursor.value)}` : ""}`,
  );
  entries.value = more ? [...entries.value, ...result.entries] : result.entries;
  cursor.value = result.nextCursor;
}
let loadVersion = 0;
async function load() {
  const version = ++loadVersion;
  data.value = null;
  entries.value = [];
  error.value = "";
  notice.value = "";
  share.value = null;
  toId.value = "";
  pending = null;
  if (page.value === "home") return;
  loading.value = true;
  try {
    const type = page.value;
    if (!["bank", "wallet"].includes(type)) return;
    const result = await api(type);
    if (version !== loadVersion) return;
    data.value = result;
    remember({
      type: type as "bank" | "wallet",
      token: key.value,
      name: type === "bank" ? result.bank.name : result.wallet.name,
    });
    if (type === "wallet") await history();
  } catch (e) {
    if (version === loadVersion) error.value = (e as Error).message;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}
watch(() => route.fullPath, load, { immediate: true });
watch(
  () =>
    (page.value === "bank"
      ? data.value?.bank?.name
      : page.value === "wallet"
        ? data.value?.wallet?.name
        : null) ?? "おてつだいウォレット",
  (title) => {
    document.title = title;
  },
  { immediate: true },
);
async function act(task: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await task();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function createBank() {
  await act(async () => {
    const result = await api("banks", {
      name: bankName.value,
      currencyName: currencyName.value,
      unit: unit.value,
    });
    await router.push({ path: "/bank", query: { k: result.token } });
    share.value = { type: "bank", ...result };
  });
}
async function createWallet() {
  await act(async () => {
    const result = await api("bank/wallets", { name: walletName.value });
    share.value = { type: "wallet", ...result };
    walletName.value = "";
    await nextTick();
    window.scrollTo({ top: 0, behavior: "smooth" });
    data.value = await api("bank");
  });
}
async function send() {
  await act(async () => {
    const payload = {
      toId: toId.value,
      amount: Number(amount.value),
      memo: memo.value,
    };
    const signature = JSON.stringify(payload);
    if (!pending || pending.signature !== signature)
      pending = { signature, id: crypto.randomUUID() };
    await api(page.value === "bank" ? "bank/issue" : "wallet/transfer", {
      ...payload,
      requestId: pending.id,
    });
    pending = null;
    amount.value = "";
    memo.value = "";
    showToast(
      page.value === "bank" ? "通貨を発行して送りました" : "送金しました",
    );
    data.value = await api(page.value);
    if (page.value === "wallet") await history();
  });
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    showToast("秘密URLをコピーしました");
  } catch {
    showToast(
      "コピーできませんでした。URL欄を選択してコピーしてください。",
      "error",
    );
  }
}
async function copyWallet(id: string) {
  await act(async () => {
    const result = await api(`bank/wallets/${encodeURIComponent(id)}/key`);
    await copy(url("wallet", result.token));
  });
}
async function refreshWallet() {
  await act(async () => {
    data.value = await api("wallet");
    await history();
    showToast("残高と履歴を更新しました", "info");
  });
}
async function toggleKanji() {
  const enabled = !kanjiEnabled.value;
  await act(async () => {
    const result = await api("wallet/settings", { kanjiEnabled: enabled });
    data.value.wallet.kanjiEnabled = result.kanjiEnabled;
    showToast("かんじの設定を保存しました");
  });
}
function forget(token: string) {
  if (!forgetKey(token))
    showToast("ブラウザの保存情報を更新できませんでした。", "warning");
  saved.value = readKeys();
}
</script>

<template>
  <header>
    <RouterLink to="/" class="brand"
      ><img
        :src="donguriIcon"
        class="brand-icon"
        alt=""
        width="42"
        height="42"
      /><span
        >おてつだいウォレット<small>Otetsudai Wallet</small></span
      ></RouterLink
    ><span class="header-note">{{
      words(
        "「ありがとう」を、わが家のコインで。",
        "「ありがとう」を、わがやのコインで。",
      )
    }}</span>
  </header>
  <Transition name="toast"
    ><div
      v-if="toast"
      class="toast"
      :class="`toast-${toastType}`"
      :role="toastType === 'error' ? 'alert' : 'status'"
    >
      {{ message(toast) }}
    </div></Transition
  >
  <main>
    <div v-if="error" class="message error" role="alert">
      {{ message(error) }}
    </div>
    <div v-if="notice" class="message" role="status">{{ message(notice) }}</div>
    <template v-if="page === 'home'">
      <section class="hero">
        <span class="eyebrow">家族だけの小さな銀行</span>
        <h1>「ありがとう」が<br />貯まるウォレット。</h1>
        <div class="hero-card">
          <span>たとえば、今日のおてつだい</span
          ><strong>+30 <small>DNG</small></strong
          ><span>おふろ洗い → 太郎のウォレット</span>
        </div>
      </section>
      <div class="columns">
        <section class="panel">
          <span class="eyebrow">はじめての方へ</span>
          <h2>新しい銀行を作る</h2>
          <p>銀行と通貨に名前をつけたら、すぐに始められます。</p>
          <form @submit.prevent="createBank">
            <label
              >銀行名<input
                v-model="bankName"
                required
                maxlength="40"
                placeholder="クヌギ銀行" /></label
            ><label
              >通貨名<input
                v-model="currencyName"
                required
                maxlength="40"
                placeholder="ドングリ" /></label
            ><label
              >通貨単位<input
                v-model="unit"
                required
                maxlength="12"
                placeholder="DNG"
              /><small>金額のあとに表示する名前です。</small></label
            ><button :disabled="busy">
              {{ busy ? "作成中…" : "銀行を作る" }}
            </button>
          </form>
        </section>
        <div>
          <section
            v-for="type in ['bank', 'wallet'] as const"
            :key="type"
            class="panel saved"
          >
            <h2>
              このブラウザの{{ type === "bank" ? "銀行" : "ウォレット" }}
              <MaterialIcon
                :name="
                  type === 'bank' ? 'account_balance' : 'account_balance_wallet'
                "
              />
            </h2>
            <p v-if="!saved.some((x) => x.type === type)" class="empty">
              まだ保存されていません。<br />秘密URLを開くと、ここに表示されます。
            </p>
            <div
              v-for="item in saved.filter((x) => x.type === type)"
              :key="item.token"
              class="saved-row"
            >
              <RouterLink :to="{ path: `/${type}`, query: { k: item.token } }"
                >{{ item.name }} <span>開く →</span></RouterLink
              ><button class="text-button" @click="forget(item.token)">
                一覧から外す
              </button>
            </div>
          </section>
          <p class="storage-note">
            アクセスした銀行とウォレットの鍵は、このブラウザに保存されます。家族以外と共有する端末では、利用後に一覧から外してください。ブラウザのデータを消すと保存した鍵も消えます。
          </p>
        </div>
      </div>
    </template>
    <p v-else-if="loading" class="panel" role="status">
      {{ words("読み込み中…", "よみこみちゅう…") }}
    </p>
    <template v-else-if="data">
      <div class="page-title" :class="{ 'wallet-title': page === 'wallet' }">
        <div>
          <span class="eyebrow"
            >{{ page === "bank" ? "銀行の管理" : "マイウォレット" }} ·
            {{ data.bank.currencyName }}</span
          >
          <h1>
            <MaterialIcon
              :name="page === 'bank' ? 'account_balance' : 'account_balance_wallet'"
            />
            <span>{{ page === "bank" ? data.bank.name : data.wallet.name }}</span>
          </h1>
        </div>
        <RouterLink v-if="page === 'bank'" to="/">トップへ戻る</RouterLink>
        <div v-if="page === 'wallet'" class="language-setting">
          <span id="kanji-label">かんじ</span>
          <button
            type="button"
            role="switch"
            aria-labelledby="kanji-label"
            :aria-checked="kanjiEnabled"
            :disabled="busy"
            class="kanji-switch"
            @click="toggleKanji"
          >
            <span class="switch-knob"></span
            ><span class="switch-state">{{ kanjiEnabled ? "ON" : "OFF" }}</span>
          </button>
        </div>
      </div>
      <section v-if="share" class="panel key-panel">
        <h2>
          {{
            share.type === "bank"
              ? "銀行ができました。秘密URLを保存しましょう"
              : `「${share.name}」のウォレットができました`
          }}
        </h2>
        <template v-if="share.type === 'bank'"
          ><p>
            このURLは、銀行を管理するための<strong>大切な鍵</strong>です。ログイン機能がないため、URLを失うと銀行にアクセスできなくなります。
          </p>
          <p>
            このURLを知っている人は銀行を管理できます。<strong>他人には共有しないでください。</strong>このブラウザにはアクセス情報を自動保存します。念のため、URLも大切に保管してください。
          </p></template
        >
        <p v-else>
          このURLを家族に渡してください。開いた人は、このウォレットの残高を見たり送金したりできます。銀行の秘密URLは渡さないでください。
        </p>
        <label
          >秘密URL<input
            readonly
            :value="url(share.type, share.token)"
            @focus="($event.target as HTMLInputElement).select()" /></label
        ><button @click="copy(url(share.type, share.token))">
          URLをコピーする
        </button>
      </section>
      <div v-if="page === 'bank'" class="columns">
        <div>
          <section class="panel">
            <h2>家族のウォレット</h2>
            <p v-if="!data.wallets.length" class="empty">
              まずは家族のウォレットを作りましょう。
            </p>
            <div v-for="w in data.wallets" :key="w.id" class="wallet-row">
              <div class="wallet-name">
                <span>{{ w.name }}</span
                ><button
                  class="text-button"
                  :disabled="busy || !w.hasSecretUrl"
                  @click="copyWallet(w.id)"
                >
                  {{
                    w.hasSecretUrl
                      ? "秘密URLをコピー"
                      : "旧方式のためURL再表示不可"
                  }}
                </button>
              </div>
              <strong
                >{{ money(w.balance) }}
                <small>{{ data.bank.unit }}</small></strong
              >
            </div>
            <form @submit.prevent="createWallet">
              <label
                >新しいウォレットの名前<input
                  v-model="walletName"
                  required
                  maxlength="40"
                  placeholder="たろうのウォレット" /></label
              ><button :disabled="busy">ウォレットを作る</button>
            </form>
            <small
              >ウォレットの秘密URLは、この一覧からいつでもコピーできます。</small
            >
          </section>
          <section class="panel">
            <h2>銀行の鍵を保管する</h2>
            <p>銀行の秘密URLは、信頼できる管理者だけが保管してください。</p>
            <label
              >銀行の秘密URL<input
                readonly
                :value="url('bank', key)"
                @focus="($event.target as HTMLInputElement).select()" /></label
            ><button class="secondary" @click="copy(url('bank', key))">
              秘密URLをコピー
            </button>
          </section>
        </div>
        <section class="panel">
          <h2>通貨を発行して送る</h2>
          <p>
            選んだウォレットに、新しい{{ data.bank.currencyName }}を発行します。
          </p>
          <form @submit.prevent="send">
            <label
              >送り先<select v-model="toId" required>
                <option disabled value="">ウォレットを選択</option>
                <option v-for="w in data.wallets" :key="w.id" :value="w.id">
                  {{ w.name }}
                </option>
              </select></label
            ><label
              >金額（{{ data.bank.unit }}）<input
                v-model="amount"
                type="number"
                min="1"
                max="1000000000000"
                step="1"
                required
                inputmode="numeric" /></label
            ><label>メモ<input v-model="memo" maxlength="200" /></label
            ><button :disabled="busy || !data.wallets.length">
              {{ busy ? "処理中…" : "発行して送る" }}
            </button>
          </form>
        </section>
      </div>
      <template v-else
        ><section class="balance-card">
          <div class="balance-header">
            <span>{{ words("いまの残高", "いまのコイン") }}</span
            ><button
              class="refresh-button"
              :disabled="busy"
              @click="refreshWallet"
            >
              {{
                busy
                  ? words("更新中…", "まってね…")
                  : words("残高を更新", "よみなおす")
              }}
              <MaterialIcon name="sync" />
            </button>
          </div>
          <strong
            >{{ money(data.wallet.balance) }}
            <small>{{ data.bank.unit }}</small></strong
          ><span>{{ data.bank.name }} · {{ data.bank.currencyName }}</span>
        </section>
        <div class="columns">
          <section class="panel">
            <h2>{{ words("家族に送る", "かぞくにおくる") }}</h2>
            <p v-if="!data.wallets.length">
              {{
                words(
                  "送金先のウォレットがまだありません。銀行の管理者に作ってもらいましょう。",
                  "おくるあいてがまだいません。おうちのひとにウォレットをつくってもらいましょう。",
                )
              }}
            </p>
            <form
              @submit.prevent="send"
              @invalid.capture.prevent="
                error = words(
                  '送り先と金額を確認してください。',
                  'おくるあいてとコインのかずをたしかめてください。',
                )
              "
            >
              <label
                >{{ words("送り先", "おくるあいて")
                }}<select v-model="toId" required>
                  <option disabled value="">
                    {{ words("ウォレットを選択", "ウォレットをえらぶ") }}
                  </option>
                  <option v-for="w in data.wallets" :key="w.id" :value="w.id">
                    {{ w.name }}
                  </option>
                </select></label
              ><label
                >{{ words("金額", "コインのかず") }}（{{
                  data.bank.unit
                }}）<input
                  v-model="amount"
                  type="number"
                  min="1"
                  :max="data.wallet.balance"
                  step="1"
                  required
                  inputmode="numeric" /></label
              ><label>メモ<input v-model="memo" maxlength="200" /></label
              ><button
                :disabled="busy || !data.wallets.length || !data.wallet.balance"
              >
                {{
                  busy
                    ? words("処理中…", "まってね…")
                    : words("送金する", "おくる")
                }}
              </button>
            </form>
            <label class="share-label"
              >{{
                words("このウォレットの秘密URL", "このウォレットのひみつのURL")
              }}<input
                readonly
                :value="url('wallet', key)"
                @focus="($event.target as HTMLInputElement).select()" /></label
            ><button class="secondary" @click="copy(url('wallet', key))">
              URLをコピー
            </button>
          </section>
          <section class="panel">
            <h2>{{ words("入出金の履歴", "コインのきろく") }}</h2>
            <p v-if="!entries.length" class="empty">
              {{ words("まだ履歴がありません。", "まだきろくがありません。")
              }}<br />{{
                words(
                  "おてつだいをしてコインを貰いましょう。",
                  "おてつだいをしてコインをもらいましょう。",
                )
              }}
            </p>
            <article
              v-for="entry in entries"
              :key="entry.transactionId"
              class="entry"
              :style="{ '--entry-balance-width': historyBalanceWidth(entry) }"
            >
              <div>
                <span class="tag">{{
                  entry.amount > 0
                    ? words("入金", "もらった")
                    : words("出金", "おくった")
                }}</span
                ><strong :class="{ positive: entry.amount > 0 }"
                  >{{ entry.amount > 0 ? "+" : "" }}{{ money(entry.amount) }}
                  <small>{{ data.bank.unit }}</small></strong
                >
              </div>
              <p>
                {{ entry.counterparty }}{{ entry.amount > 0 ? "から" : "へ"
                }}<br /><span>{{ entry.memo || "メモなし" }}</span>
              </p>
              <time>{{ date(entry.at) }}</time>
            </article>
            <button
              v-if="cursor"
              class="secondary"
              :disabled="busy"
              @click="act(() => history(true))"
            >
              {{ words("以前の履歴を見る", "まえのきろくをみる") }}
            </button>
          </section>
        </div></template
      >
    </template>
    <p v-else-if="page !== 'home'">
      {{
        words(
          "保存した秘密URLからアクセスしてください。",
          "しまっておいたひみつのURLをひらいてください。",
        )
      }}
      <RouterLink to="/">{{
        words("トップへ戻る", "トップへもどる")
      }}</RouterLink>
    </p>
  </main>
  <footer>
    おてつだいウォレット
    <span><a href="https://anipopina.com">anipopina.com</a></span>
  </footer>
</template>
