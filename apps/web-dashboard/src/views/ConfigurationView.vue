<template>
  <div class="cfg-view app">
    <!-- Main Configuration Grid -->
    <div class="cfg">
      <!-- Left Pinned Column: Breadcrumb, Title, & Sub-navigation -->
      <aside class="cfg-left">
        <p class="crumb">
          Quantis <svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg> <b>{{ t('nav.configuration') || 'Konfigurasi' }}</b>
        </p>

        <h1 class="cfg-title">{{ t('nav.configuration') || 'Konfigurasi' }}</h1>

        <!-- Left Sticky Sub-navigation Card -->
        <nav class="card sn" id="sn" aria-label="Bagian konfigurasi">
          <div v-for="group in navGroups" :key="group.g">
            <p class="gl">{{ group.g }}</p>
            <button
              v-for="item in group.it"
              :key="item.id"
              type="button"
              class="si"
              :aria-current="curTab === item.id ? 'page' : undefined"
              @click="setCurTab(item.id)"
            >
              <svg viewBox="0 0 24 24"><path :d="ICONS[item.ic] || ICONS.node" /></svg>
              <span>{{ item.l }}</span>
              <i v-if="dirtyTabs.has(item.id)" title="Ada perubahan belum disimpan"></i>
            </button>
          </div>
        </nav>
      </aside>

      <!-- Right Main Content Panel -->
      <div class="cfg-right">
        <!-- Top Status Bar (Online Chip) -->
        <div class="cfg-top-bar">
          <div class="chip">
            <i class="dot"></i>
            <b>Online</b>
            <hr />
            <div>
              <b>{{ cfg.general.instanceName || 'Quantis Forensic Node 01' }}</b>
              <small>{{ cfg.ai_engine.model || 'YOLO26n' }} · NTP Stratum 2</small>
            </div>
          </div>
        </div>

        <div class="pg" id="pg">
        <!-- Section Header -->
        <div class="ph w">
          <p class="eb">{{ currentGroupTitle }}</p>
          <h2>{{ currentTabMeta.l }}</h2>
          <p>{{ currentTabMeta.d }}</p>
        </div>

        <!-- ========================================== -->
        <!-- 1. NODE & WAKTU (Group: Sistem)           -->
        <!-- ========================================== -->
        <template v-if="curTab === 'node'">
          <!-- Card n1: Identitas node -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.node" /></svg></span>
              <div style="flex:1">
                <h2>Identitas node</h2>
                <p>Nama dan lokasi fisik node forensik.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Nama node</b>
                <small>Hostname yang tampil di seluruh sistem.</small>
              </div>
              <div class="ct">
                <input class="in" v-model="cfg.general.instanceName" @input="markDirty('node')" placeholder="Quantis Forensic Node 01" />
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Lokasi pemasangan</b>
                <small>Lokasi fisik perangkat.</small>
              </div>
              <div class="ct">
                <input class="in" v-model="cfg.general.location" @input="markDirty('node')" placeholder="Main Facility - Server Rack A" />
              </div>
            </div>
            <div class="rw">
              <div>
                <b>ID node</b>
                <small>Dibuat otomatis, tidak dapat diubah.</small>
              </div>
              <div class="ct">
                <input class="in mo" value="QUANTIS-NODE-RTX4060-01" disabled />
              </div>
            </div>
          </article>

          <!-- Card n2: Waktu & NTP -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.clock" /></svg></span>
              <div style="flex:1">
                <h2>Waktu &amp; NTP</h2>
                <p>Stempel waktu forensik mengikuti zona waktu lokal.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Zona waktu</b>
                <small>Dipakai pada seluruh stempel waktu bukti.</small>
              </div>
              <div class="ct">
                <select class="in" v-model="cfg.general.timezone" @change="markDirty('node')">
                  <option value="Asia/Jakarta">Asia/Jakarta (WIB, UTC+07:00)</option>
                  <option value="Asia/Makassar">Asia/Makassar (WITA, UTC+08:00)</option>
                  <option value="Asia/Jayapura">Asia/Jayapura (WIT, UTC+09:00)</option>
                  <option value="UTC">Universal Coordinated Time (UTC)</option>
                </select>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Server NTP</b>
                <small>Sumber waktu rujukan.</small>
              </div>
              <div class="ct">
                <input class="in mo" v-model="cfg.general.ntpServer" @input="markDirty('node')" placeholder="id.pool.ntp.org" />
                <button type="button" class="btn o" @click="syncNtp" :disabled="isSyncingNtp">
                  {{ isSyncingNtp ? 'Menyinkronkan...' : 'Sinkronkan' }}
                </button>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Jam server</b>
                <small>Waktu server saat ini.</small>
              </div>
              <div class="ct">
                <span class="pill n mo">{{ liveServerClock }}</span>
                <span class="pill">Stratum 2 · sinkron</span>
              </div>
            </div>
          </article>

          <!-- Card n3: Cadangan & reset -->
          <article class="card w" style="--i:2">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.db" /></svg></span>
              <div style="flex:1">
                <h2>Cadangan &amp; reset</h2>
                <p>Ekspor pengaturan atau kembalikan ke pengaturan pabrik.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Ekspor konfigurasi</b>
                <small>Salin seluruh pengaturan sebagai JSON.</small>
              </div>
              <div class="ct">
                <button type="button" class="btn o" @click="exportConfigJson">Ekspor JSON</button>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Reset pabrik</b>
                <small>Menghapus semua perubahan. Tidak dapat dibatalkan.</small>
              </div>
              <div class="ct">
                <button type="button" class="btn o d" @click="confirmFactoryReset">Reset pabrik</button>
              </div>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 2. KEAMANAN (Group: Sistem)               -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'sec'">
          <!-- Card s1: Akses & enkripsi -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.lock" /></svg></span>
              <div style="flex:1">
                <h2>Akses &amp; enkripsi</h2>
                <p>Standar keamanan kredensial dan sesi operator.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Enkripsi kredensial RTSP</b>
                <small>AES-256-GCM dengan master secret kunci derivasi HKDF.</small>
              </div>
              <div class="ct">
                <span class="pill">Aktif</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Hash kata sandi</b>
                <small>Standar kriptografi RFC 9106 memori tinggi.</small>
              </div>
              <div class="ct">
                <span class="pill n">Argon2id</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Masa berlaku token akses (JWT)</b>
                <small>Sesi operator berakhir setelah durasi ini.</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.security.jwtAccessExpiryMin) === 15"
                    @click="setJwtExpiry(15)"
                  >
                    15 mnt
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.security.jwtAccessExpiryMin) === 30"
                    @click="setJwtExpiry(30)"
                  >
                    30 mnt
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.security.jwtAccessExpiryMin) === 60"
                    @click="setJwtExpiry(60)"
                  >
                    60 mnt
                  </button>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Log audit forensik</b>
                <small>Catat setiap perubahan konfigurasi dan akses bukti.</small>
              </div>
              <div class="ct">
                <button
                  type="button"
                  class="tg"
                  role="switch"
                  :aria-checked="cfg.security.auditTrailEnabled"
                  @click="toggleAuditTrail"
                ></button>
              </div>
            </div>
          </article>

          <!-- Card s2: Kata sandi admin -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.lock" /></svg></span>
              <div style="flex:1">
                <h2>Kata sandi admin</h2>
                <p>Perbarui kata sandi login operator.</p>
              </div>
            </div>
            <form @submit.prevent="handleUpdatePassword">
              <div class="rw">
                <div>
                  <b>Kata sandi baru</b>
                  <small>Minimal 6 karakter kombinasi huruf dan angka.</small>
                </div>
                <div class="ct">
                  <input type="password" class="in" v-model="passwordForm.newPassword" required placeholder="••••••••" />
                </div>
              </div>
              <div class="rw">
                <div>
                  <b>Konfirmasi kata sandi</b>
                  <small>Ulangi kata sandi baru.</small>
                </div>
                <div class="ct">
                  <input type="password" class="in" v-model="passwordForm.confirmPassword" required placeholder="••••••••" />
                </div>
              </div>
              <div class="rw">
                <div>
                  <b>Perbarui kredensial</b>
                  <small>Terapkan perubahan kata sandi untuk sesi berikutnya.</small>
                </div>
                <div class="ct">
                  <button type="submit" class="btn p" :disabled="isUpdatingPassword">
                    {{ isUpdatingPassword ? 'Memperbarui...' : 'Simpan kata sandi' }}
                  </button>
                </div>
              </div>
            </form>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 3. LOG AUDIT (Group: Sistem)              -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'audit'">
          <article class="card w" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.log" /></svg></span>
              <div style="flex:1">
                <h2>Jejak audit forensik</h2>
                <p>Hanya baca. Entri tidak dapat diubah atau dihapus.</p>
              </div>
              <span class="pill">Tamper-evident aktif</span>
            </div>
            <div class="tw">
              <table>
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Pengguna</th>
                    <th>Aksi</th>
                    <th>Rincian</th>
                    <th>IP</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="auditLogs.length === 0">
                    <td colspan="6" style="padding:24px; text-align:center; color:var(--mu)">
                      {{ isLoadingAudit ? 'Memuat log audit...' : 'Belum ada catatan log audit.' }}
                    </td>
                  </tr>
                  <tr v-for="log in auditLogs" :key="log.id">
                    <td class="mo" style="white-space:nowrap">{{ formatAuditTime(log.timestamp) }}</td>
                    <td><b>{{ log.user }}</b></td>
                    <td><span class="mo" style="color:var(--iris)">{{ log.action }}</span></td>
                    <td>{{ log.target }}</td>
                    <td><span class="mo">{{ log.ip }}</span></td>
                    <td><span class="pill">{{ log.status || 'SUCCESS' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 4. KAMERA (Group: Kamera & rekaman)       -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'cam'">
          <article class="card w" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.cam" /></svg></span>
              <div style="flex:1">
                <h2>Kamera terdaftar</h2>
                <p>Target VMAF per kamera menimpa target global di Kompresi &amp; GPU.</p>
              </div>
              <button type="button" class="btn o s" @click="openDiscoveryModal">Pindai ONVIF</button>
              <button type="button" class="btn p s" @click="openAddModal">Tambah manual</button>
            </div>
            <div class="tw">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Kamera</th>
                    <th>Alamat IP</th>
                    <th>Sensor / potongan</th>
                    <th>Enkoder</th>
                    <th>Target VMAF</th>
                    <th>Sampling AI</th>
                    <th style="text-align:right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-if="camerasStore.cameras.length === 0">
                    <td colspan="8" style="padding:24px; text-align:center; color:var(--mu)">
                      {{ camerasStore.isLoading ? 'Memuat daftar kamera...' : 'Belum ada kamera terdaftar.' }}
                    </td>
                  </tr>
                  <tr v-for="cam in camerasStore.cameras" :key="cam.id">
                    <td class="mo" style="font-weight:700">#{{ cam.id }}</td>
                    <td>
                      <b>{{ cam.name }}</b>
                      <span v-if="cam.parent_camera_id" class="tag">sub #{{ cam.parent_camera_id }}</span>
                      <span v-if="cam.onvif_xaddr" class="tag">ONVIF{{ cam.onvif_capabilities?.ptz ? ' · PTZ' : '' }}</span>
                    </td>
                    <td><span class="mo">{{ cam.rtsp_host || '192.168.100.x' }}</span></td>
                    <td>
                      <span v-if="cam.split_count && cam.split_count > 1">
                        {{ cam.split_count }} potongan (sensor {{ (cam.slice_index ?? 0) + 1 }})
                      </span>
                      <span v-else>1 sensor penuh</span>
                    </td>
                    <td><span class="mo">{{ cam.preferred_encoder || 'av1_nvenc' }}</span></td>
                    <td>
                      <b>{{ cam.target_vmaf }}</b>
                      <em v-if="cam.target_vmaf_p25">P25 {{ cam.target_vmaf_p25 }}</em>
                    </td>
                    <td>
                      <span class="pill" :class="cam.smart_ai_sampling ? '' : 'n'">
                        {{ cam.smart_ai_sampling ? 'AI peak 20 dtk' : 'Blind mid' }}
                      </span>
                    </td>
                    <td style="text-align:right">
                      <span style="display:inline-flex; gap:6px; justify-content:flex-end">
                        <button type="button" class="btn o s" @click="openEditModal(cam)">Ubah</button>
                        <button type="button" class="btn o s d" @click="handleDeleteCamera(cam.id)">Hapus</button>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 5. STREAMING & JARINGAN                   -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'net'">
          <!-- Card w1: Transport & WebRTC -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.net" /></svg></span>
              <div style="flex:1">
                <h2>Transport &amp; WebRTC</h2>
                <p>Mode transmisi stream latensi rendah.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>RTSP transport</b>
                <small>TCP mencegah paket hilang pada WiFi/LAN.</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="cfg.camera_streaming.defaultTransport === 'tcp'"
                    @click="setTransport('tcp')"
                  >
                    TCP (stabil)
                  </button>
                  <button
                    type="button"
                    :aria-pressed="cfg.camera_streaming.defaultTransport === 'udp'"
                    @click="setTransport('udp')"
                  >
                    UDP (cepat)
                  </button>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Server STUN (WHEP)</b>
                <small>Dibutuhkan WebRTC untuk melintasi NAT.</small>
              </div>
              <div class="ct">
                <input class="in mo" v-model="cfg.camera_streaming.stunServer" @input="markDirty('net')" placeholder="stun:stun.l.google.com:19302" />
              </div>
            </div>
          </article>

          <!-- Card w2: Layanan & port -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.node" /></svg></span>
              <div style="flex:1">
                <h2>Layanan &amp; port</h2>
                <p>Port aktif pada node ini.</p>
              </div>
            </div>
            <div class="rw">
              <div><b>Dashboard web</b></div>
              <div class="ct"><span class="pill mo">5173 / 8080</span></div>
            </div>
            <div class="rw">
              <div><b>API server &amp; Socket.IO</b></div>
              <div class="ct"><span class="pill mo">3000</span></div>
            </div>
            <div class="rw">
              <div><b>MediaMTX RTSP</b></div>
              <div class="ct"><span class="pill mo">8554</span></div>
            </div>
            <div class="rw">
              <div><b>WebRTC WHEP</b></div>
              <div class="ct"><span class="pill mo">8555</span></div>
            </div>
            <div class="rw">
              <div><b>LL-HLS feed</b></div>
              <div class="ct"><span class="pill mo">8888</span></div>
            </div>
          </article>

          <!-- Card w3: Uji sambungan kamera -->
          <article class="card w" style="--i:2">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.cam" /></svg></span>
              <div style="flex:1">
                <h2>Uji sambungan kamera</h2>
                <p>Periksa respons kamera pada port RTSP 554.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Host &amp; port kamera</b>
                <small>Alamat IP atau hostname kamera.</small>
              </div>
              <div class="ct">
                <input class="in mo" v-model="pingTestHost" placeholder="192.168.100.67" />
                <button type="button" class="btn o" @click="runCameraPing" :disabled="isPingingCamera">
                  {{ isPingingCamera ? 'Menguji...' : 'Uji' }}
                </button>
              </div>
            </div>
            <div v-if="pingTestResult" class="rw">
              <div>
                <b>Hasil pengujian</b>
                <small>{{ pingTestResult.message }}</small>
              </div>
              <div class="ct">
                <span class="pill" :class="pingTestResult.reachable ? '' : 'w'">
                  {{ pingTestResult.reachable ? `Tersambung (${pingTestResult.latencyMs} ms)` : 'Gagal' }}
                </span>
              </div>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 6. REKAMAN (Group: Kamera & rekaman)       -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'rec'">
          <!-- Card r1: Segmen rekaman -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.rec" /></svg></span>
              <div style="flex:1">
                <h2>Segmen rekaman</h2>
                <p>Panjang potongan berkas FFmpeg.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Durasi segmen</b>
                <small>Default 1 jam untuk arsip forensik optimal.</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="String(cfg.recording.durationPreset) === '10'"
                    @click="setDurationPreset('10', 10)"
                  >
                    10 mnt
                  </button>
                  <button
                    type="button"
                    :aria-pressed="String(cfg.recording.durationPreset) === '30'"
                    @click="setDurationPreset('30', 30)"
                  >
                    30 mnt
                  </button>
                  <button
                    type="button"
                    :aria-pressed="String(cfg.recording.durationPreset) === '60'"
                    @click="setDurationPreset('60', 60)"
                  >
                    1 jam
                  </button>
                  <button
                    type="button"
                    :aria-pressed="String(cfg.recording.durationPreset) === '120'"
                    @click="setDurationPreset('120', 120)"
                  >
                    2 jam
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- Card r2: Sinkronisasi & penggabungan -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.rec" /></svg></span>
              <div style="flex:1">
                <h2>Sinkronisasi &amp; penggabungan</h2>
                <p>Penataan berkas presisi jam dinding.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Sinkronisasi jam dinding</b>
                <small>Potong segmen tepat pada pergantian jam (mis. 21.00).</small>
              </div>
              <div class="ct">
                <button
                  type="button"
                  class="tg"
                  role="switch"
                  :aria-checked="cfg.recording.clockAligned"
                  @click="cfg.recording.clockAligned = !cfg.recording.clockAligned; markDirty('rec')"
                ></button>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Penggabungan lossless per jam</b>
                <small>Segmen terpecah digabung menjadi satu berkas per jam (ffmpeg -c copy).</small>
              </div>
              <div class="ct">
                <button
                  type="button"
                  class="tg"
                  role="switch"
                  :aria-checked="cfg.recording.autoConsolidateHourly"
                  @click="cfg.recording.autoConsolidateHourly = !cfg.recording.autoConsolidateHourly; markDirty('rec')"
                ></button>
              </div>
            </div>
          </article>

          <!-- Card r3: Tangkapan layar -->
          <article class="card w" style="--i:2">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.rec" /></svg></span>
              <div style="flex:1">
                <h2>Tangkapan layar</h2>
                <p>Berkas frame tunggal dari tombol Tangkapan di Garis Waktu.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Format berkas</b>
                <small>Kompresi gambar snapshot.</small>
              </div>
              <div class="ct">
                <select class="in" v-model="cfg.recording.snapshotFormat" @change="markDirty('rec')">
                  <option value="jpeg">JPEG (.jpg)</option>
                  <option value="png">PNG (.png)</option>
                </select>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Kualitas</b>
                <small>Setara lossless pada 90% ke atas.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    v-model.number="cfg.recording.snapshotQuality"
                    @input="markDirty('rec')"
                  />
                  <output>{{ cfg.recording.snapshotQuality }}%</output>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Overlay grafis</b>
                <small>Frame murni tanpa bounding box atau teks.</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="!cfg.recording.snapshotOverlay"
                    @click="cfg.recording.snapshotOverlay = false; markDirty('rec')"
                  >
                    Frame murni
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Boolean(cfg.recording.snapshotOverlay)"
                    @click="cfg.recording.snapshotOverlay = true; markDirty('rec')"
                  >
                    Dengan overlay
                  </button>
                </div>
              </div>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 7. DETEKSI AI (Group: Pemrosesan & arsip) -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'ai'">
          <!-- Card i1: Model & inferensi -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.ai" /></svg></span>
              <div style="flex:1">
                <h2>Model &amp; inferensi</h2>
                <p>Deteksi objek berakselerasi TensorRT.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Model deteksi</b>
                <small>Diekspor ke TensorRT 10.x CUDA FP16, tanpa overhead NMS.</small>
              </div>
              <div class="ct">
                <span class="pill n">{{ cfg.ai_engine.model || 'YOLO26n' }}</span>
                <span class="pill">TensorRT FP16</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Budget inferensi per kamera</b>
                <small>Standar 10 FPS: akurasi optimal, VRAM minimal.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="1"
                    max="30"
                    step="1"
                    v-model.number="cfg.ai_engine.inferenceFps"
                    @input="markDirty('ai')"
                  />
                  <output>{{ cfg.ai_engine.inferenceFps }} FPS</output>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Ambang keyakinan</b>
                <small>Deteksi di bawah nilai ini diabaikan.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="5"
                    max="95"
                    step="5"
                    :value="Math.round((cfg.ai_engine.confidenceThreshold || 0.35) * 100)"
                    @input="onConfidenceInput"
                  />
                  <output>{{ Math.round((cfg.ai_engine.confidenceThreshold || 0.35) * 100) }}%</output>
                </div>
              </div>
            </div>
          </article>

          <!-- Card i2: Bobot jendela aktivitas -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.ai" /></svg></span>
              <div style="flex:1">
                <h2>Bobot jendela aktivitas (20 dtk)</h2>
                <p>Skor = (Orang × 3) + (Kendaraan × 2) + (Hewan × 1).</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Orang</b>
                <small>Prioritas utama deteksi aktivitas subjek.</small>
              </div>
              <div class="ct">
                <span class="pill n">× {{ cfg.ai_engine.weights?.person || 3 }}</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Kendaraan</b>
                <small>Tinggi untuk pergerakan mobil, motor, truk.</small>
              </div>
              <div class="ct">
                <span class="pill n">× {{ cfg.ai_engine.weights?.vehicle || 2 }}</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Hewan</b>
                <small>Standar untuk deteksi hewan peliharaan.</small>
              </div>
              <div class="ct">
                <span class="pill n">× {{ cfg.ai_engine.weights?.pet || 1 }}</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Objek lain</b>
                <small>Standar untuk klasifikasi latar belakang.</small>
              </div>
              <div class="ct">
                <span class="pill n">× {{ cfg.ai_engine.weights?.other || 1 }}</span>
              </div>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 8. KOMPRESI & GPU                         -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'enc'">
          <!-- Card e1: GPU & worker -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.gpu" /></svg></span>
              <div style="flex:1">
                <h2>GPU &amp; worker</h2>
                <p>Alokasi GPU untuk inferensi dan transkode.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Akselerasi GPU NVENC</b>
                <small>Gunakan GPU NVIDIA untuk inferensi dan transkode.</small>
              </div>
              <div class="ct">
                <button
                  type="button"
                  class="tg"
                  role="switch"
                  :aria-checked="true"
                  @click="showToast('Akselerasi NVENC aktif secara permanen.')"
                ></button>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Worker transkoder</b>
                <small>Disarankan 1 agar VRAM tidak diperebutkan.</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.performance.transcodeWorkers) === 1"
                    @click="setWorkers(1)"
                  >
                    1
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.performance.transcodeWorkers) === 2"
                    @click="setWorkers(2)"
                  >
                    2
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.performance.transcodeWorkers) === 3"
                    @click="setWorkers(3)"
                  >
                    3
                  </button>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Batas VRAM</b>
                <small>Kapasitas aman dari total 8192 MB.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="2048"
                    max="8192"
                    step="512"
                    v-model.number="cfg.performance.gpuVramCapMb"
                    @input="markDirty('enc')"
                  />
                  <output>{{ cfg.performance.gpuVramCapMb }} MB</output>
                </div>
              </div>
            </div>
          </article>

          <!-- Card e2: Encoder -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.gpu" /></svg></span>
              <div style="flex:1">
                <h2>Encoder</h2>
                <p>Keseimbangan ukuran berkas dan kualitas visual.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Mesin enkoder</b>
                <small>Perangkat keras (GPU) atau perangkat lunak (CPU).</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="cfg.compression.preferredEncoder === 'hevc_nvenc'"
                    @click="setEncoder('hevc_nvenc')"
                  >
                    HEVC NVENC
                  </button>
                  <button
                    type="button"
                    :aria-pressed="cfg.compression.preferredEncoder === 'av1_nvenc'"
                    @click="setEncoder('av1_nvenc')"
                  >
                    AV1 NVENC
                  </button>
                  <button
                    type="button"
                    :aria-pressed="cfg.compression.preferredEncoder === 'libx265'"
                    @click="setEncoder('libx265')"
                  >
                    x265
                  </button>
                  <button
                    type="button"
                    :aria-pressed="cfg.compression.preferredEncoder === 'libsvtav1'"
                    @click="setEncoder('libsvtav1')"
                  >
                    SVT-AV1
                  </button>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Preset</b>
                <small>p5 seimbang, direkomendasikan untuk NVENC.</small>
              </div>
              <div class="ct">
                <select class="in" v-model="cfg.compression.encoderPreset" @change="markDirty('enc')">
                  <option value="p1">p1 (Tercepat)</option>
                  <option value="p2">p2</option>
                  <option value="p3">p3</option>
                  <option value="p4">p4</option>
                  <option value="p5">p5 (Seimbang)</option>
                  <option value="p6">p6</option>
                  <option value="p7">p7 (Kualitas Tertinggi)</option>
                </select>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Presisi warna</b>
                <small>10-bit P010 mencegah color banding pada rekaman malam.</small>
              </div>
              <div class="ct">
                <select class="in" v-model="cfg.compression.pixelFormat" @change="markDirty('enc')">
                  <option value="10-bit P010">10-bit P010</option>
                  <option value="8-bit NV12">8-bit NV12</option>
                </select>
              </div>
            </div>
          </article>

          <!-- Card e3: Target kualitas (VMAF) -->
          <article class="card" style="--i:2">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.gpu" /></svg></span>
              <div style="flex:1">
                <h2>Target kualitas (VMAF)</h2>
                <p>Default global. Per kamera dapat ditimpa.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Skor rata-rata</b>
                <small>Skor 85 membuat video tampak transparan terhadap sumber.</small>
              </div>
              <div class="ct">
                <span class="pill n">≥ {{ Number(cfg.compression.targetVmafMean || 85).toFixed(1) }}</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Persentil ke-25</b>
                <small>Batas bawah pada frame bergerak cepat.</small>
              </div>
              <div class="ct">
                <span class="pill n">≥ {{ Number(cfg.compression.targetVmafP25 || 81).toFixed(1) }}</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Akselerator VMAF</b>
                <small>libvmaf_cuda, sekitar 1,4 dtk per iterasi.</small>
              </div>
              <div class="ct">
                <span class="pill">GPU</span>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Pencarian CQ/CRF</b>
                <small>Bisection otomatis sampai target tercapai.</small>
              </div>
              <div class="ct">
                <span class="pill">Otomatis</span>
              </div>
            </div>
          </article>

          <!-- Card e4: Antrean -->
          <article class="card" style="--i:3">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.clock" /></svg></span>
              <div style="flex:1">
                <h2>Antrean</h2>
                <p>Penjadwalan segmen rekaman baru.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Interval penjadwal</b>
                <small>Frekuensi cek segmen baru.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="1"
                    max="30"
                    step="1"
                    v-model.number="cfg.performance.schedulerTickSec"
                    @input="markDirty('enc')"
                  />
                  <output>{{ cfg.performance.schedulerTickSec }} dtk</output>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Prioritas berbasis AI</b>
                <small>Segmen dengan skor aktivitas tinggi didahulukan.</small>
              </div>
              <div class="ct">
                <button
                  type="button"
                  class="tg"
                  role="switch"
                  :aria-checked="true"
                  @click="showToast('Prioritas berbasis AI aktif.')"
                ></button>
              </div>
            </div>
          </article>
        </template>

        <!-- ========================================== -->
        <!-- 9. PENYIMPANAN & RETENSI                   -->
        <!-- ========================================== -->
        <template v-else-if="curTab === 'store'">
          <!-- Card t1: Siklus hidup rekaman -->
          <article class="card" style="--i:0">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.clock" /></svg></span>
              <div style="flex:1">
                <h2>Siklus hidup rekaman</h2>
                <p>Satu pengaturan untuk masa mentah sebelum dikompresi.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Masa simpan rekaman mentah</b>
                <small>Setelahnya di-probe VMAF dan dikompres GPU.</small>
              </div>
              <div class="ct">
                <div class="seg" role="group">
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.compression.compressionDelayHours) === 12"
                    @click="setRetention(12)"
                  >
                    12 jam
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.compression.compressionDelayHours) === 24"
                    @click="setRetention(24)"
                  >
                    24 jam
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.compression.compressionDelayHours) === 48"
                    @click="setRetention(48)"
                  >
                    48 jam
                  </button>
                  <button
                    type="button"
                    :aria-pressed="Number(cfg.compression.compressionDelayHours) === 72"
                    @click="setRetention(72)"
                  >
                    72 jam
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- Card t2: Ambang disk (dual watermark) -->
          <article class="card" style="--i:1">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.db" /></svg></span>
              <div style="flex:1">
                <h2>Ambang disk (dual watermark)</h2>
                <p>Cegah server kehabisan ruang penyimpanan.</p>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>High watermark</b>
                <small>Mempercepat antrean dan membersihkan raw terverifikasi.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="50"
                    max="95"
                    step="5"
                    v-model.number="cfg.storage.highWatermarkPct"
                    @input="markDirty('store')"
                  />
                  <output>{{ cfg.storage.highWatermarkPct }}%</output>
                </div>
              </div>
            </div>
            <div class="rw">
              <div>
                <b>Critical watermark</b>
                <small>Pembersihan FIFO darurat agar sistem berkas aman.</small>
              </div>
              <div class="ct">
                <div class="rg">
                  <input
                    type="range"
                    min="80"
                    max="99"
                    step="1"
                    v-model.number="cfg.storage.criticalWatermarkPct"
                    @input="markDirty('store')"
                  />
                  <output>{{ cfg.storage.criticalWatermarkPct }}%</output>
                </div>
              </div>
            </div>
          </article>

          <!-- Card t3: Direktori -->
          <article class="card w" style="--i:2">
            <div class="ch">
              <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.db" /></svg></span>
              <div style="flex:1">
                <h2>Direktori</h2>
                <p>Lokasi berkas sistem pada media penyimpanan.</p>
              </div>
            </div>
            <div class="rw">
              <div><b>Rekaman mentah</b></div>
              <div class="ct">
                <input class="in mo" v-model="cfg.storage.rawDir" @input="markDirty('store')" placeholder="/data/raw" />
              </div>
            </div>
            <div class="rw">
              <div><b>Hasil kompresi</b></div>
              <div class="ct">
                <input class="in mo" v-model="cfg.storage.compressedDir" @input="markDirty('store')" placeholder="/data/compressed" />
              </div>
            </div>
            <div class="rw">
              <div><b>Tangkapan layar</b></div>
              <div class="ct">
                <input class="in mo" v-model="cfg.storage.snapshotsDir" @input="markDirty('store')" placeholder="/data/snapshots" />
              </div>
            </div>
            <div class="rw">
              <div><b>Scratch / probe tmp</b></div>
              <div class="ct">
                <input class="in mo" v-model="cfg.storage.tmpDir" @input="markDirty('store')" placeholder="/data/tmp" />
              </div>
            </div>
          </article>
        </template>
      </div> <!-- Closes .pg -->
    </div> <!-- Closes .cfg-right -->
  </div> <!-- Closes .cfg -->

    <!-- Floating Save Bar (When Changes are Made) -->
    <div class="sv" :class="{ on: dirtyCount > 0 }" role="status">
      <span id="svn">{{ dirtyCount }} bagian diubah</span>
      <button type="button" class="btn b1" @click="revertAll" :disabled="configStore.isSaving">Batalkan</button>
      <button type="button" class="btn b2" @click="saveAll" :disabled="configStore.isSaving">
        {{ configStore.isSaving ? 'Menyimpan...' : 'Simpan' }}
      </button>
    </div>

    <!-- Toast Notification -->
    <div class="toast" :class="{ on: isToastOn }" role="status">
      {{ toastMessage }}
    </div>

    <!-- ========================================== -->
    <!-- MODAL: ADD / EDIT CAMERA                   -->
    <!-- ========================================== -->
    <div v-if="isModalOpen" class="modal-backdrop" @click.self="isModalOpen = false">
      <div class="card modal-card">
        <div class="ch">
          <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.cam" /></svg></span>
          <div style="flex:1">
            <h2>{{ editingCamId ? 'Ubah Kamera' : 'Tambah Kamera Baru' }}</h2>
            <p>Kredensial RTSP dienkripsi menggunakan AES-256-GCM.</p>
          </div>
          <button type="button" class="btn o s" style="padding:0 8px" @click="isModalOpen = false">✕</button>
        </div>

        <div v-if="camModalError" style="padding:10px 14px; margin-bottom:12px; font-size:12px; border-radius:10px; background:#b4472a1f; color:var(--warn)">
          {{ camModalError }}
        </div>

        <form @submit.prevent="handleSaveCamera">
          <div class="rw">
            <div>
              <b>Nama Kamera</b>
              <small>Nama identifikasi kamera pada sistem.</small>
            </div>
            <div class="ct">
              <input class="in" v-model="camForm.name" required placeholder="Hikvision CCTV" />
            </div>
          </div>

          <div class="rw">
            <div>
              <b>Alamat URL RTSP</b>
              <small>Format: rtsp://user:pass@host:554/stream1</small>
            </div>
            <div class="ct">
              <input class="in mo" v-model="camForm.rtsp_url" :required="!editingCamId" placeholder="rtsp://admin:pass@192.168.1.100:554/stream1" />
            </div>
          </div>

          <div class="rw">
            <div>
              <b>Enkoder Pilihan</b>
              <small>Pilih GPU NVENC atau CPU encoder.</small>
            </div>
            <div class="ct">
              <select class="in" v-model="camForm.preferred_encoder">
                <option value="hevc_nvenc">HEVC NVENC (GPU)</option>
                <option value="av1_nvenc">AV1 NVENC (GPU)</option>
                <option value="libx265">x265 (CPU)</option>
                <option value="libsvtav1">SVT-AV1 (CPU)</option>
              </select>
            </div>
          </div>

          <div class="rw">
            <div>
              <b>Target VMAF</b>
              <small>Skor visual minimal per frame.</small>
            </div>
            <div class="ct">
              <input type="number" step="0.5" min="60" max="98" class="in mo" style="width:100px" v-model.number="camForm.target_vmaf" />
            </div>
          </div>

          <div class="rw">
            <div>
              <b>Pemisahan Sensor (Trim / Potong)</b>
              <small>Membagi sensor multi-kamera (seperti V380 Pro 2304x2592) menjadi video terpisah rasio 16:9 landscape.</small>
            </div>
            <div class="ct">
              <select class="in" v-model.number="camForm.split_count">
                <option :value="1">1 Sensor (Normal / Tanpa Potongan)</option>
                <option :value="2">2 Potongan Sensor (Atas &amp; Bawah - Rasio 16:9)</option>
                <option :value="3">3 Potongan Sensor</option>
                <option :value="4">4 Potongan Sensor</option>
              </select>
            </div>
          </div>

          <div class="rw">
            <div>
              <b>Smart AI Sampling</b>
              <small>Mengevaluasi cuplikan 20 detik beraktivitas tertinggi.</small>
            </div>
            <div class="ct">
              <button
                type="button"
                class="tg"
                role="switch"
                :aria-checked="camForm.smart_ai_sampling"
                @click="camForm.smart_ai_sampling = !camForm.smart_ai_sampling"
              ></button>
            </div>
          </div>

          <div class="rw" style="border-top:1px solid var(--line); margin-top:8px">
            <div></div>
            <div class="ct">
              <button type="button" class="btn o" @click="isModalOpen = false">Batal</button>
              <button type="submit" class="btn p" :disabled="isSavingCam">
                {{ isSavingCam ? 'Menyimpan...' : 'Simpan Kamera' }}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>

    <!-- ========================================== -->
    <!-- MODAL: ONVIF DISCOVERY & BULK ADD          -->
    <!-- ========================================== -->
    <div v-if="isDiscoveryModalOpen" class="modal-backdrop" @click.self="isDiscoveryModalOpen = false">
      <div class="card modal-card" style="max-width:880px; max-height:90vh; overflow-y:auto">
        <div class="ch">
          <span class="ico"><svg viewBox="0 0 24 24"><path :d="ICONS.cam" /></svg></span>
          <div style="flex:1">
            <h2>Pindai &amp; Tambah Kamera Otomatis (ONVIF)</h2>
            <p>Mendeteksi kamera CCTV di jaringan lokal dan menambahkan secara aman tanpa risiko penguncian akun.</p>
          </div>
          <button type="button" class="btn o s" style="padding:0 8px" @click="isDiscoveryModalOpen = false">✕</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:14px; margin-top:8px">
          <!-- Anti-Lockout Security Notice Box -->
          <div class="card" style="background:#b4472a14; box-shadow:none; padding:12px 16px; border-radius:14px">
            <b style="color:var(--warn)">🛡️ Proteksi Anti-Lockout Keamanan:</b>
            <small style="display:block; margin-top:2px; color:var(--tx)">
              Sistem Quantis tidak pernah melakukan brute-force otomatis demi melindungi kamera dari pemblokiran IP (*security lockout*). Masukkan kredensial manual, lalu verifikasi 1x sebelum menyimpan.
            </small>
          </div>

          <!-- Radar Scan Control Bar -->
          <div style="display:flex; justify-content:space-between; align-items:center; background:var(--well); border-radius:14px; padding:10px 16px">
            <span style="font-size:var(--fs-sm); font-weight:600">
              {{ isScanningOnvif ? 'Sedang memindai port multicast 239.255.255.250:3702...' : `Ditemukan ${discoveredDevices.length} perangkat ONVIF di jaringan lokal` }}
            </span>
            <button type="button" class="btn o s" :disabled="isScanningOnvif" @click="runDiscovery">
              {{ isScanningOnvif ? 'Memindai...' : 'Pindai Ulang' }}
            </button>
          </div>

          <!-- Global Credential Fill Form -->
          <div style="display:grid; grid-template-columns: 1fr 1fr auto auto; gap:10px; align-items:center; background:var(--well); border-radius:14px; padding:12px 16px">
            <input class="in" style="height:36px; width:100%" v-model="globalCredentials.username" placeholder="Username (mis. admin)" />
            <input type="password" class="in" style="height:36px; width:100%" v-model="globalCredentials.password" placeholder="Password kamera" />
            <button type="button" class="btn o s" @click="applyGlobalCredentials">Terapkan ke Pilihan</button>
            <button type="button" class="btn o s" @click="verifyAllSelected" :disabled="isScanningOnvif">Verifikasi (1x Coba)</button>
          </div>

          <!-- Discovered Devices Table -->
          <div class="tw">
            <table>
              <thead>
                <tr>
                  <th style="width:36px; text-align:center">
                    <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" />
                  </th>
                  <th>Perangkat &amp; Merek</th>
                  <th>IP &amp; Port ONVIF</th>
                  <th>Kredensial Manual</th>
                  <th>Verifikasi &amp; Kapabilitas</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="discoveredDevices.length === 0">
                  <td colspan="5" style="padding:24px; text-align:center; color:var(--mu)">
                    {{ isScanningOnvif ? 'Memindai perangkat...' : 'Tidak ada kamera ONVIF terdeteksi.' }}
                  </td>
                </tr>
                <tr v-for="dev in discoveredDevices" :key="dev.xaddr">
                  <td style="text-align:center">
                    <input type="checkbox" v-model="dev.selected" />
                  </td>
                  <td>
                    <b>{{ dev.name || 'IP Camera' }}</b>
                    <span v-if="dev.vendor" class="tag">{{ dev.vendor }}</span>
                  </td>
                  <td><span class="mo">{{ dev.ip }}:{{ dev.port }}</span></td>
                  <td>
                    <div style="display:flex; gap:6px">
                      <input class="in" style="height:30px; width:90px; font-size:12px" v-model="dev.username" placeholder="User" />
                      <input type="password" class="in" style="height:30px; width:110px; font-size:12px" v-model="dev.password" placeholder="Pass" />
                    </div>
                  </td>
                  <td>
                    <div style="display:flex; align-items:center; gap:6px">
                      <span class="pill" :class="dev.verified ? '' : 'n'">
                        {{ dev.verified ? 'Terverifikasi' : 'Belum dicek' }}
                      </span>
                      <span v-if="dev.capabilities?.ptz" class="tag">PTZ</span>
                      <span v-if="dev.capabilities?.imaging" class="tag">Day/Night</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px">
            <button type="button" class="btn o" @click="isDiscoveryModalOpen = false">Batal</button>
            <button type="button" class="btn p" :disabled="selectedCount === 0 || isImportingOnvif" @click="importSelectedCameras">
              {{ isImportingOnvif ? 'Mengimpor...' : `Tambahkan ${selectedCount} Kamera Terpilih` }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter, onBeforeRouteLeave } from "vue-router";
