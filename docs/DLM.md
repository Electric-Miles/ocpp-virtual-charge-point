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

**DLB Device** tab → pick **Endpoint**, **DLB Brand** (e.g. _Charge-M8_), **DLB Model** (e.g. _Charge-M8-Libra-DLB_), **Device ID** (e.g. `DLB0001`), **Site load excluding chargers (kW)**, **Phases**, and whether to **add live charger draw to the reading** → **Start DLB Device**. Then:

`nonChargerLoadWatts` (the UI's **Site load excluding chargers**) is the site's non-charger consumption — what the building draws with no EVs plugged in. It is not a capacity or a limit; the reading the device sends is this plus the live charger load.

`includeChargerLoad` adds what this process's VCP connectors are drawing right now — each active connector's effective profile limit, or its rated power if unlimited. That is what closes the loop: the platform throttles, the chargers draw less, the next reading drops. Turn it off to hold the meter at the non-charger figure regardless of charger behaviour. Chargers outside this process are never counted.

- **Apply Load** pushes an updated non-charger load live — _this is the main test lever_: raise it to shrink available capacity → the platform sends lower `TxProfile`s → the chargers throttle (visible in their MeterValues/badge) → their reported load drops → the platform recalculates.
- **Stop** disconnects the device; **Refresh status** shows the last reading sent.

### From the API

```bash
# Start an emulated Charge-M8 Libra on a site drawing 10 kW outside the
# chargers (3-phase), including live charger draw in the reading
curl -s -X POST http://localhost:3000/api/vcp/dlm/start \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"endpoint":"wss://ocpp.test.electricmiles.io","deviceTypeId":"Charge-M8-Libra-DLB","deviceId":"DLB0001","nonChargerLoadWatts":10000,"includeChargerLoad":true,"phases":3}'

# Drive the DLM: raise the reported non-charger load to 40 kW
curl -s -X POST http://localhost:3000/api/vcp/dlm/update \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"DLB0001","nonChargerLoadWatts":40000}'

# Inspect / list types / stop
curl -s http://localhost:3000/api/vcp/dlm/status  -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/vcp/dlm/types   -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3000/api/vcp/dlm/stop \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"DLB0001"}'   # omit deviceId to stop all
```

`dlm/start` fields: `endpoint`, `deviceTypeId`, `deviceId` (required); `nonChargerLoadWatts` (default 0), `includeChargerLoad` (default true), `voltagePerPhase` (default 245), `phases` (default 3).

Install-specific fields, all defaulting to what the observed Libra did (see below): `reportIntervalMs` (default 11000), `voltageSensePhases` (default 1), `phaseBalance` (default `[1.027,1.106,0.867]`), `unmeasuredPhaseOffsetsW` (default `[0,-30,0]`), `quantisation` (default `{powerW:30,currentA:0.3,voltageV:0.1}`; 0 disables a channel), `reportEnergyRegister` (default false).

### Charge-M8 Libra wire format

The device sends readings as an OCPP `DataTransfer`:

```json
{
  "vendorId": "Charge-M8",
  "messageId": "MeterValues",
  "data": "{\"DeviceId\":\"DLB0001\",\"Ts\":\"2026-09-09T08:18:43Z\",\"Energy.Active.Import.Register\":0,\"Power.Active.Import\":7620,\"Power\":[7650,-30,0],\"Voltage\":[238400,0,0],\"Current.Import\":[32400,24000,18300]}"
}
```

**Provenance and its limits.** This is reconstructed from **one** device — serial `202504110050`, 250 consecutive readings over 45 min in the 2026-09-09 CSMS logs. Two of its traits are properties of the payload encoder and hold for any Libra; the rest are plausibly functions of how _that_ site was wired and configured, so the emulator defaults to them but lets you override each one.

Fixed, firmware-level:

- **Scaling.** Only `Voltage` (mV) and `Current.Import` (mA) are ×1000 — `Power` and `Power.Active.Import` are **plain watts**. `Power[0] / (V1 × I1)` implies a power factor of 0.956–0.994 across the whole sample, which pins the watts as unscaled; a ×1000 `Power` field would imply a power factor of ~982. This is an encoding decision, not a wiring one.
- **`Ts`.** Whole seconds, no milliseconds. It is the device's own sample time, typically 0–2 s before the CSMS receives it.

Observed on this install, overridable (`dlm/start` field in brackets):

- **Voltage sensing** [`voltageSensePhases`, default 1]. This unit reported voltage and power for **L1 only** while `Current.Import` carried all three phases. That is wiring rather than a hardware limit: the L2 and L3 CTs read 17–30 A in _every_ sample (minimum 17.4 / 12.6 A), so it is a live 3-phase site whose device simply has no voltage reference on L2/L3. Set this to 3 for a fully sensed install.
- **Phase imbalance** [`phaseBalance`, default `[1.027,1.106,0.867]`]. The site ran a _sustained_ imbalance, not an even split: per-phase current relative to the mean phase averaged 1.027 / 1.106 / 0.867 (L1 spread 0.883–1.301, L2 0.964–1.239, L3 0.735–1.036). The worst phase sat **13% above the mean phase on average and up to 30%**. Values are shares of the total site load and are renormalised over the live phases, so changing them redistributes load without changing the total. Pass `[1,1,1]` for a balanced site.
- **Unmeasured-phase offsets** [`unmeasuredPhaseOffsetsW`, default `[0,-30,0]`]. On the phases it could not measure in watts, this unit reported a constant **−30 W** on L2 and a clean 0 on L3 — small per-channel CT offsets. Another unit could sit anywhere near zero.
- **Resolution** [`quantisation`, default 30 W / 0.3 A / 0.1 V]. Established as the GCD over all 250 samples; note 30 W ÷ 0.3 A = exactly 100 V, so they share one internal scaling factor. Current resolution plausibly tracks the configured CT ratio, so different clamps may quantise differently.
- **Reporting interval** [`reportIntervalMs`, default 11000]. Observed gaps: 10 s ×64, 11 s ×171, 12 s ×8, 13 s ×5, 15 s ×1 (mean 10.8 s). A reporting interval is the kind of thing that is a device setting, and CSMS-side logs cannot separate the device's timer from delivery jitter anyway. Raise it past your platform's reading-staleness threshold to see what DLM does when a device goes quiet.
- **Energy register** [`reportEnergyRegister`, default false]. `Energy.Active.Import.Register` is raw Wh, but this unit left it at **0** — 45 min at ~5 kW should have accrued ~3.7 kWh and it never moved. Whether that is firmware or configuration is not decidable from one sample, so set this true to report the emulator's accrual instead.

The reported site load = `nonChargerLoadWatts` + (live charger load, if enabled), distributed across the configured phases per `phaseBalance`. The total is always preserved; only its split across phases changes.

**If DLM sizes on the worst phase, it has to read `Current.Import`.** The two observed traits compound badly for anything that reads `Power.Active.Import` instead:

- That field is L1-only on this install, so a 30 kW 3-phase site reports ~10 kW in it while the three `Current.Import` phases still carry the full 30 kW.
- **L2 was the worst phase in 194 of 250 samples** (L1 in the other 56) — and L2 is exactly the phase whose power the device does not report. So for ~78% of the sample the binding constraint was invisible in `Power.Active.Import`, and in the remaining 22% it was visible only by luck.

Together that means a worst-phase calculation fed from `Power.Active.Import` would under-read the constraint roughly four times out of five, and an even-split emulator would never have surfaced it. `dlm/status` now reports `worstPhaseAmps` alongside the last reading so you can check what the platform _should_ be sizing on.

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
