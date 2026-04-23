const { createApp } = Vue;
const CONFIG_STORAGE_KEY = "vcp_vue_control_config";
const ACCESS_TOKEN_KEY = "vcp_access_token";
const STATUS_POLL_INTERVAL_MS = 7000;

createApp({
  data() {
    return {
      user: {
        firstName: "User",
      },
      isAuthLoading: true,
      isStarting: false,
      isStopping: false,
      isChangingStatus: false,
      isRefreshing: false,
      pollTimerId: null,
      statusMessage: {
        type: "",
        text: "",
      },
      environmentOptions: [
        { key: "local", label: "Local Dev", endpoint: "ws://127.0.0.1:9000" },
        {
          key: "test",
          label: "Test",
          endpoint: "wss://ocpp.test.electricmiles.io",
        },
        {
          key: "stage1",
          label: "Stage 1",
          endpoint: "wss://ocpp.stage1.electricmiles.io",
        },
        {
          key: "stage2",
          label: "Stage 2",
          endpoint: "wss://ocpp.stage2.electricmiles.io",
        },
        {
          key: "production",
          label: "Production",
          endpoint: "wss://ocpp.electricmiles.io",
        },
      ],
      models: [
        "EVC01",
        "EVA-07S-SE",
        "EVC03",
        "KC-P30",
        "GL-EVIQ07WRS",
        "AC022K-BE-24",
      ],
      statusOptions: [
        "Offline",
        "Available",
        "Preparing",
        "Charging",
        "Finishing",
        "Faulted",
        "Reserved",
        "SuspendedEV",
        "SuspendedEVSE",
        "Unavailable",
      ],
      errorCodeOptions: [
        "NoError",
        "OtherError",
        "ConnectorLockFailure",
        "EVCommunicationError",
        "GroundFailure",
        "HighTemperature",
        "InternalError",
        "LocalListConflict",
        "OverCurrentFailure",
        "PowerMeterFailure",
        "PowerSwitchFailure",
        "ReaderFailure",
        "ResetFailure",
        "UnderVoltage",
        "OverVoltage",
        "WeakSignal",
      ],
      form: {
        environmentKey: "local",
        endpoint: "ws://127.0.0.1:9000",
        chargePointId: "VCP_DEMO_01",
        model: "EVC01",
        ocppVersion: "OCPP_1.6",
        connectors: 1,
        power: 7,
        sendBootStatus: true,
        testCharge: false,
        duration: 5,
        startChance: 100,
        randomDelay: false,
      },
      chargerCard: {
        chargePointId: "VCP_DEMO_01",
        endpoint: "ws://127.0.0.1:9000",
        model: "EVC01",
        vendor: "Vestel",
        version: "1.0.0",
        ocppVersion: "OCPP_1.6",
        connectors: 1,
        power: 7,
        status: "Available",
        online: true,
        lastAction: "BootNotification",
        lastCloseReason: "No disconnect recorded",
        vehiclePluggedIn: false,
        connectorId: 1,
        errorCode: "NoError",
        vendorErrorCode: "",
        info: "",
      },
      statusForm: {
        status: "Available",
        connectorId: 1,
        errorCode: "NoError",
        vendorErrorCode: "",
        info: "",
      },
      logs: [
        {
          id: 1,
          title: "Shell Ready",
          time: "09:00",
          message: "Vue CDN page mounted successfully with mocked state.",
        },
        {
          id: 2,
          title: "Layout",
          time: "09:01",
          message: "Header, config panel, charger card, and logs panel are visible.",
        },
      ],
    };
  },
  async mounted() {
    await this.bootstrapAuth();
    this.hydrateSavedConfig();
    this.syncChargerCardFromForm(this.form);
    this.normalizeCardState();
    this.syncStatusFormFromCard();
    this.beforeUnloadHandler = () => {
      this.stopPolling();
    };
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  },
  beforeUnmount() {
    this.stopPolling();
    if (this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
    }
  },
  computed: {
    selectedEnvironment() {
      return (
        this.environmentOptions.find(
          (option) => option.key === this.form.environmentKey,
        ) || this.environmentOptions[0]
      );
    },
    displayStatusText() {
      return `${this.chargerCard.status}`.toUpperCase();
    },
    statusClass() {
      return `status-${this.chargerCard.status.toLowerCase()}`;
    },
  },
  watch: {
    "form.environmentKey"(value) {
      const selected = this.environmentOptions.find((option) => option.key === value);
      if (!selected) {
        return;
      }

      this.form.endpoint = selected.endpoint;
      this.chargerCard.endpoint = selected.endpoint;
    },
    form: {
      deep: true,
      handler(newForm) {
        this.syncChargerCardFromForm(newForm);
        this.persistConfig();
      },
    },
    "chargerCard.status"() {
      this.normalizeCardState();
    },
  },
  methods: {
    getAuthHeaders() {
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem(ACCESS_TOKEN_KEY)}`,
      };
    },
    async bootstrapAuth() {
      const token = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) {
        window.location.href = "/login";
        return;
      }

      try {
        const response = await fetch("/api/auth/user", {
          method: "GET",
          headers: this.getAuthHeaders(),
        });

        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          window.location.href = "/login";
          return;
        }

        this.user.firstName = data.data.first_name || "User";
      } catch (_error) {
        window.location.href = "/login";
        return;
      } finally {
        this.isAuthLoading = false;
      }
    },
    hydrateSavedConfig() {
      try {
        const rawValue = localStorage.getItem(CONFIG_STORAGE_KEY);
        if (!rawValue) {
          return;
        }

        const savedConfig = JSON.parse(rawValue);
        this.form = {
          ...this.form,
          ...savedConfig,
        };
      } catch (_error) {
        localStorage.removeItem(CONFIG_STORAGE_KEY);
      }
    },
    persistConfig() {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(this.form));
    },
    syncChargerCardFromForm(form) {
      this.chargerCard.chargePointId = form.chargePointId;
      this.chargerCard.endpoint = form.endpoint;
      this.chargerCard.model = form.model;
      this.chargerCard.ocppVersion = form.ocppVersion;
      this.chargerCard.connectors = Number(form.connectors);
      this.chargerCard.power = Number(form.power);
      this.chargerCard.vendor = this.resolveVendor(form.model);
      this.chargerCard.version = this.resolveFirmware(form.model);

      // Single-VCP mode keeps one active connector selected by default.
      this.chargerCard.connectorId = Math.min(
        Math.max(Number(this.chargerCard.connectorId) || 1, 1),
        Number(form.connectors) || 1,
      );
      this.statusForm.connectorId = Math.min(
        Math.max(Number(this.statusForm.connectorId) || 1, 1),
        Number(form.connectors) || 1,
      );
    },
    normalizeCardState() {
      const activeStatus = this.chargerCard.status;
      this.chargerCard.online = activeStatus !== "Offline";

      if (activeStatus === "Faulted") {
        this.chargerCard.errorCode = this.chargerCard.errorCode || "OtherError";
      } else if (!this.chargerCard.errorCode || this.chargerCard.errorCode === "OtherError") {
        this.chargerCard.errorCode = "NoError";
      }

      if (
        activeStatus === "Preparing" ||
        activeStatus === "Charging" ||
        activeStatus === "Finishing"
      ) {
        this.chargerCard.vehiclePluggedIn = true;
      }

      if (activeStatus === "Available") {
        this.chargerCard.vehiclePluggedIn = false;
      }

      if (activeStatus === "Offline" || activeStatus === "Unavailable") {
        this.chargerCard.vehiclePluggedIn = false;
      }
    },
    syncStatusFormFromCard() {
      this.statusForm.status = this.chargerCard.status;
      this.statusForm.connectorId = this.chargerCard.connectorId;
      this.statusForm.errorCode = this.chargerCard.errorCode;
      this.statusForm.vendorErrorCode = this.chargerCard.vendorErrorCode;
      this.statusForm.info = this.chargerCard.info;
    },
    applyBackendVcp(vcp) {
      this.chargerCard.chargePointId = vcp.chargePointId;
      this.chargerCard.endpoint = vcp.endpoint;
      this.chargerCard.model = vcp.model;
      this.chargerCard.ocppVersion = vcp.ocppVersion;
      this.chargerCard.power = Number(vcp.power ?? this.chargerCard.power);
      this.chargerCard.connectors = Array.isArray(vcp.connectorIds)
        ? vcp.connectorIds.length
        : this.chargerCard.connectors;
      this.chargerCard.status = vcp.status;
      this.chargerCard.lastAction = vcp.lastAction || this.chargerCard.lastAction;
      this.chargerCard.online = true;
      this.chargerCard.vendor = this.resolveVendor(vcp.model || this.chargerCard.model);
      this.chargerCard.version = this.resolveFirmware(vcp.model || this.chargerCard.model);
      this.syncStatusFormFromCard();
    },
    findActiveVcp(statusResponse) {
      const responseData = statusResponse?.data || {};
      const verboseList = responseData.vpcList || responseData.vcpList || [];
      if (!Array.isArray(verboseList)) {
        return null;
      }

      return (
        verboseList.find(
          (vcp) => vcp.chargePointId === this.form.chargePointId,
        ) || null
      );
    },
    startPolling() {
      this.stopPolling();
      this.pollTimerId = window.setInterval(() => {
        this.refreshStatus({ silent: true, fromPolling: true });
      }, STATUS_POLL_INTERVAL_MS);
    },
    stopPolling() {
      if (this.pollTimerId) {
        window.clearInterval(this.pollTimerId);
        this.pollTimerId = null;
      }
    },
    handleLogout() {
      this.stopPolling();
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      window.location.href = "/login";
    },
    async startVcp() {
      if (this.isStarting || this.isAuthLoading) {
        return;
      }

      this.isStarting = true;
      this.statusMessage = {
        type: "",
        text: "",
      };

      const payload = {
        chargePointId: this.form.chargePointId,
        endpoint: this.form.endpoint,
        count: 1,
        connectors: Number(this.form.connectors),
        power: Number(this.form.power),
        ocppVersion: this.form.ocppVersion,
        model: this.form.model,
        testCharge: this.form.testCharge,
        sendBootStatus: this.form.sendBootStatus,
        duration: Number(this.form.duration),
        startChance: Number(this.form.startChance),
        randomDelay: this.form.randomDelay,
      };

      this.prependLog(
        "Start Request",
        `Sending start request for ${payload.chargePointId} to ${payload.endpoint}.`,
      );

      try {
        const response = await fetch("/api/vcp/start", {
          method: "POST",
          headers: this.getAuthHeaders(),
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          this.statusMessage = {
            type: "error",
            text: data.message || "Failed to start VCP.",
          };
          this.prependLog(
            "Start Failed",
            data.message || "The start request did not succeed.",
          );
          return;
        }

        this.chargerCard.online = true;
        this.chargerCard.status = "Available";
        this.chargerCard.lastAction = "Start Requested";
        this.syncStatusFormFromCard();
        this.statusMessage = {
          type: "success",
          text: data.message || "VCP start request sent.",
        };
        this.prependLog(
          "Start Success",
          data.message || "VCP start request sent successfully.",
        );
        this.startPolling();
        await this.refreshStatus({ silent: true });
      } catch (_error) {
        this.statusMessage = {
          type: "error",
          text: "Unable to reach the backend start endpoint.",
        };
        this.prependLog(
          "Start Failed",
          "Unable to reach the backend start endpoint.",
        );
      } finally {
        this.isStarting = false;
      }
    },
    async stopVcp() {
      if (this.isStopping || this.isAuthLoading) {
        return;
      }

      this.isStopping = true;
      this.statusMessage = {
        type: "",
        text: "",
      };

      const payload = {
        vcpId: this.form.chargePointId,
        isPrefix: false,
      };

      this.prependLog(
        "Stop Request",
        `Sending stop request for ${payload.vcpId}.`,
      );

      try {
        const response = await fetch("/api/vcp/stop", {
          method: "POST",
          headers: this.getAuthHeaders(),
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          this.statusMessage = {
            type: "error",
            text: data.message || "Failed to stop VCP.",
          };
          this.prependLog(
            "Stop Failed",
            data.message || "The stop request did not succeed.",
          );
          return;
        }

        this.chargerCard.status = "Offline";
        this.chargerCard.online = false;
        this.chargerCard.vehiclePluggedIn = false;
        this.chargerCard.lastAction = "Stop Requested";
        this.chargerCard.lastCloseReason = "Stopped from Vue UI";
        this.syncStatusFormFromCard();
        this.stopPolling();
        this.statusMessage = {
          type: "success",
          text: data.message || "VCP stop request sent.",
        };
        this.prependLog(
          "Stop Success",
          data.message || "VCP stop request sent successfully.",
        );
      } catch (_error) {
        this.statusMessage = {
          type: "error",
          text: "Unable to reach the backend stop endpoint.",
        };
        this.prependLog(
          "Stop Failed",
          "Unable to reach the backend stop endpoint.",
        );
      } finally {
        this.isStopping = false;
      }
    },
    buildStatusPayload(statusOverrides = {}) {
      const connectorId = Math.min(
        Math.max(
          Number(
            statusOverrides.connectorId ?? this.statusForm.connectorId,
          ) || 1,
          1,
        ),
        Number(this.chargerCard.connectors) || 1,
      );
      const status = statusOverrides.status ?? this.statusForm.status;
      const errorCode = statusOverrides.errorCode ?? this.statusForm.errorCode;
      const vendorErrorCode =
        statusOverrides.vendorErrorCode ?? this.statusForm.vendorErrorCode;
      const info = statusOverrides.info ?? this.statusForm.info;

      return {
        status,
        connectorId,
        requestBody: {
          chargePointId: this.form.chargePointId,
          action: "StatusNotification",
          payload: {
            connectorId,
            status,
            errorCode,
            ...(vendorErrorCode ? { vendorErrorCode } : {}),
            ...(info ? { info } : {}),
          },
        },
      };
    },
    async sendStatusNotification(statusOverrides = {}, options = {}) {
      if (this.isChangingStatus || this.isAuthLoading) {
        return false;
      }

      this.isChangingStatus = true;
      this.statusMessage = {
        type: "",
        text: "",
      };

      const { status, connectorId, requestBody } =
        this.buildStatusPayload(statusOverrides);
      const errorCode =
        statusOverrides.errorCode ?? this.statusForm.errorCode;
      const vendorErrorCode =
        statusOverrides.vendorErrorCode ?? this.statusForm.vendorErrorCode;
      const info = statusOverrides.info ?? this.statusForm.info;

      this.prependLog(
        options.requestLogTitle || "Status Request",
        options.requestLogMessage ||
          `Sending ${status} StatusNotification for ${requestBody.chargePointId} on connector ${connectorId}.`,
      );

      try {
        const response = await fetch("/api/vcp/change-status", {
          method: "POST",
          headers: this.getAuthHeaders(),
          body: JSON.stringify(requestBody),
        });

        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          this.statusMessage = {
            type: "error",
            text: data.message || "Failed to change charger status.",
          };
          this.prependLog(
            options.failureLogTitle || "Status Failed",
            data.message || "The status change request did not succeed.",
          );
          return false;
        }

        this.chargerCard.status = status;
        this.chargerCard.connectorId = connectorId;
        this.chargerCard.errorCode = errorCode;
        this.chargerCard.vendorErrorCode = vendorErrorCode;
        this.chargerCard.info = info;
        this.chargerCard.lastAction =
          options.lastAction || `StatusNotification: ${status}`;

        if (status === "Preparing" || status === "Charging" || status === "Finishing") {
          this.chargerCard.vehiclePluggedIn = true;
        }

        if (status === "Available" || status === "Offline" || status === "Unavailable") {
          this.chargerCard.vehiclePluggedIn = false;
        }

        this.syncStatusFormFromCard();
        this.statusMessage = {
          type: "success",
          text: data.message || "Status updated.",
        };
        this.prependLog(
          options.successLogTitle || "Status Success",
          data.message || `StatusNotification sent for ${status}.`,
        );
        await this.refreshStatus({ silent: true });
        return true;
      } catch (_error) {
        this.statusMessage = {
          type: "error",
          text: "Unable to reach the backend change-status endpoint.",
        };
        this.prependLog(
          options.failureLogTitle || "Status Failed",
          "Unable to reach the backend change-status endpoint.",
        );
        return false;
      } finally {
        this.isChangingStatus = false;
      }
    },
    async applyStatusOverride() {
      await this.sendStatusNotification();
    },
    async togglePlug() {
      const nextStatus = this.chargerCard.vehiclePluggedIn
        ? "Available"
        : "Preparing";
      const nextErrorCode = "NoError";

      const wasApplied = await this.sendStatusNotification(
        {
          status: nextStatus,
          connectorId: this.statusForm.connectorId,
          errorCode: nextErrorCode,
          vendorErrorCode: "",
          info: "",
        },
        {
          requestLogTitle: "Plug Request",
          requestLogMessage: this.chargerCard.vehiclePluggedIn
            ? `Sending Available StatusNotification for unplug on connector ${this.statusForm.connectorId}.`
            : `Sending Preparing StatusNotification for plug-in on connector ${this.statusForm.connectorId}.`,
          successLogTitle: "Plug Success",
          failureLogTitle: "Plug Failed",
          lastAction: this.chargerCard.vehiclePluggedIn
            ? "Vehicle Unplugged"
            : "Vehicle Plugged In",
        },
      );

      if (wasApplied) {
        this.statusForm.status = nextStatus;
      }
    },
    async refreshStatus(options = {}) {
      const { silent = false, fromPolling = false } = options;

      if (this.isRefreshing || this.isAuthLoading) {
        return false;
      }

      this.isRefreshing = true;
      if (!silent) {
        this.statusMessage = {
          type: "",
          text: "",
        };
      }

      if (!fromPolling) {
        this.prependLog(
          "Refresh Request",
          `Loading backend status for ${this.form.chargePointId}.`,
        );
      }

      try {
        const response = await fetch("/api/vcp/status?verbose=true", {
          method: "GET",
          headers: this.getAuthHeaders(),
        });

        const data = await response.json();
        if (!response.ok || data.status !== "success") {
          if (!silent) {
            this.statusMessage = {
              type: "error",
              text: data.message || "Failed to refresh backend status.",
            };
          }
          if (!fromPolling) {
            this.prependLog(
              "Refresh Failed",
              data.message || "The refresh request did not succeed.",
            );
          }
          return false;
        }

        const activeVcp = this.findActiveVcp(data);
        if (!activeVcp) {
          this.stopPolling();
          if (!silent) {
            this.statusMessage = {
              type: "error",
              text: `No active backend status found for ${this.form.chargePointId}.`,
            };
          }
          if (!fromPolling) {
            this.prependLog(
              "Refresh Empty",
              `No active backend status found for ${this.form.chargePointId}.`,
            );
          }
          return false;
        }

        this.applyBackendVcp(activeVcp);
        if (!silent) {
          this.statusMessage = {
            type: "success",
            text: `Status refreshed for ${this.form.chargePointId}.`,
          };
        }
        if (!fromPolling) {
          this.prependLog(
            "Refresh Success",
            `Loaded backend status ${activeVcp.status} for ${this.form.chargePointId}.`,
          );
        }
        return true;
      } catch (_error) {
        if (!silent) {
          this.statusMessage = {
            type: "error",
            text: "Unable to reach the backend status endpoint.",
          };
        }
        if (!fromPolling) {
          this.prependLog(
            "Refresh Failed",
            "Unable to reach the backend status endpoint.",
          );
        }
        return false;
      } finally {
        this.isRefreshing = false;
      }
    },
    prependLog(title, message) {
      this.logs.unshift({
        id: Date.now(),
        title,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        message,
      });
    },
    resolveVendor(model) {
      if (model.startsWith("EVA")) {
        return "ATESS";
      }
      if (model.startsWith("KC-")) {
        return "Keba";
      }
      if (model.startsWith("GL-")) {
        return "GL_EVIQ";
      }
      if (model.startsWith("AC022")) {
        return "EN+";
      }
      return "Vestel";
    },
    resolveFirmware(model) {
      if (model.startsWith("EVA")) {
        return "EVA-07S_SE-V4.2.9-20220610";
      }
      if (model.startsWith("AC022")) {
        return "1.4.918";
      }
      if (model.startsWith("EVC")) {
        return "v4.28.0-1.5.154.0-v8.0.8";
      }
      return "1.0.0";
    },
  },
}).mount("#app");