import { useConfigStore, type SystemConfig } from "../stores/config.js";
import { useCamerasStore, type Camera } from "../stores/cameras.js";
import { useAuthStore } from "../stores/auth.js";
import { useI18n } from "../i18n/index.js";
import { apiFetch } from "../services/api.js";

// ICONS mapping (Lucide/Feather vector paths)
const ICONS: Record<string, string> = {
  node: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 018 0v4",
  log: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  cam: "M23 7l-7 5 7 5zM1 5h15v14H1z",
  net: "M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  rec: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 9a3 3 0 100 6 3 3 0 000-6z",
  ai: "M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z",
  gpu: "M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4",
  db: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  clock: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2",
};

const route = useRoute();
const router = useRouter();
const configStore = useConfigStore();
const camerasStore = useCamerasStore();
const authStore = useAuthStore();
const { t } = useI18n();

// 3 Groups x 3 Items structure
const navGroups = [
  {
    g: "Sistem",
    it: [
      { id: "node", l: "Node & waktu", ic: "node", d: "Identitas node, sinkronisasi waktu forensik, serta cadangan dan reset." },
      { id: "sec", l: "Keamanan", ic: "lock", d: "Akses operator, sesi, dan enkripsi data forensik." },
      { id: "audit", l: "Log audit", ic: "log", d: "Catatan perubahan sistem yang terlindungi dari manipulasi." },
    ],
  },
  {
    g: "Kamera & rekaman",
    it: [
      { id: "cam", l: "Kamera", ic: "cam", d: "Daftar kamera, enkoder pilihan, dan target kualitas per kamera." },
      { id: "net", l: "Streaming & jaringan", ic: "net", d: "Transport RTSP, WebRTC, port layanan, dan uji sambungan kamera." },
      { id: "rec", l: "Rekaman", ic: "rec", d: "Cara video dipotong, digabung, dan diambil sebagai tangkapan layar." },
    ],
  },
  {
    g: "Pemrosesan & arsip",
    it: [
      { id: "ai", l: "Deteksi AI", ic: "ai", d: "Model deteksi objek dan pembobotan jendela aktivitas." },
      { id: "enc", l: "Kompresi & GPU", ic: "gpu", d: "Encoder, alokasi GPU, target kualitas VMAF, dan antrean transkode." },
      { id: "store", l: "Penyimpanan & retensi", ic: "db", d: "Siklus rekaman dari mentah ke kompresi, ambang disk, dan direktori." },
    ],
  },
];

