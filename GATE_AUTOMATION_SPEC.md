# Autonomous Gate Lockout & Gantry Telemetry Automation Specification

**System**: Reconova KPC Oil Depot Autonomous Control Plane  
**Component**: Optical Gate Clearance & Volumetric Barrier Automation  
**Date**: September 2026  

---

## 1. Executive Summary

The **Autonomous Gate Control System** replaces manual security gate checks with automated, real-time optical telemetry, gantry volumetric matrix validation, and hardware barrier arm enforcement. 

When an oil tanker attempts to exit a KPC depot, the autonomous control plane verifies that the physical volume loaded into the truck matches the tax-billed commercial invoice. If unbilled fuel is detected, the barrier arm is **instantly locked**, an automated **KRA iCMS tax adjustment note** is issued, and an incident alert is dispatched.

```mermaid
flowchart TD
    A[Gate Alpha ANPR Optical Scanner] --> B[Gantry Bay Docking & Meter Reading]
    B --> C{Volumetric Variance Check}
    C -->|Variance <= Tolerance| D[🟢 Barrier Arm Opens / Gate Cleared]
    C -->|Variance > 50L Unbilled| E[🔴 GATE_HOLD Triggered - Barrier Locked]
    E --> F[Automated KRA iCMS Tax Debit Note Issued]
    E --> G[Auto-Demurrage Billing (> 45m Dwell)]
    E --> H[Depot Manager Incident Pager Dispatched]
    E --> I[Emergency Override Option - KPC-MGR Auth Required]
```

---

## 2. End-to-End Gate Traversal Lifecycle

### Step 1: Gate Alpha Entry & Identification
- **ANPR Telemetry**: High-speed camera reads truck registration (e.g. `KCB 123A` or `KDD 104B`).
- **Dispatch Linking**: Links truck ID to the OMC Bill of Lading (BoL) commercial manifest.

### Step 2: Gantry Bay Docking & Loading
- **Bay Assignment**: Truck parks at assigned depot bay (Bays 01–06).
- **Product Categorization**: Identifies fuel type:
  - **PMS**: Premium Motor Spirit (Petrol) — 0.5% evaporation threshold
  - **AGO**: Automotive Gas Oil (Diesel) — 0.3% evaporation threshold
  - **IK**: Illuminating Kerosene — 0.2% evaporation threshold

### Step 3: Optical Laser Telemetry Scan
- Physical flow meters and optical compartment sensors measure total loaded volume ($V_{\text{meter}}$).
- Invoice engine fetches billed volume ($V_{\text{invoice}}$).
- **Variance Equation**:
  $$\text{Unbilled Delta } (\Delta V) = V_{\text{meter}} - V_{\text{invoice}}$$

---

## 3. Automated Gate Clearance & Lockout Logic

| Scenario | Condition | Automated System Action | Barrier Arm State |
| :--- | :--- | :--- | :--- |
| **Pass / Matched** | $\Delta V \le \text{Evaporation Threshold}$ | `status = 'PASS'`. Logs clearance event to audit stream. | 🟢 **OPEN** (Cleared for exit) |
| **Hold / Unbilled Overhang** | $\Delta V > 50\text{ Liters}$ | `status = 'HOLD'`. Calls `/api/v1/control/lockout-check`. Triggers KRA tax debit note & PagerDuty. | 🔴 **LOCKED** (Exit blocked) |
| **Warning / Dwell Excess** | Dwell Time $> 45\text{ mins}$ | `status = 'WARNING'`. Triggers auto-demurrage invoice (KES 150/min excess). | 🟡 **HELD** (Pending settlement) |

---

## 4. Automated Tax & Remediation Integration

When a gate lockout occurs (e.g., Truck `KDD 104B` with $+6,500\text{ L}$ unbilled AGO at `Bay 02`):

1. **KRA iCMS Tax Gateway Interconnect**:
   - Posts to `/api/v1/control/icms-adjustment-note`.
   - Generates e-Tax Debit Note referencing KRA PIN `P051123456Z` at KES 145.50/L.
   - Returns electronic acknowledgement: `Ref: KRA-ADJ-KDD104B-2026`.
2. **Auto-Demurrage Billing**:
   - Calculates excess dwell duration beyond free 45-minute limit.
   - Issues automated demurrage invoice to OMC (e.g., Lake Oil).
3. **Manager Emergency Gate Override**:
   - If manual override is required for emergency safety, the manager inputs key code `KPC-MGR-9941`.
   - The system unlocks the barrier arm and records an immutable cryptographically hashed audit entry.

---

## 5. Verification & Test Suite

The gate automation system is covered by automated unit tests in `frontend/src/__tests__/GantryYardControl.test.tsx`:
- ✅ Header telemetry & loading bay rendering
- ✅ 3D Isometric vs 2D Blueprint view mode switching
- ✅ Optical scanning & barrier status halo updates
- ✅ Inspector modal automated hold preview (`🔒 EXIT BLOCKED` vs `🟢 BARRIER CLEARED`)
- ✅ Manager emergency override authorization code validation
