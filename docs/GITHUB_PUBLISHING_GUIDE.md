# Panduan Pengunggahan Project ke GitHub (GitHub Publishing Guide)
**Project:** Quantis Video Management System (VMS)  
**Target Platform:** GitHub (Public / Private Repository)  
**Dokumen Referensi:** `docs/WSL_OPTIMIZATION_AUDIT.md` & `README.md`

---

## 1. Ringkasan Kesiapan & Batasan GitHub

Sebelum melakukan `git push`, pastikan memahami batasan platform GitHub (berlaku untuk semua jenis akun, termasuk **GitHub Pro**):

| Aturan Platform | Batasan | Status Project Quantis |
| :--- | :--- | :--- |
| **Batas Maksimal 1 File** | **100 MB** (*Hard Block*) | ✅ **LULUS**: File video besar (`1minuteroad.mp4`, `hik1.mp4`) & disk WSL (`ext4.vhdx`) telah di-exclude oleh `.gitignore`. |
| **Batas Rekomendasi Repositori** | **< 1 GB** (Maksimal 5 GB) | ✅ **LULUS**: Total ukuran seluruh source code & aset yang akan di-push hanya **~78 MB**. |
| **Pembersihan Kredensial** | **Zero Secret Leaks** | ✅ **LULUS**: Seluruh password fisik CCTV (`REDACTED-LEAKED-PASSWORD`) & IP LAN (`192.168.100.67`) telah disanitasi 100% menjadi mock data. |
| **Model AI YOLO** | **Wajib disertakan untuk build** | ✅ **LULUS**: File `services/ai-vision-worker/yolov8n.pt` (6,5 MB) telah diberi pengecualian di `.gitignore` (`!yolov8n.pt`). |
| **Komponen Inti & Migrasi** | **Lengkap & Terverifikasi** | ✅ **LULUS**: Service `rtsp-proxy`, migrasi DB `002`-`004`, dan UI dashboard baru telah terdaftar. |

---

## 2. Checklist Pra-Push (Pre-Push Checklist)

Pastikan poin-poin berikut telah terpenuhi di lingkungan lokal Anda:

- [x] **Kredensial Aman**: Password asli CCTV telah diganti dengan placeholder generik (`SecretPassword123@`, `192.168.1.100`).
- [x] **File `.env` Asli Diabaikan**: File `.env` lokal Anda aman diabaikan oleh `.gitignore`. Hanya file template `.env.example` yang akan terunggah.
- [x] **Build Monorepo Berhasil**: `pnpm build` menghasilkan kode terkompilasi tanpa error TypeScript.
- [x] **Model YOLO Siap**: `services/ai-vision-worker/yolov8n.pt` ikut ter-commit agar pengguna baru tidak mengalami error saat `docker compose build`.
- [x] **WSL Virtual Disk Terisolasi**: Folder `wsl/` dan file `ext4.vhdx` (32,9 GB) tidak akan pernah tersentuh oleh Git.

---

## 3. Langkah-Langkah Eksekusi Git Push ke GitHub

Buka PowerShell atau Terminal di direktori project `D:\anothervms`, lalu jalankan langkah-langkah berikut:

### Langkah 1: Periksa Status File yang Siap Di-Commit
```powershell
git status
```
*Pastikan tidak ada file berukuran > 100 MB atau folder `data/` dan `wsl/` yang masuk.*

### Langkah 2: Daftarkan Seluruh Perubahan (Stage All)
```powershell
git add .
```

### Langkah 3: Buat Commit Bersih
```powershell
git commit -m "feat: complete Quantis VMS architecture, sanitize credentials, and update documentation for distribution"
```

### Langkah 4: Tautkan dengan Repository GitHub Anda
Jika Anda membuat repository baru di web GitHub (misalnya: `https://github.com/username/quantis.git`), hubungkan remote repository:
```powershell
# Ganti URL di bawah dengan URL repository GitHub Anda
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/quantis.git

# Pastikan branch utama bernama main
git branch -M main
```
*(Jika remote `origin` sudah ada sebelumnya, lewati `remote add` atau gunakan `git remote set-url origin <URL>`)*.

### Langkah 5: Unggah ke GitHub (Push)
```powershell
git push -u origin main
```

---

## 4. Panduan untuk Teman / Rekan Tim / User Lain yang Meng-clone

Ketika rekan Anda atau Anda sendiri di laptop/komputer lain ingin menjalankan Quantis, cukup berikan 4 instruksi mudah berikut (sudah tertulis di [`README.md`](../README.md)):

```bash
# 1. Clone repository
git clone https://github.com/YOUR_GITHUB_USERNAME/quantis.git
cd quantis

# 2. Salin environment
cp .env.example .env

# 3. Install & compile monorepo
pnpm install
pnpm build

# 4. Jalankan seluruh sistem VMS
docker compose up -d
# (atau klik dua kali start-vms.bat pada Windows)
```

Dashboard langsung siap dibuka di browser pada:  
👉 **`http://localhost:8080`** (atau `http://localhost:5173`)

---

## 5. Pertanyaan Umum (FAQ)

### Q: Kenapa file WSL `ext4.vhdx` tidak diupload ke GitHub?
> **Jawaban:** File `.vhdx` adalah seluruh virtual hard disk sistem operasi (32,9 GB). Mengupload VHDX tidak praktis, melanggar batas ukuran GitHub, dan tidak dapat dipakai di komputer lain dengan arsitektur hardware berbeda. Dengan Docker, pengguna lain cukup menjalankan `docker compose up -d`, dan Docker akan otomatis mengunduh base image resmi serta membangun container yang identik dalam hitungan menit.

### Q: Apakah FFmpeg CUDA dan YOLO akan berfungsi di komputer lain?
> **Jawaban:** Ya! Dockerfile worker menarik base image publik `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest` dari GitHub Container Registry. Asalkan komputer tujuan memiliki GPU NVIDIA dan driver NVIDIA Container Toolkit terpasang, akselerasi perangkat keras NVENC dan CUDA akan otomatis aktif.

### Q: Apakah akun GitHub Pro memberikan ruang upload file tak terbatas?
> **Jawaban:** Tidak. Batas ukuran 1 file tetap **100 MB** untuk semua akun. Akun Pro memberikan kuota Git LFS gratis sebesar 2 GB/bulan, repositori privat tak terbatas, serta fitur kolaborasi tim tingkat lanjut. Namun untuk project Quantis, seluruh repository hanya berukuran **~78 MB**, sehingga tidak memerlukan Git LFS berbayar.