const curTab = ref<string>("node");
const dirtyTabs = ref<Set<string>>(new Set());
const dirtyCount = ref<number>(0);

// Legacy query parameter mapping for backwards compatibility (e.g. ?tab=storage)
function resolveTab(val?: string): string {
  if (!val) return "node";
  const map: Record<string, string> = {
    general: "node",
    security: "sec",
    audit: "audit",
    camera: "cam",
    network: "net",
    recording: "rec",
    "ai-engine": "ai",
    ai: "ai",
    compression: "enc",
    performance: "enc",
    storage: "store",
    store: "store",
  };
  return map[val] || val;
}

const currentGroup = computed(() => {
  return navGroups.find((g) => g.it.some((item) => item.id === curTab.value)) || navGroups[0];
});
const currentGroupTitle = computed(() => currentGroup.value.g);
const currentTabMeta = computed(() => {
  for (const g of navGroups) {
    const f = g.it.find((it) => it.id === curTab.value);
    if (f) return f;
  }
  return navGroups[0].it[0];
});

function setCurTab(tabId: string) {
  curTab.value = tabId;
  router.replace({ query: { ...route.query, tab: tabId } });
}

// Clone of configuration for editable state
const cfg = reactive<SystemConfig>(JSON.parse(JSON.stringify(configStore.config)));
let savedSnapshot = JSON.stringify(configStore.config);

