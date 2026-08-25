# 📱 FlowGuard Mobile

Expo/React Native companion application for the FlowGuard Revenue Assurance and Inuka Governance platform. It provides executive metrics, a fraud-scored anomaly queue, an explainable AI analyst, automation-routed alerts with instant acknowledgement, RBAC, and secure session storage.

---

## 🛠️ How the Mobile App is Built

- **Framework:** React Native + Expo (v57) with Expo Router for file-based navigation.
- **Security:** `expo-secure-store` for encrypted token and session persistence.
- **State & Theme:** React Hooks, custom dark theme tokens (`#051515` background, `#14A39A` cyan accents).
- **Backend Integration:** RESTful API client targeting FastAPI backend (`EXPO_PUBLIC_API_URL`).
- **Features:**
  - **Overview Pulse:** Executive cards, exposure figures, direction toggle (`Revenue` / `Stipends` / `All`), pull-to-refresh.
  - **Anomaly Queue:** Financial anomaly breakdown with AI risk scoring (`AI risk 85%`).
  - **Explainable AI Analyst:** Interactive fraud assistant (`POST /api/fraud/chat`).
  - **Response Inbox:** Alert inbox with tap-to-acknowledge functionality (`POST /api/alerts/{id}/read`).
  - **User Profile:** RBAC role display and secure logout.

---

## 🚀 Quick Start (Expo Go on Physical Device)

1. **Start Backend & Database:**
   ```bash
   docker compose up db backend
   ```
   Verify status at `http://localhost:8000/health`.

2. **Configure Mobile API URL:**
   Find your workstation LAN IP (``hostname -I``, e.g., `192.168.1.20`).
   ```bash
   cp .env.example .env
   ```
   In `.env`:
   ```env
   EXPO_PUBLIC_API_URL=http://192.168.1.20:8000
   ```

3. **Start Development Server:**
   ```bash
   npm start
   # Or clear cache:
   npx expo start --clear
   ```

4. **Launch on Phone:**
   Scan the QR code printed in terminal using Expo Go app (Android) or default Camera app (iOS).

   **Prefilled Demo Credentials:**
   - Email: `manager@kpc-demo.co.ke`
   - Password: `demo-pass-123`

---

## 💻 Emulators

- **Android Emulator:** Set `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000` and run `npm run android`.
- **iOS Simulator:** Set `EXPO_PUBLIC_API_URL=http://localhost:8000` and run `npm run ios`.

---

## 📦 Building & Publishing

### Static Web Export
```bash
npx expo export --platform web
```

### Standalone Native Builds (EAS Build)
1. Install EAS CLI: `npm install -g eas-cli`
2. Log in & Configure: `npx eas login && npx eas build:configure`
3. Build Android APK: `npx eas build --platform android --profile preview`
4. Build Production Binaries:
   ```bash
   npx eas build --platform android --profile production
   npx eas build --platform ios --profile production
   ```
5. Publish to App Stores: `npx eas submit`

---

For the full step-by-step verification matrix and runbook, see the root [`RUNBOOK.md`](../RUNBOOK.md).
