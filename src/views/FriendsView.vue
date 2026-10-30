<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  copyText,
  errText,
  getDirectOverview,
  launchGame,
  prepareDirectJoin,
  resolveDirectInvitation,
  startDirectHost,
  stopDirectHost
} from '@/api'
import { useToastStore } from '@/store/toasts'
import DesktopOnly from '@/ui/primitives/DesktopOnly.vue'
import Empty from '@/ui/primitives/Empty.vue'
import Field from '@/ui/primitives/Field.vue'
import Pick from '@/ui/primitives/Pick.vue'
import Skeleton from '@/ui/primitives/Skeleton.vue'
import TextInput from '@/ui/primitives/TextInput.vue'
import Toggle from '@/ui/primitives/Toggle.vue'
import type { DirectEndpoint, DirectJoinResult, DirectOverview } from '@shared/directConnect'

type ConnectTab = 'direct' | 'voxlink' | 'tc' | 'frp'

const tabs: Array<{ key: ConnectTab; label: string; tag: string }> = [
  { key: 'direct', label: '直连联机', tag: '浏览器可用' },
  { key: 'voxlink', label: 'VoxLink 联机', tag: '桌面版' },
  { key: 'tc', label: '陶瓦联机', tag: '桌面版' },
  { key: 'frp', label: 'FRP 穿透', tag: '桌面版' }
]

const toasts = useToastStore()

const tab = ref<ConnectTab>('direct')
const overview = ref<DirectOverview | null>(null)
const ready = ref(false)
const busy = ref('')

const hostVersion = ref('')
const hostPort = ref('')
const hostUpnp = ref(true)
const hostPublic = ref('')

const joinText = ref('')
const joinVersion = ref('')
const joinResult = ref<DirectJoinResult | null>(null)

const voxRoomName = ref('我的世界联机')
const voxRelay = ref(true)
const voxRoomCode = ref('')
const tcMode = ref<'host' | 'join'>('host')
const tcRoomCode = ref('')
const frpKey = ref('')
const frpTunnel = ref('')

const instances = computed(() => overview.value?.instances ?? [])
const state = computed(() => overview.value?.state ?? null)
const options = computed(() => instances.value.filter((row) => !row.failed).map((row) => ({ value: row.id, label: `${row.id}（${row.mcVersion}）` })))

function endpointText(endpoint: DirectEndpoint): string {
  return `${endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host}:${endpoint.port}`
}

function currentFolder(versionId: string): string {
  return instances.value.find((row) => row.id === versionId)?.folder ?? ''
}

function parsePort(value: string): number | undefined {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return undefined
  return port
}

async function load() {
  overview.value = await getDirectOverview()
  hostVersion.value = instanceDefault()
  ready.value = true
}

function instanceDefault(): string {
  const list = overview.value?.instances ?? []
  return list[0]?.id ?? ''
}

async function startHost() {
  if (!hostVersion.value) {
    toasts.push('请先选择要开放的实例', 'error')
    return
  }
  busy.value = 'host'
  try {
    const next = await startDirectHost({
      versionId: hostVersion.value,
      folder: currentFolder(hostVersion.value),
      port: parsePort(hostPort.value),
      useUpnp: hostUpnp.value,
      publicAddress: hostPublic.value.trim() || undefined
    })
    overview.value = await getDirectOverview()
    toasts.push(next.active ? '房间已开启（浏览器为本地模拟）' : '房间未开启', next.active ? 'ok' : 'error')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = ''
  }
}

