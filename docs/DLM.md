# DLM (Dynamic Load Management) — Usage Guide

The VCP can be used to test Dynamic Load Management end to end. It has two halves:

- **Charger side** — the simulated charger accepts OCPP `SetChargingProfile` messages, applies the current/power limit, and reflects it in its `MeterValues` (per phase) so the platform can observe compliance. At an effective **0 A** it reports `SuspendedEVSE` and resumes `Charging` when the limit lifts.
- **DLM-device emulation** — the VCP can also act as a **load-balancer device** (e.g. Charge-M8 Libra), streaming site-meter readings to the platform so the platform's DLM calculation runs and emits charging profiles — no physical hardware required.

> Scope: OCPP **1.6** only.

## How the real loop works (for context)

1. A DLM device (Libra) reports site-meter readings every ~5 s.
2. The platform computes available capacity (`SiteMax − reading`, minus a safety reserve) and the current site load from the chargers' `MeterValues`.
3. The platform sends each charger a **`TxProfile`** (`chargingRateUnit: "A"`), e.g. "60 A for 900 s, then 0 A". Fresh profiles arrive before the previous one expires; all profiles in a session share one `transactionId` and each overwrites the last.
4. The charger applies the limit; the platform watches its `MeterValues`.

The VCP reproduces both the charger side (steps 3–4) and, optionally, the device side (step 1).

---

## Quick start (control UI)

1. Run the control server: `npm run dev` (serves on `http://localhost:3000`).
2. Open `http://localhost:3000/control` and log in.
3. **Start VCPs** tab → set the endpoint + Charge Point ID. Under **Advanced options** set **Charger Power kWh** and **Phases** (single- or three-phase — this controls how limits are reported in `MeterValues`). Start it, ideally with a charging session running.
4. Apply a limit one of two ways:
   - Let your CSMS/DLM send a real `SetChargingProfile`, **or**
   - Use the **Charging Profile** tab to inject one manually (below).
5. Watch compliance in the **Change Status** tab: enter the Charge Point ID + connector, click **Get Status**, and the badge shows the applied limit (e.g. `Limit: 16.0 A · TxProfile #501`). The charger's outgoing `MeterValues` carry the limited `Current.Import`.
6. To test the full loop, use the **DLB Device** tab to start an emulated Libra and drive the platform (below).

---

## Part A — Charger side (applying charging profiles)

