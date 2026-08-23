# FlowGuard Mobile

Expo/React Native companion app for the existing FastAPI platform. It includes live executive metrics, a fraud-scored anomaly queue, the explainable AI analyst, automation-routed alerts with acknowledgement, RBAC, and encrypted session storage.

## Run

1. Start the FlowGuard backend on port 8000.
2. Copy `.env.example` to `.env` and use your computer's LAN IP. A physical phone cannot reach the computer through `localhost`.
3. Run `npm install`, then `npm start`, from this directory.
4. Scan the QR with Expo Go or launch an emulator.

The hackathon Manager credentials are prefilled for a smooth demo. Remove those defaults before production. Store distribution also needs branded icon/splash assets, HTTPS, EAS build profiles, native reset/terms screens, and backend push-token registration.
