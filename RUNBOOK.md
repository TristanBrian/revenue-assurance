# 📱 FlowGuard Mobile – Deployment, Testing & Operational Runbook

> **Quick Navigation:** [Quick Start](#-quick-start--expo-go) · [Emulators](#-emulator--simulator-alternatives) · [Test Matrix](#-verification-test-matrix) · [Backend Sync Note](#-backend-divergence--ai-analyst-note) · [Publishing & Production](#-publishing--production-deployment)

---

## 🚀 Quick Start – Expo Go (Physical Phone)

The fastest way to test FlowGuard Mobile is using **Expo Go** on a physical Android or iPhone connected to the same Wi-Fi network as your workstation.

### Step 1: Start the Backend & Database
From the project root:
```bash
docker compose up db backend
```
Confirm the backend API is healthy by visiting in your browser:
```http
http://localhost:8000/health
```
*(Expected response: `{"status": "healthy", "database": "connected", "version": "2.0.0"}`)*

---

### Step 2: Configure Mobile API Address
Find your workstation's local area network (LAN) IP address:
```bash
hostname -I
```
*Example IP:* `192.168.1.20`

Navigate to the `mobile` directory and set up `.env`:
```bash
cd mobile
cp .env.example .env
```
Edit `mobile/.env` to point to your computer's LAN IP:
```env
EXPO_PUBLIC_API_URL=http://192.168.1.20:8000
```
> ⚠️ **Critical:** Do **not** use `localhost` or `127.0.0.1` when testing on a physical phone — `localhost` on a phone refers to the phone itself. Ensure both your computer and phone are connected to the **same Wi-Fi network**.

---

### Step 3: Start the Mobile App
From the `mobile` folder, start the Expo dev server:
```bash
npm start
```
If Expo cache causes resolution or bundling issues, run with cache cleared:
```bash
npx expo start --clear
```

---

### Step 4: Launch on Physical Phone
1. Install **Expo Go** from Google Play Store (Android) or Apple App Store (iOS).
2. Scan the QR code printed in your terminal:
   - **iOS:** Open the default **Camera app** and tap the Expo link banner.
   - **Android:** Open the **Expo Go app** and tap **"Scan QR Code"**.
3. Log in using the prefilled demo credentials:
   - **Email:** `manager@kpc-demo.co.ke`
   - **Password:** `demo-pass-123`

---

## 💻 Emulator & Simulator Alternatives

### Android Emulator (Android Studio)
1. Ensure Android Studio and an Android Virtual Device (AVD) are running.
2. In `mobile/.env`, set:
   ```env
   EXPO_PUBLIC_API_URL=http://10.0.2.2:8000
   ```
   *(Note: `10.0.2.2` is the special alias to host `localhost` inside Android emulator).*
3. Run:
   ```bash
   npm run android
   ```

### iOS Simulator (macOS only)
1. Ensure Xcode Simulator is open.
2. In `mobile/.env`, set:
   ```env
   EXPO_PUBLIC_API_URL=http://localhost:8000
   ```
3. Run:
   ```bash
   npm run ios
   ```

---

## 🧪 Verification Test Matrix (5 Core Flows)

Verify these 5 end-to-end flows to confirm operational readiness:

| # | Flow | Steps to Verify | Expected Outcome |
|---|------|-----------------|------------------|
| **1** | **Sign-In & Session Persistence** | Log in with demo credentials, force close the app, and reopen it. | Session persists securely via `expo-secure-store`; user bypasses login and lands on Dashboard. |
| **2** | **Overview Direction Toggle** | On main Dashboard, tap `Revenue` (Inbound), `Stipends` (Outbound), and `All`. | Metric cards and exposure figures update dynamically per money flow. |
| **3** | **Live Metrics Pull-to-Refresh** | Pull down on the Overview dashboard screen. | Spinner activates, fresh metrics are fetched from backend, and updated timestamp/values render. |
| **4** | **Anomaly Queue & Fraud Scores** | Tap **Anomalies** tab; inspect list of flagged transactions. | Dispatches/stipends display financial amounts, risk levels, and AI fraud risk percentages (e.g., `AI risk 85%`). |
| **5** | **Alerts Inbox & Acknowledgement** | Tap **Alerts** tab; tap an unread operational alert card. | Alert marks as read, card opacity changes, and acknowledgement endpoint (`POST /api/alerts/{id}/read`) succeeds. |

---

## ⚠️ Backend Divergence & AI Analyst Note

> [!NOTE]
> The **AI Analyst screen** (`/api/fraud/chat`) relies on the conversational fraud-scoring endpoint added in the latest backend updates. If your local backend is behind main, that screen will return a controlled fallback error (`Cannot reach FlowGuard...` or `404`). The remaining 4 core screens (Overview, Anomalies, Alerts Inbox, Profile) are fully operational against current APIs.

---

## 📦 Publishing & Production Deployment

To publish and distribute FlowGuard Mobile for production deployment:

### 1. Production API Environment Setup
Update `mobile/.env` (or set environment variables in your build provider):
```env
EXPO_PUBLIC_API_URL=https://revenue-assurance.fly.dev
```

### 2. Static Web Export
To generate a static web build of the Expo application:
```bash
cd mobile
npx expo export --platform web
```
The static web bundle will be generated in `mobile/dist/` ready for hosting on Vercel, Netlify, or Fly.io.

### 3. Native Application Builds (EAS Build)
To build standalone `.apk` / `.aab` for Android and `.ipa` for iOS using Expo Application Services (EAS):

1. **Install EAS CLI & Log In:**
   ```bash
   npm install -g eas-cli
   npx eas login
   ```
2. **Configure Project:**
   ```bash
   npx eas build:configure
   ```
3. **Build Android APK (Preview/Testing):**
   ```bash
   npx eas build --platform android --profile preview
   ```
4. **Build Production Apps (Play Store / App Store):**
   ```bash
   npx eas build --platform android --profile production
   npx eas build --platform ios --profile production
   ```
5. **Submit to App Stores:**
   ```bash
   npx eas submit --platform android
   npx eas submit --platform ios
   ```

---

*FlowGuard Mobile • Built for KPC Revenue Assurance & Inuka Foundation Governance*