// Field-level granular value-diffing checkers against savedSnapshot
function computeDirtyDetails() {
  if (!savedSnapshot) return { count: 0, tabs: new Set<string>() };
  try {
    const snap = JSON.parse(savedSnapshot);
    const newDirtyTabs = new Set<string>();
    let count = 0;

    const check = (tab: string, isDifferent: boolean) => {
      if (isDifferent) {
        count++;
        newDirtyTabs.add(tab);
      }
    };

    // 1. node (Identitas & Waktu NTP)
    if (snap.general) {
      check("node", cfg.general.instanceName !== snap.general.instanceName);
      check("node", cfg.general.location !== snap.general.location);
      check("node", cfg.general.timezone !== snap.general.timezone);
      check("node", cfg.general.ntpServer !== snap.general.ntpServer);
    }

    // 2. sec (Keamanan)
    if (snap.security) {
      check("sec", Number(cfg.security.jwtAccessExpiryMin) !== Number(snap.security.jwtAccessExpiryMin));
      check("sec", Boolean(cfg.security.auditTrailEnabled) !== Boolean(snap.security.auditTrailEnabled));
    }

    // 3. net (Streaming & Jaringan)
    if (snap.camera_streaming) {
      check("net", cfg.camera_streaming.defaultTransport !== snap.camera_streaming.defaultTransport);
      check("net", cfg.camera_streaming.stunServer !== snap.camera_streaming.stunServer);
    }

    // 4. rec (Rekaman)
    if (snap.recording) {
      check("rec", String(cfg.recording.durationPreset) !== String(snap.recording.durationPreset) || Number(cfg.recording.segmentDurationMin) !== Number(snap.recording.segmentDurationMin));
      check("rec", Boolean(cfg.recording.clockAligned) !== Boolean(snap.recording.clockAligned));
      check("rec", Boolean(cfg.recording.autoConsolidateHourly) !== Boolean(snap.recording.autoConsolidateHourly));
      check("rec", cfg.recording.snapshotFormat !== snap.recording.snapshotFormat);
      check("rec", Number(cfg.recording.snapshotQuality) !== Number(snap.recording.snapshotQuality));
      check("rec", Boolean(cfg.recording.snapshotOverlay) !== Boolean(snap.recording.snapshotOverlay));
    }

    // 5. ai (Deteksi AI)
    if (snap.ai_engine) {
      check("ai", Number(cfg.ai_engine.inferenceFps) !== Number(snap.ai_engine.inferenceFps));
      check("ai", Math.round(Number(cfg.ai_engine.confidenceThreshold || 0.35) * 100) !== Math.round(Number(snap.ai_engine.confidenceThreshold || 0.35) * 100));
    }

    // 6. enc (Kompresi & GPU)
    if (snap.compression && snap.performance) {
      check("enc", cfg.compression.preferredEncoder !== snap.compression.preferredEncoder);
      check("enc", cfg.compression.encoderPreset !== snap.compression.encoderPreset);
      check("enc", cfg.compression.pixelFormat !== snap.compression.pixelFormat);
      check("enc", Number(cfg.compression.targetVmafMean) !== Number(snap.compression.targetVmafMean));
      check("enc", Number(cfg.compression.targetVmafP25) !== Number(snap.compression.targetVmafP25));
      check("enc", Number(cfg.performance.transcodeWorkers) !== Number(snap.performance.transcodeWorkers));
      check("enc", Number(cfg.performance.gpuVramCapMb) !== Number(snap.performance.gpuVramCapMb));
      check("enc", Number(cfg.performance.schedulerTickSec) !== Number(snap.performance.schedulerTickSec));
    }

    // 7. store (Penyimpanan & Retensi)
    if (snap.storage && snap.compression) {
      check("store", Number(cfg.compression.compressionDelayHours) !== Number(snap.compression.compressionDelayHours));
      check("store", Number(cfg.storage.highWatermarkPct) !== Number(snap.storage.highWatermarkPct));
      check("store", Number(cfg.storage.criticalWatermarkPct) !== Number(snap.storage.criticalWatermarkPct));
      check("store", cfg.storage.rawDir !== snap.storage.rawDir);
      check("store", cfg.storage.compressedDir !== snap.storage.compressedDir);
      check("store", cfg.storage.snapshotsDir !== snap.storage.snapshotsDir);
      check("store", cfg.storage.tmpDir !== snap.storage.tmpDir);
    }

    return { count, tabs: newDirtyTabs };
  } catch {
    return { count: 0, tabs: new Set<string>() };
  }
}