async function stopHost() {
  busy.value = 'stop'
  try {
    await stopDirectHost()
    overview.value = await getDirectOverview()
    toasts.push('房间已停止', 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = ''
  }
}

async function copyInvite() {
  const invite = state.value?.invite ?? ''
  if (!invite) return
  toasts.push((await copyText(invite)) ? '邀请码已复制' : '复制失败', 'ok')
}

async function resolve() {
  const text = joinText.value.trim()
  if (!text) {
    toasts.push('请粘贴邀请码', 'error')
    return
  }
  busy.value = 'resolve'
  try {
    joinResult.value = await resolveDirectInvitation(text)
    joinVersion.value = instanceDefault()
    toasts.push('邀请解析成功', 'ok')
  } catch (error) {
    joinResult.value = null
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = ''
  }
}

async function joinGame() {
  if (!joinResult.value) return
  busy.value = 'join'
  try {
    const prep = await prepareDirectJoin(joinText.value.trim(), joinVersion.value, currentFolder(joinVersion.value))
    await launchGame(prep.versionId, prep.address, prep.folder)
    toasts.push(`已准备用 ${prep.versionId} 连接 ${prep.address}（浏览器阶段不会真正拉起游戏）`, 'ok')
  } catch (error) {
    toasts.push(errText(error), 'error')
  } finally {
    busy.value = ''
  }
}

onMounted(load)
</script>

<template>
  <div class="page-head">
    <h1 class="page-title">联机</h1>
    <span class="page-note">与好友一起游玩：直连联机可在浏览器阶段走通流程，其余方式需要桌面版</span>
  </div>

  <div class="tab-bar">
    <button
      v-for="item in tabs"
      :key="item.key"
      class="btn tab"
      :class="{ on: tab === item.key }"
      @click="tab = item.key"
    >
      {{ item.label }}
      <span class="tab-tag">{{ item.tag }}</span>
    </button>
  </div>

  <Skeleton v-if="!ready" :rows="5" />

  <section v-else-if="tab === 'direct'" class="stack">
    <div class="card">
      <div class="panel-head">
        <h2 class="panel-title">直连联机</h2>
        <span class="tag mock">模拟</span>
        <div class="grow" />
        <span v-if="state?.active" class="tag real">房间进行中</span>
      </div>
      <p class="panel-desc">
        房主开放房间并生成邀请码，好友粘贴邀请码后由启动器解析房主地址并进入世界。
        浏览器阶段为本地模拟，真实端口映射（UPnP / FRP）需要桌面版。
      </p>
      <DesktopOnly note="真实端口映射、局域网地址枚举与 UPnP 需要在桌面版执行；浏览器阶段仅模拟流程。" />
      <Empty v-if="!instances.length" text="尚未安装任何实例" note="先到「游戏版本」安装一个实例再来联机。" />
    </div>

    <div v-if="instances.length" class="card">
      <h3 class="panel-title">开启房间</h3>
      <Field title="选择实例" note="作为房主开放的世界所在实例">
        <Pick v-model="hostVersion" :options="options" placeholder="请选择实例" />
      </Field>
      <Field title="端口" note="留空使用默认 25565">
        <TextInput v-model="hostPort" type="number" placeholder="25565" />
      </Field>
      <Field title="使用 UPnP" note="自动尝试在路由器上做端口映射（桌面版生效）">
        <Toggle v-model="hostUpnp" />
      </Field>
      <Field title="公网地址" note="可选：手动填写对外地址，覆盖自动探测结果">
        <TextInput v-model="hostPublic" placeholder="如 example.com 或 1.2.3.4" />
      </Field>
      <div class="ops">
        <button class="btn primary" :disabled="!!busy" @click="startHost">
          {{ busy === 'host' ? '开启中…' : '开启房间' }}
        </button>
        <button v-if="state?.active" class="btn" :disabled="!!busy" @click="stopHost">
          {{ busy === 'stop' ? '停止中…' : '停止房间' }}
        </button>
      </div>
    </div>

    <div v-if="state?.active" class="card">
      <div class="panel-head">
        <h3 class="panel-title">房间状态</h3>
        <div class="grow" />
        <button class="btn" @click="copyInvite">复制邀请</button>
      </div>
      <Field title="邀请码" note="发给好友，让其粘贴到下方「加入房间」">
        <span class="mono invite">{{ state.invite }}</span>
      </Field>
      <Field title="本地端口">
        <span class="mono">{{ state.localPort ?? '—' }}</span>
      </Field>
      <Field title="连接数">
        <span class="mono">{{ state.connections }}</span>
      </Field>
      <Field title="可用地址" stacked>
        <div class="endpoints">
          <span v-for="endpoint in state.endpoints" :key="`${endpoint.host}:${endpoint.port}`" class="tag">
            {{ endpointText(endpoint) }} · {{ endpoint.kind }}
          </span>
          <span v-if="!state.endpoints.length" class="page-note">暂无可用地址</span>
        </div>
      </Field>
      <Field v-if="state.messages.length" title="提示" stacked>
        <ul class="msgs">
          <li v-for="(msg, index) in state.messages" :key="index">{{ msg }}</li>
        </ul>
      </Field>
    </div>

    <div v-if="instances.length" class="card">
      <h3 class="panel-title">加入房间</h3>
      <Field title="邀请码" stacked>
        <TextInput v-model="joinText" placeholder="粘贴 WCL-DIRECT-1 邀请或邀请码文本" />
      </Field>
      <div class="ops">
        <button class="btn" :disabled="!!busy" @click="resolve">
          {{ busy === 'resolve' ? '解析中…' : '解析邀请' }}
        </button>
      </div>
      <template v-if="joinResult">
        <Field title="房主">
          <span>{{ joinResult.invitation.name || '未知' }}</span>
        </Field>
        <Field title="游戏版本">
          <span class="mono">{{ joinResult.invitation.minecraftVersion }}</span>
        </Field>
        <Field title="加载器">
          <span>{{ joinResult.invitation.loader ? `${joinResult.invitation.loader}${joinResult.invitation.loaderVersion ? ` ${joinResult.invitation.loaderVersion}` : ''}` : '原版' }}</span>
        </Field>
        <Field title="可用地址" stacked>
          <div class="endpoints">
            <span v-for="endpoint in joinResult.invitation.endpoints" :key="`${endpoint.host}:${endpoint.port}`" class="tag">
              {{ endpointText(endpoint) }}
            </span>
          </div>
        </Field>
        <Field title="推荐地址" note="解析后优先使用该地址进入">
          <span class="mono">{{ joinResult.endpoint ? endpointText(joinResult.endpoint) : '—' }}</span>
        </Field>
        <Field v-if="joinResult.failures.length" title="解析提示" stacked>
          <ul class="msgs">
            <li v-for="(msg, index) in joinResult.failures" :key="index">{{ msg }}</li>
          </ul>
        </Field>
        <Field title="选择实例" note="将用该实例连接房主世界">
          <Pick v-model="joinVersion" :options="options" placeholder="请选择实例" />
        </Field>
        <div class="ops">
          <button class="btn primary" :disabled="!!busy" @click="joinGame">
            {{ busy === 'join' ? '进入中…' : '启动并进入' }}
          </button>
        </div>
      </template>
    </div>
  </section>

  <section v-else-if="tab === 'voxlink'" class="card">
    <div class="panel-head">
      <h2 class="panel-title">VoxLink 联机</h2>
      <span class="tag desktop">桌面版</span>
    </div>
    <p class="panel-desc">
      通过虚拟局域网与中继服务连接：创建房间后把房间码发给好友，直连尝试一段时间后可由玩家主动选择 TURN 中继，
      连接成功后按指引在游戏内输入地址。
    </p>
    <DesktopOnly note="虚拟局域网、UDP 打洞与中继由 VoxLink 引擎提供，浏览器阶段无法执行。" />
    <Field title="房间名" note="创建房间时展示给好友">
      <TextInput v-model="voxRoomName" placeholder="我的世界联机" />
    </Field>
    <Field title="允许中继" note="直连失败时可回退到 TURN 中继">
      <Toggle v-model="voxRelay" />
    </Field>
    <Field title="加入房间" stacked>
      <TextInput v-model="voxRoomCode" placeholder="粘贴 6 位房间码" />
    </Field>
    <div class="ops">
      <button class="btn primary" disabled>创建房间</button>
      <button class="btn" disabled>加入房间</button>
    </div>
    <Empty text="浏览器阶段不提供房间列表" note="桌面版将展示公共大厅、房间人数与网络类型。" />
  </section>

  <section v-else-if="tab === 'tc'" class="card">
    <div class="panel-head">
      <h2 class="panel-title">陶瓦联机</h2>
      <span class="tag desktop">桌面版</span>
    </div>
    <p class="panel-desc">
      由官方开源工具 Terracotta 驱动：首次使用会下载并校验官方工具，随后创建或加入房间即可开箱即用，
      连接效果取决于双方网络环境。
    </p>
    <DesktopOnly note="工具下载、校验与引擎进程由桌面版管理，浏览器阶段仅展示表单骨架。" />
    <Field title="模式">
      <Pick
        v-model="tcMode"
        :options="[{ value: 'host', label: '创建房间' }, { value: 'join', label: '加入房间' }]"
      />
    </Field>
    <Field v-if="tcMode === 'join'" title="房间号" note="格式如 U/XXXX-XXXX-XXXX-XXXX">
      <TextInput v-model="tcRoomCode" placeholder="U/XXXX-XXXX-XXXX-XXXX" />
    </Field>
    <Field v-else title="本地端口" note="留空使用默认 25565">
      <TextInput v-model="hostPort" type="number" placeholder="25565" />
    </Field>
    <div class="ops">
      <button class="btn primary" disabled>{{ tcMode === 'host' ? '创建房间' : '加入房间' }}</button>
    </div>
    <Empty text="尚未启动陶瓦引擎" note="桌面版将展示工具版本、运行状态与阶段进度。" />
  </section>

  <section v-else class="card">
    <div class="panel-head">
      <h2 class="panel-title">FRP 穿透</h2>
      <span class="tag desktop">桌面版</span>
    </div>
    <p class="panel-desc">
      通过樱花穿透（natfrp）把本地世界映射到公网：填写访问密钥后选择或创建隧道，
      可用性取决于节点、账号权限与网络环境。
    </p>
    <DesktopOnly note="隧道创建与 frpc 连接由桌面版执行，浏览器阶段仅展示表单骨架。" />
    <Field title="访问密钥" note="樱花穿透账号的 AccessKey">
      <TextInput v-model="frpKey" placeholder="粘贴 AccessKey" />
    </Field>
    <Field title="隧道 ID" note="选择或创建的隧道标识">
      <TextInput v-model="frpTunnel" placeholder="选择隧道后自动填充" />
    </Field>
    <div class="ops">
      <button class="btn" disabled>查询节点</button>
      <button class="btn primary" disabled>启动隧道</button>
    </div>
    <Empty text="尚未加载隧道列表" note="桌面版将展示节点延迟、隧道状态与启停控制。" />
  </section>

  <p v-if="ready && overview?.network.messages.length" class="page-note note-foot">
    {{ overview.network.messages.join(' · ') }}
  </p>
</template>

<style scoped>
.tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.tab.on {
  border-color: transparent;
  background: var(--accent);
  color: var(--accent-text);
}

.tab-tag {
  padding: 0 var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--surface-3);
  color: var(--text-dim);
  font-size: 11px;
}

.tab.on .tab-tag {
  background: rgba(255, 255, 255, 0.2);
  color: var(--accent-text);
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.card {
  display: flex;
  flex-direction: column;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.grow {
  flex: 1;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.panel-desc {
  margin-top: var(--space-2);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.6;
}

.invite {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.endpoints {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.msgs {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1.6;
}

.ops {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.note-foot {
  margin-top: var(--space-4);
}
</style>