### From a real CSMS
No action needed — the VCP now handles `SetChargingProfile`, `ClearChargingProfile`, and `GetCompositeSchedule`. Incoming profiles are stored and take effect immediately (an extra `MeterValues` sample is emitted on change so you don't wait for the 30 s tick).

Supported purposes and precedence: a **`TxProfile`** (or, failing that, a **`TxDefaultProfile`**) drives the limit, capped by any **`ChargePointMaxProfile`** on connector 0. Highest `stackLevel` wins; a `TxProfile` only applies while a transaction is active.

### From the control UI (manual injector)
**Charging Profile** tab → set Charge Point ID, Connector, Purpose, Limit + Unit (A/W), Stack Level, Number of Phases, Duration → **Send Charging Profile**. **Clear Profiles** removes them. The profile is applied locally (as if received from the CSMS); no message is faked back to the platform.

### From the API
```bash
# Apply a 16 A TxProfile to connector 1
curl -s -X POST http://localhost:3000/api/vcp/set-charging-profile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"chargePointId":"VCP_ALAN_01","connectorId":1,"purpose":"TxProfile","limit":16,"unit":"A"}'

# Clear all profiles on the charge point
curl -s -X POST http://localhost:3000/api/vcp/set-charging-profile \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"chargePointId":"VCP_ALAN_01","connectorId":1,"clear":true}'
```
Body fields: `chargePointId` (required), `connectorId` (default 1), `limit`, `unit` (`A`|`W`, default `A`), `purpose` (default `TxProfile`), `stackLevel` (default 0), `numberPhases` (default: the VCP's phase count), `duration` (seconds, default 86400), `clear` (bool).

### Observing compliance
- **Badge / API:** `GET /api/vcp/connector-status?chargePointId=…&connectorId=1` returns `appliedLimitAmps`, `appliedLimitWatts`, `numberPhases`, `limitSource` (`{chargingProfileId, purpose, stackLevel}` or `null`), and `activeProfileCount`.
- **MeterValues:** `Current.Import` reflects the limit — one `L1` sample for single-phase, `L1/L2/L3` for three-phase. Energy accrues at the limited power.
- **Composite schedule:** the CSMS can call `GetCompositeSchedule` to read back the effective schedule.
- **0 A behaviour:** an effective 0 A limit reports `Current.Import` 0 and sends `StatusNotification` `SuspendedEVSE`; a limit > 0 resumes `Charging`.

### Physical clamp
Limits are clamped to the charger's rating (`power` kW at ~245 V per phase). A 7 kW single-phase charger caps at ~28.6 A regardless of a higher requested limit; a 3-phase 10 A request on a 7 kW unit clamps to ~9.5 A/phase. Set **Power** and **Phases** to match the charger you're emulating.

---

## Part B — DLM device emulation (full loop, no hardware)

The VCP can connect to the CSMS as a DLM/load-balancer device and stream site-meter readings, so the platform's DLM calculation runs and it sends `TxProfile`s to the chargers.

### From the control UI
**DLB Device** tab → pick **Endpoint**, **DLB Brand** (e.g. *Charge-M8*), **DLB Model** (e.g. *Charge-M8-Libra-DLB*), **Device ID** (e.g. `DLB0001`), **Baseline Site Load (kW)**, **Phases**, and whether to **include live charger load** in the reading → **Start DLB Device**. Then:
- **Apply Load** pushes an updated baseline live — *this is the main test lever*: raise it to shrink available capacity → the platform sends lower `TxProfile`s → the chargers throttle (visible in their MeterValues/badge) → their reported load drops → the platform recalculates.
- **Stop** disconnects the device; **Refresh status** shows the last reading sent.

### From the API
```bash
# Start an emulated Charge-M8 Libra reporting a 10 kW baseline (3-phase),
# including live charger draw in the reading
curl -s -X POST http://localhost:3000/api/vcp/dlm/start \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"endpoint":"wss://ocpp.test.electricmiles.io","deviceTypeId":"Charge-M8-Libra-DLB","deviceId":"DLB0001","baselineLoadWatts":10000,"includeChargerLoad":true,"phases":3}'

# Drive the DLM: raise the reported baseline to 40 kW
curl -s -X POST http://localhost:3000/api/vcp/dlm/update \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"DLB0001","baselineLoadWatts":40000}'

# Inspect / list types / stop
curl -s http://localhost:3000/api/vcp/dlm/status  -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/vcp/dlm/types   -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/api/vcp/dlm/stop \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"DLB0001"}'   # omit deviceId to stop all
```
`dlm/start` fields: `endpoint`, `deviceTypeId`, `deviceId` (required); `baselineLoadWatts` (default 0), `includeChargerLoad` (default true), `voltagePerPhase` (default 245), `phases` (default 3).

### Charge-M8 Libra wire format
The device sends readings as an OCPP `DataTransfer`:
```json
{"vendorId":"Charge-M8","messageId":"MeterValues",
 "data":"{\"DeviceId\":\"DLB0001\",\"Ts\":\"…Z\",\"Energy.Active.Import.Register\":3502,\"Power.Active.Import\":0,\"Power\":[0,0,0],\"Voltage\":[245000,245000,245000],\"Current.Import\":[0,0,0]}"}
```
`Voltage`, `Power`, and `Current.Import` are scaled **×1000** (e.g. `245000` = 245.0 V); `Energy.Active.Import.Register` is raw Wh. Default reporting interval is **5 s**.

The reported site load = `baselineLoadWatts` + (live charger load, if enabled), split across the configured phases.

---

## Full-loop walkthrough

1. Start a VCP (7 kW, single-phase) with a charging session against your test CSMS.
2. Start a **Charge-M8 Libra** DLM device against the same CSMS/site, `includeChargerLoad: true`, small baseline.
3. Confirm the charger draws freely (no limit) and the DLM device streams readings (`dlm/status`).
4. Raise the DLM baseline (`dlm/update`) past the site limit → the platform issues a lower `TxProfile` → the charger's `Current.Import` drops and the connector badge shows the new limit.
5. Push the baseline high enough that available capacity hits 0 → the charger reports `SuspendedEVSE`.
6. Lower the baseline → the charger resumes and ramps back up.

---

## Adding a new DLM device type

DLM devices are pluggable. To add a vendor:

1. Implement `DlmDeviceType` (see [`src/dlm/deviceType.ts`](../src/dlm/deviceType.ts)) — `id`, `brand` (groups models in the **DLB Brand** dropdown), `label` (the model name shown in **DLB Model**), `defaultReportIntervalMs`, and `buildReadingCall(reading)` which turns a `DlmReading` (volts/amps/watts/Wh) into that vendor's OCPP frame and scaling. Model it on [`src/dlm/chargeM8Libra.ts`](../src/dlm/chargeM8Libra.ts).
2. Register it in [`src/dlm/registry.ts`](../src/dlm/registry.ts).

That's all — the runtime, API, and the UI's device-type dropdown pick it up automatically.

---

## Getting an API token

The `/api/vcp/*` and `/api/vcp/dlm/*` endpoints require a JWT (the control UI logs in for you). For scripting:
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"em","password":"'"$USERS_PASSWORD"'"}' | jq -r .data.access_token)
```
`USERS_PASSWORD` and `JWT_SECRET` come from the environment (see `.env.example`).

---

## Notes & limitations

- Periodic `MeterValues` are sent every 30 s, but `SetChargingProfile`/`ClearChargingProfile` and the manual injector emit an immediate sample so limit changes surface without waiting.
- With no profile active, `MeterValues` are unchanged from the pre-DLM behaviour (a single unphased `28.67 A` sample, energy from the rated power).
- `Recurring` schedules are approximated (anchored to start-of-day/week); `Absolute`/`Relative` are exact.
- The emulated DLM device does not respond to inbound OCPP Calls from the CSMS (it only pushes readings).
- OCPP 2.0.1 smart charging is out of scope.