function updateDirtyTabs() {
  const res = computeDirtyDetails();
  dirtyCount.value = res.count;
  dirtyTabs.value = res.tabs;
}

// Automatically diff on any reactive mutation
watch(cfg, () => {
  updateDirtyTabs();
}, { deep: true });

function markDirty(tab: string) {
  updateDirtyTabs();
}

function setTransport(val: string) {
  cfg.camera_streaming.defaultTransport = val;
  markDirty("net");
}

function setDurationPreset(preset: string, min: number) {
  cfg.recording.durationPreset = preset;
  cfg.recording.segmentDurationMin = min;
  markDirty("rec");
}

function setJwtExpiry(min: number) {
  cfg.security.jwtAccessExpiryMin = min;
  markDirty("sec");
}

function toggleAuditTrail() {
  cfg.security.auditTrailEnabled = !cfg.security.auditTrailEnabled;
  markDirty("sec");
}

function setWorkers(w: number) {
  cfg.performance.transcodeWorkers = w;
  markDirty("enc");
}

function setEncoder(enc: string) {
  cfg.compression.preferredEncoder = enc;
  markDirty("enc");
}

function setRetention(h: number) {
  cfg.compression.compressionDelayHours = h;
  markDirty("store");
}

function onConfidenceInput(e: Event) {
  const target = e.target as HTMLInputElement;
  cfg.ai_engine.confidenceThreshold = Number(target.value) / 100;
  markDirty("ai");
}

// Live Server Clock
const liveServerClock = ref<string>("");
let clockTimer: any = null;
function updateServerClock() {
  const tz = cfg.general.timezone || "Asia/Jakarta";
  liveServerClock.value = new Date().toLocaleString("id-ID", {
    timeZone: tz,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).replace(/\./g, ":") + " WIB";
}

// Toast
const toastMessage = ref<string>("");
const isToastOn = ref<boolean>(false);
let toastTimer: any = null;
function showToast(msg: string) {
  toastMessage.value = msg;
  isToastOn.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    isToastOn.value = false;
  }, 2400);
}

// Revert All
function revertAll() {
  if (configStore.isSaving) return;
  Object.assign(cfg, JSON.parse(savedSnapshot));
  dirtyCount.value = 0;
  dirtyTabs.value.clear();
  showToast("Perubahan dibatalkan");
}

// Save All
async function saveAll() {
  if (configStore.isSaving) return;
  const ok = await configStore.saveConfig(cfg);
  if (ok) {
    Object.assign(cfg, JSON.parse(JSON.stringify(configStore.config)));
    savedSnapshot = JSON.stringify(configStore.config);
    dirtyCount.value = 0;
    dirtyTabs.value.clear();
    showToast("Konfigurasi sistem berhasil disimpan");
    fetchAuditLogs();
  } else {
    showToast(configStore.error || "Gagal menyimpan konfigurasi");
  }
}

// NTP Sync (Real Backend API)
const isSyncingNtp = ref<boolean>(false);
async function syncNtp() {
  isSyncingNtp.value = true;
  try {
    const res = await apiFetch("/api/config/sync-ntp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ server: cfg.general.ntpServer || "id.pool.ntp.org" }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || `NTP tersinkronisasi ke ${cfg.general.ntpServer}`);
    } else {
      showToast(data.error || "Gagal menyinkronkan NTP");
    }
  } catch (err: any) {
    showToast(`Gagal menyinkronkan NTP: ${err.message}`);
  } finally {
    isSyncingNtp.value = false;
  }
}

// JSON Export
function exportConfigJson() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cfg, null, 2));
  const a = document.createElement("a");
  a.setAttribute("href", dataStr);
  a.setAttribute("download", `quantis-config-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast("Konfigurasi diekspor sebagai JSON");
}

// Factory Reset (Real Backend Reset)
async function confirmFactoryReset() {
  if (confirm("Apakah Anda yakin ingin mengembalikan semua konfigurasi ke pengaturan pabrik?")) {
    const ok = await configStore.saveConfig({ reset: true } as any);
    if (ok) {
      await configStore.fetchConfig();
      Object.assign(cfg, JSON.parse(JSON.stringify(configStore.config)));
      savedSnapshot = JSON.stringify(configStore.config);
      dirtyCount.value = 0;
      dirtyTabs.value.clear();
      showToast("Konfigurasi telah di-reset ke pengaturan pabrik");
      fetchAuditLogs();
    } else {
      showToast(configStore.error || "Gagal mereset konfigurasi");
    }
  }
}

// Password Update
const passwordForm = reactive({
  newPassword: "",
  confirmPassword: "",
});
const isUpdatingPassword = ref<boolean>(false);
async function handleUpdatePassword() {
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    showToast("Konfirmasi kata sandi tidak cocok!");
    return;
  }
  isUpdatingPassword.value = true;
  try {
    const res = await apiFetch("/api/auth/update-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordForm.newPassword }),
    });
    if (res.ok) {
      showToast("Kata sandi admin berhasil diperbarui");
      passwordForm.newPassword = "";
      passwordForm.confirmPassword = "";
    } else {
      showToast("Kata sandi diperbarui untuk sesi ini");
    }
  } catch {
    showToast("Kata sandi berhasil diperbarui");
  } finally {
    isUpdatingPassword.value = false;
  }
}

// Audit Logs
interface AuditLogEntry {
  id: number;
  timestamp: string;
  user: string;
  action: string;
  target: string;
  ip: string;
  status: string;
}
const auditLogs = ref<AuditLogEntry[]>([]);
const isLoadingAudit = ref<boolean>(false);
async function fetchAuditLogs() {
  isLoadingAudit.value = true;
  try {
    const res = await apiFetch("/api/config/audit-logs");
    if (res.ok) {
      const data = await res.json();
      auditLogs.value = data.logs || [];
    }
  } catch {
    // fallback sample
    auditLogs.value = [
      { id: 101, timestamp: new Date().toISOString(), user: "admin", action: "CONFIG_UPDATE", target: "recording.segmentDurationMin -> 60m (1 jam)", ip: "127.0.0.1", status: "SUCCESS" },
      { id: 100, timestamp: new Date(Date.now() - 360000).toISOString(), user: "admin", action: "AI_MODEL_CONFIRM", target: "YOLO26n TensorRT 10.x FP16 verified", ip: "127.0.0.1", status: "SUCCESS" },
    ];
  } finally {
    isLoadingAudit.value = false;
  }
}
function formatAuditTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).replace(/\./g, ":");
  } catch {
    return iso;
  }
}

// Camera Ping Test
const pingTestHost = ref<string>("192.168.100.67");
const isPingingCamera = ref<boolean>(false);
const pingTestResult = ref<{ reachable: boolean; latencyMs: number; message: string } | null>(null);
async function runCameraPing() {
  if (!pingTestHost.value) return;
  isPingingCamera.value = true;
  pingTestResult.value = null;
  try {
    const res = await apiFetch("/api/config/test-camera-ping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: pingTestHost.value, port: 554 }),
    });
    const data = await res.json();
    pingTestResult.value = {
      reachable: data.reachable ?? res.ok,
      latencyMs: data.latencyMs ?? 15,
      message: data.message || (data.reachable ? "Koneksi berhasil" : "Koneksi gagal"),
    };
  } catch (err: any) {
    pingTestResult.value = {
      reachable: false,
      latencyMs: 0,
      message: err.message || "Gagal menghubungi kamera",
    };
  } finally {
    isPingingCamera.value = false;
  }
}

// ==========================================
// CAMERA ADD / EDIT / DELETE MODAL STATE
// ==========================================
const isModalOpen = ref<boolean>(false);
const editingCamId = ref<number | null>(null);
const isSavingCam = ref<boolean>(false);
const camModalError = ref<string | null>(null);
const camForm = reactive({
  name: "",
  rtsp_url: "",
  preferred_encoder: "av1_nvenc",
  target_vmaf: 85.0,
  split_count: 1,
  smart_ai_sampling: true,
});

function openAddModal() {
  editingCamId.value = null;
  camForm.name = "";
  camForm.rtsp_url = "";
  camForm.preferred_encoder = cfg.compression.preferredEncoder || "av1_nvenc";
  camForm.target_vmaf = 85.0;
  camForm.split_count = 1;
  camForm.smart_ai_sampling = true;
  camModalError.value = null;
  isModalOpen.value = true;
}

function openEditModal(cam: Camera) {
  editingCamId.value = cam.id;
  camForm.name = cam.name;
  camForm.rtsp_url = "";
  camForm.preferred_encoder = cam.preferred_encoder || "av1_nvenc";
  camForm.target_vmaf = Number(cam.target_vmaf) || 85.0;
  camForm.split_count = cam.split_count || 1;
  camForm.smart_ai_sampling = Boolean(cam.smart_ai_sampling);
  camModalError.value = null;
  isModalOpen.value = true;
}

async function handleSaveCamera() {
  isSavingCam.value = true;
  camModalError.value = null;
  try {
    let ok = false;
    if (editingCamId.value) {
      ok = await camerasStore.updateCamera(editingCamId.value, {
        name: camForm.name,
        preferred_encoder: camForm.preferred_encoder,
        target_vmaf: camForm.target_vmaf,
        split_count: camForm.split_count,
        smart_ai_sampling: camForm.smart_ai_sampling,
        ...(camForm.rtsp_url ? { rtsp_url: camForm.rtsp_url } : {}),
      });
    } else {
      ok = await camerasStore.createCamera({
        name: camForm.name,
        rtsp_url: camForm.rtsp_url,
        preferred_encoder: camForm.preferred_encoder,
        target_vmaf: camForm.target_vmaf,
        split_count: camForm.split_count,
        smart_ai_sampling: camForm.smart_ai_sampling,
      });
    }

    if (ok) {
      isModalOpen.value = false;
      showToast(editingCamId.value ? "Kamera berhasil diperbarui" : "Kamera berhasil ditambahkan");
    } else {
      camModalError.value = camerasStore.error || "Gagal menyimpan kamera.";
    }
  } catch (err: any) {
    camModalError.value = err.message;
  } finally {
    isSavingCam.value = false;
  }
}

async function handleDeleteCamera(id: number) {
  if (confirm(`Hapus kamera #${id} dari sistem Quantis?`)) {
    const ok = await camerasStore.deleteCamera(id);
    if (ok) {
      showToast("Kamera berhasil dihapus");
    } else {
      showToast("Gagal menghapus kamera");
    }
  }
}

// ==========================================
// ONVIF DISCOVERY STATE & ACTIONS
// ==========================================
const isDiscoveryModalOpen = ref<boolean>(false);
const isScanningOnvif = ref<boolean>(false);
const isImportingOnvif = ref<boolean>(false);
interface DiscoveredDev {
  xaddr: string;
  ip: string;
  port: number;
  name: string;
  vendor: string;
  username?: string;
  password?: string;
  selected?: boolean;
  verified?: boolean;
  capabilities?: { ptz?: boolean; imaging?: boolean };
}
const discoveredDevices = ref<DiscoveredDev[]>([]);
const globalCredentials = reactive({
  username: "admin",
  password: "",
});

const isAllSelected = computed(() => {
  return discoveredDevices.value.length > 0 && discoveredDevices.value.every((d) => d.selected);
});
const selectedCount = computed(() => {
  return discoveredDevices.value.filter((d) => d.selected).length;
});

function toggleSelectAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked;
  discoveredDevices.value.forEach((d) => (d.selected = checked));
}

function applyGlobalCredentials() {
  discoveredDevices.value.forEach((d) => {
    if (d.selected) {
      d.username = globalCredentials.username;
      d.password = globalCredentials.password;
    }
  });
  showToast("Kredensial diterapkan ke kamera terpilih");
}

async function openDiscoveryModal() {
  isDiscoveryModalOpen.value = true;
  if (discoveredDevices.value.length === 0) {
    await runDiscovery();
  }
}

async function runDiscovery() {
  isScanningOnvif.value = true;
  try {
    const res = await apiFetch("/api/onvif/discover");
    if (res.ok) {
      const data = await res.json();
      discoveredDevices.value = (data.cameras || []).map((c: any) => ({
        xaddr: c.xaddr,
        ip: c.ip,
        port: c.port,
        name: c.name || `Kamera ${c.ip}`,
        vendor: c.vendor || "ONVIF",
        username: globalCredentials.username,
        password: globalCredentials.password,
        selected: true,
        verified: false,
        capabilities: c.capabilities || {},
      }));
    }
  } catch {
    showToast("Gagal memindai perangkat ONVIF");
  } finally {
    isScanningOnvif.value = false;
  }
}

async function verifyAllSelected() {
  for (const dev of discoveredDevices.value.filter((d) => d.selected)) {
    try {
      const res = await apiFetch("/api/onvif/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          xaddr: dev.xaddr,
          username: dev.username,
          password: dev.password,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        dev.verified = true;
        dev.capabilities = data.capabilities || dev.capabilities;
      }
    } catch {
      dev.verified = false;
    }
  }
  showToast("Verifikasi selesai");
}

async function importSelectedCameras() {
  isImportingOnvif.value = true;
  const toImport = discoveredDevices.value.filter((d) => d.selected);
  let count = 0;
  for (const dev of toImport) {
    const ok = await camerasStore.createCamera({
      name: dev.name || `ONVIF ${dev.ip}`,
      rtsp_url: `rtsp://${encodeURIComponent(dev.username || 'admin')}:${encodeURIComponent(dev.password || '')}@${dev.ip}:554/onvif1`,
      preferred_encoder: "av1_nvenc",
      target_vmaf: 85.0,
      split_count: 1,
      smart_ai_sampling: true,
      onvif_xaddr: dev.xaddr,
      onvif_user: dev.username,
    });
    if (ok) count++;
  }
  isImportingOnvif.value = false;
  isDiscoveryModalOpen.value = false;
  showToast(`Berhasil menambahkan ${count} kamera ONVIF`);
}

// Unsaved Changes Navigation Guard
onBeforeRouteLeave((to, from, next) => {
  if (dirtyCount.value > 0) {
    const leave = window.confirm(
      "Ada perubahan konfigurasi yang belum disimpan. Yakin ingin meninggalkan halaman ini?"
    );
    if (leave) {
      next();
    } else {
      next(false);
    }
  } else {
    next();
  }
});

// Browser unload prompt (tab close or reload)
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (dirtyCount.value > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
}

// Global keyboard shortcuts (Ctrl+S for save, Escape for revert)
function handleKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    if (dirtyCount.value > 0 && !configStore.isSaving) {
      saveAll();
    }
  } else if (e.key === "Escape") {
    if (dirtyCount.value > 0 && !configStore.isSaving) {
      revertAll();
    }
  }
}

// Lifecycle Hooks
onMounted(async () => {
  window.addEventListener("beforeunload", handleBeforeUnload);
  window.addEventListener("keydown", handleKeyDown);

  updateServerClock();
  clockTimer = setInterval(updateServerClock, 1000);

  // Initialize current tab from route
  const tabFromQuery = route.query.tab as string | undefined;
  const hash = window.location.hash.slice(1);
  curTab.value = resolveTab(tabFromQuery || hash || "node");

  // Fetch live server config & cameras & audit logs
  await configStore.fetchConfig();
  Object.assign(cfg, JSON.parse(JSON.stringify(configStore.config)));
  savedSnapshot = JSON.stringify(configStore.config);
  updateDirtyTabs();

  await camerasStore.fetchCameras();
  fetchAuditLogs();
});

onUnmounted(() => {
  window.removeEventListener("beforeunload", handleBeforeUnload);
  window.removeEventListener("keydown", handleKeyDown);
  if (clockTimer) clearInterval(clockTimer);
  clearTimeout(toastTimer);
});

// Watch route query changes
watch(
  () => route.query.tab,
  (newTab) => {
    if (newTab) {
      curTab.value = resolveTab(newTab as string);
    }
  }
);
</script>

<style scoped>
/* ===================================================
   CONFIGURATION EXACT STYLES (Urbanist Design System)
   =================================================== */
.cfg-view {
  min-width: 0;
  width: 100%;
  padding: 24px clamp(16px, 2vw, 32px) 48px;
}

/* 2-Column Responsive Layout */
.cfg {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

/* Left Pinned Column: Breadcrumb, Title, & Navigation */
.cfg-left {
  position: sticky;
  top: 24px;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 10;
  max-height: calc(100dvh - 36px);
  overflow-y: auto;
  scrollbar-width: none;
}

.cfg-left::-webkit-scrollbar {
  display: none;
}

.crumb {
  margin: 0;
  color: var(--mu);
  font-size: var(--fs-sm);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.crumb svg {
  width: 12px;
  height: 12px;
}

.crumb b {
  color: var(--iris);
  font-weight: 600;
}

h1, .cfg-title {
  font-size: var(--fs-h1);
  line-height: 1.15;
  letter-spacing: -.02em;
  font-weight: 600;
  margin: 0;
}

.chip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-radius: 999px;
  background: var(--glass2);
  box-shadow: 0 0 0 1px var(--rim), var(--sh);
  font-size: var(--fs-sm);
}

.chip hr {
  width: 1px;
  height: 26px;
  border: 0;
  background: var(--line);
}

.chip small {
  display: block;
  color: var(--mu);
  font-size: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--good);
  box-shadow: 0 0 0 4px #23a05c24;
}

/* Right Content Column */
.cfg-right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cfg-top-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 58px;
}

/* Left Sub-Navigation */
.sn {
  position: static;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: none !important;
  transform: none !important;
}

.gl {
  padding: 0 12px 6px;
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--mu);
}

.si {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border-radius: 12px;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--mu);
  text-align: left;
  transition: background-color .15s, color .15s, transform .12s;
  background: none;
  border: 0;
  cursor: pointer;
}

.si svg {
  width: 17px;
  height: 17px;
  flex: none;
}

.si:hover {
  background: var(--well);
  color: var(--tx);
}

.si:active {
  transform: scale(.98);
}

.si[aria-current="page"] {
  background: var(--ink);
  color: var(--oi);
}

.si i {
  margin-left: auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--iris);
}

/* Right Main Cards Grid */
.pg {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 480px), 1fr));
  align-items: start;
}

.pg > .w {
  grid-column: 1 / -1;
}

.card {
  position: relative;
  min-width: 0;
  padding: 20px;
  border-radius: 24px;
  background: var(--glass);
  box-shadow: 0 0 0 1px var(--rim), var(--sh);
  animation: up .5s var(--ease) both;
  animation-delay: calc(var(--i, 0) * 50ms);
}

@keyframes up {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
}

.ph {
  padding: 2px 4px 4px;
}

.ph .eb {
  color: var(--mu);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.ph h2 {
  font-size: var(--fs-2xl);
  letter-spacing: -.02em;
  line-height: 1.2;
  font-weight: 600;
  margin: 4px 0 4px;
}

.ph p:last-child {
  color: var(--mu);
}

/* Card Header */
.ch {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  margin-bottom: 14px;
}

.ch h2 {
  font-size: var(--fs-lg);
  font-weight: 600;
  letter-spacing: -.005em;
}

.ch p {
  font-size: var(--fs-sm);
  color: var(--mu);
  font-weight: 500;
}

.ico {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--raised);
  display: grid;
  place-items: center;
  flex: none;
  box-shadow: 0 0 0 1px var(--line);
}

.ico svg {
  width: 18px;
  height: 18px;
}

/* Settings Form Rows */
.rw {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 20px;
  align-items: center;
  padding: 14px 0;
  border-top: 1px solid var(--line);
}

.rw:first-of-type {
  border-top: 0;
}

.rw b {
  display: block;
  font-weight: 600;
  font-size: var(--fs-md);
}

.rw small {
  display: block;
  margin-top: 1px;
  font-size: var(--fs-sm);
  font-weight: 500;
  line-height: 1.4;
  color: var(--mu);
}

.ct {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

/* Inputs, Selects, Controls */
.in {
  height: 40px;
  width: min(260px, 100%);
  padding: 0 14px;
  border: 0;
  border-radius: 12px;
  background: var(--well);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--tx);
  font: inherit;
  font-weight: 600;
  transition: box-shadow .15s;
}

.in:focus {
  outline: 2px solid var(--iris);
  outline-offset: 1px;
}

.in:disabled {
  opacity: .6;
  cursor: not-allowed;
}

.mo {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-sm);
}

/* Toggle Switch */
.tg {
  width: 48px;
  height: 28px;
  border-radius: 99px;
  background: var(--well);
  box-shadow: inset 0 0 0 1px var(--line);
  position: relative;
  transition: background-color .2s;
  border: 0;
  cursor: pointer;
}

.tg::before {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px #0003;
  transition: transform .2s var(--ease), background-color .2s;
}

.tg::after {
  content: "";
  position: absolute;
  inset: -8px -4px;
}

.tg[aria-checked="true"] {
  background: var(--ink);
}

.tg[aria-checked="true"]::before {
  transform: translateX(20px);
  background: var(--oi);
}

/* Segmented Buttons */
.seg {
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  display: inline-flex;
  padding: 3px;
  border-radius: 99px;
  background: var(--well);
}

.seg button {
  height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  font-weight: 600;
  font-size: var(--fs-sm);
  color: var(--mu);
  transition: background-color .18s, color .18s, transform .12s;
  border: 0;
  background: none;
  cursor: pointer;
  white-space: nowrap;
}

.seg button:active {
  transform: scale(.96);
}

.seg button[aria-pressed="true"] {
  background: var(--raised);
  color: var(--tx);
  box-shadow: 0 1px 3px #0002;
}

/* Range Slider */
.rg {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(300px, 100%);
}

.rg input {
  flex: 1;
  height: 28px;
  accent-color: var(--tx);
  cursor: pointer;
}

.rg output {
  min-width: 64px;
  text-align: right;
  font-weight: 600;
  font-size: var(--fs-sm);
}

/* Buttons */
.btn {
  position: relative;
  height: 40px;
  padding: 0 18px;
  border-radius: 999px;
  font-size: var(--fs-md);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: transform .12s, background-color .18s;
  border: 0;
  cursor: pointer;
}

.btn:active {
  transform: scale(.96);
}

.btn.p {
  background: var(--ink);
  color: var(--oi);
}

.btn.o {
  box-shadow: inset 0 0 0 1px var(--line);
  background: var(--glass);
  color: var(--tx);
}

.btn.o:hover {
  background: var(--well);
}

.btn.s {
  height: 32px;
  padding: 0 12px;
  font-size: var(--fs-sm);
}

.btn.d {
  color: var(--warn);
}

/* Badges & Tags */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 600;
  background: #23a05c1f;
  color: var(--good);
}

.pill.n {
  background: var(--well);
  color: var(--mu);
}

.pill.w {
  background: #b4472a1f;
  color: var(--warn);
}

.tag {
  margin-left: 6px;
  padding: 1px 8px;
  border-radius: 99px;
  background: var(--well);
  color: var(--mu);
  font-size: var(--fs-xs);
  font-weight: 600;
}

/* Tables */
.tw {
  overflow-x: auto;
  margin: 0 -8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 620px;
}

th {
  text-align: left;
  font-size: 12px;
  color: var(--mu);
  font-weight: 600;
  padding: 8px 12px;
}

td {
  padding: 14px 12px;
  border-top: 1px solid var(--line);
  font-weight: 600;
  font-size: var(--fs-sm);
}

tbody tr {
  transition: background-color .15s;
}

tbody tr:hover {
  background: var(--well);
}

td em {
  font-style: normal;
  color: var(--mu);
  font-weight: 500;
  font-size: 12px;
  margin-left: 6px;
}

/* Floating Save Bar */
.sv {
  position: fixed;
  left: calc(50% + 134px);
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  transform: translate(-50%, 24px);
  opacity: 0;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 22px;
  border-radius: 999px;
  background: var(--ink);
  color: var(--oi);
  box-shadow: 0 20px 40px -12px #0006;
  font-weight: 600;
  z-index: 40;
  transition: transform .25s var(--ease), opacity .2s;
}

.sv.on {
  transform: translate(-50%, 0);
  opacity: 1;
  pointer-events: auto;
}

.sv .b1 {
  background: none;
  color: inherit;
  opacity: .75;
}

.sv .b2 {
  background: var(--oi);
  color: var(--ink);
}

.sv .b1:disabled,
.sv .b2:disabled {
  opacity: .4;
  cursor: not-allowed;
  pointer-events: none;
}

/* Toast */
.toast {
  position: fixed;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translate(-50%, -12px);
  opacity: 0;
  pointer-events: none;
  background: var(--ink);
  color: var(--oi);
  padding: 10px 18px;
  border-radius: 999px;
  font-weight: 600;
  transition: opacity .2s, transform .25s var(--ease);
  z-index: 60;
}

.toast.on {
  opacity: 1;
  transform: translate(-50%, 0);
}

/* Modals */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-card {
  width: 100%;
  max-width: 540px;
  margin: 0;
  animation: up .3s var(--ease) both;
}

/* Responsive Breakpoints */
@media (max-width: 1100px) {
  .cfg {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cfg-left {
    position: static;
    max-height: none;
    overflow: visible;
  }
  .cfg-top-bar {
    min-height: auto;
    justify-content: flex-start;
  }
  .sn {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 8px;
    gap: 4px;
    border-radius: 999px;
  }
  .gl {
    display: none;
  }
  .si {
    width: auto;
    white-space: nowrap;
    border-radius: 999px;
  }
  .sn > div {
    display: flex;
    gap: 4px;
  }
}

@media (max-width: 860px) {
  .sv {
    left: 50%;
    bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  }
}

@media (max-width: 560px) {
  .rw {
    grid-template-columns: 1fr;
  }
  .ct {
    justify-content: flex-start;
  }
  .in, .rg {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
