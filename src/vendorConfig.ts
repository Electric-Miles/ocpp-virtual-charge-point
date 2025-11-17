export class VendorConfig {
  // Vendor names
  public static readonly VENDORS = {
    ATESS: "ATESS",
    VESTEL: "Vestel",
    KEBA: "Keba",
    GL_EVIQ: "GL_EVIQ",
    EN_PLUS: "EN+",
  } as const;

  // Model patterns for vendor identification
  public static readonly MODEL_PATTERNS = {
    EVA: "EVA",
    EVC: "EVC",
    KC_P: "KC-P",
    GL_EVIQ: "GL-EVIQ",
    EN_PLUS_22KW: "AC022K"
  } as const;

  // Specific models
  public static readonly MODELS = {
    EVC01: "EVC01",
    EVA_07S_SE: "EVA-07S-SE",
    EVC03: "EVC03",
    KC_P30: "KC-P30",
    GL_EVIQ07WRS: "GL-EVIQ07WRS",
    AC022K_BE_24: "AC022K-BE-24", // AC022K-BE-24 AC044K-BE-44D
  } as const;

  // Firmware versions
  public static readonly FIRMWARE_VERSIONS = {
    EVA_DEFAULT: "EVA-07S_SE-V4.2.9-20220610",
    EVC_DEFAULT: "v4.28.0-1.5.154.0-v8.0.8",
    DEFAULT: "1.0.0",
    EN_PLUS_22KW_DEFAULT: "1.4.918",
  } as const;

  /**
   * Get vendor name based on model pattern
   * @param model The model string to analyze
   * @returns The vendor name or 'Unknown-vendor' if not found
   */
  public static getVendorFromModel(model: string): string {
    if (model.includes(VendorConfig.MODEL_PATTERNS.EVA)) {
      return VendorConfig.VENDORS.ATESS;
    } else if (model.includes(VendorConfig.MODEL_PATTERNS.EVC)) {
      return VendorConfig.VENDORS.VESTEL;
    } else if (model.includes(VendorConfig.MODEL_PATTERNS.KC_P)) {
      return VendorConfig.VENDORS.KEBA;
    } else if (model.includes(VendorConfig.MODEL_PATTERNS.GL_EVIQ)) {
      return VendorConfig.VENDORS.GL_EVIQ;
    } else if (model.includes(VendorConfig.MODEL_PATTERNS.EN_PLUS_22KW)) {
      return VendorConfig.VENDORS.EN_PLUS;
    } else {
      return "Unknown-vendor";
    }
  }

  /**
   * Get firmware version based on model pattern
   * @param model The model string to analyze
   * @returns The firmware version string
   */
  public static getFirmwareFromModel(model: string): string {
    if (model.includes(VendorConfig.MODEL_PATTERNS.EVA)) {
      return VendorConfig.FIRMWARE_VERSIONS.EVA_DEFAULT;
    } else if (model.includes(VendorConfig.MODEL_PATTERNS.EVC)) {
      return VendorConfig.FIRMWARE_VERSIONS.EVC_DEFAULT;
    } else if (model.includes(VendorConfig.MODEL_PATTERNS.EN_PLUS_22KW)) {
      return VendorConfig.FIRMWARE_VERSIONS.EN_PLUS_22KW_DEFAULT;
    } else {
      return VendorConfig.FIRMWARE_VERSIONS.DEFAULT;
    }
  }

  /**
   * Initialize configuration for a specific vendor/model
   *
   * @param vendor The vendor of the charger
   * @param model The model of the charger
   * @returns Configuration object for the vendor/model
   */
  public static initializeConfiguration(
    vendor: string,
    model: string,
  ): Record<string, any> {
    const vendorConfig: Record<string, any> = {};

    // Get the appropriate configuration based on vendor/model
    if (vendor === VendorConfig.VENDORS.ATESS) {
      // Initialize with public ATESS configuration by default
      const atessPublicConfig = JSON.parse(
        VendorConfig.getAtessPublicConfiguration(),
      );

      // Also load hidden configuration for ATESS
      const atessPrivateConfig = JSON.parse(
        VendorConfig.getAtessPrivateConfiguration(),
      );

      atessPublicConfig.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });

      atessPrivateConfig.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });
    } else if (model === VendorConfig.MODELS.EVC03) {
      const evc03Config = JSON.parse(VendorConfig.getEVC03Configuration());

      evc03Config.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });
    } else if (vendor === VendorConfig.VENDORS.VESTEL) {
      const vestelConfig = JSON.parse(VendorConfig.getVestelConfiguration());

      vestelConfig.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });
    } else if (vendor === VendorConfig.VENDORS.KEBA) {
      const kebaConfig = JSON.parse(VendorConfig.getKebaConfiguration());

      kebaConfig.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });
    } else if (vendor === VendorConfig.VENDORS.GL_EVIQ) {
      const glEviqConfig = JSON.parse(VendorConfig.getGlEviqConfiguration());

      glEviqConfig.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });
    } else if (vendor === VendorConfig.VENDORS.EN_PLUS) {
      const enPlus22kWConfig = JSON.parse(VendorConfig.getEnPlus22kWConfiguration());

      enPlus22kWConfig.configurationKey.forEach((config: any) => {
        vendorConfig[config.key] = {
          value: config.value,
          readonly: config.readonly,
        };
      });
    }

    return vendorConfig;
  }

  /**
   * Get configuration for ATESS vendor with specific keys
   * @returns JSON string with private ATESS keys
   */
  public static getAtessPrivateConfiguration(): string {
    return '{"configurationKey":[{"key":"G_LowPowerReserveEnable","value":"Disable","readonly":false},{"key":"UnlockConnectorOnEVSideDisconnect","value":"true","readonly":false},{"key":"G_PeriodTime","value":"time1=11:00-16:00&amp;time2=16:01-10:59","readonly":false},{"key":"G_OffPeakEnable","value":"Disable","readonly":false},{"key":"G_OffPeakCurr","value":"","readonly":false},{"key":"G_ChargerNetMac","value":"50:88:C1:3A:23:13","readonly":false},{"key":"AuthorizationCacheEnabled","value":"false","readonly":false},{"key":"AuthorizeRemoteTxRequests","value":"false","readonly":true},{"key":"ConnectionTimeOut","value":"90","readonly":false},{"key":"LocalAuthListEnabled","value":"false","readonly":false},{"key":"LocalAuthorizeOffline","value":"false","readonly":false},{"key":"LocalPreAuthorize","value":"false","readonly":false},{"key":"StopTransactionOnInvalidId","value":"true","readonly":false}]}';
  }

  /**
   * Get configuration for ATESS vendor with no specific keys
   * @returns JSON string with public ATESS keys
   */
  public static getAtessPublicConfiguration(): string {
    return '{"configurationKey":[{"key":"G_ChargerID","value":"IOG0B21174","readonly":false},{"key":"G_ChargerRate","value":"1.00","readonly":false},{"key":"G_ChargerLanguage","value":"English","readonly":false},{"key":"G_MaxCurrent","value":"32.00","readonly":false},{"key":"G_ChargerMode","value":"1","readonly":false},{"key":"G_CardPin","value":"242007","readonly":false},{"key":"G_Authentication","value":"12354678","readonly":false},{"key":"G_ChargerNetIP","value":"192.168.1.5","readonly":false},{"key":"G_MaxTemperature","value":"85","readonly":false},{"key":"G_ExternalLimitPower","value":"45","readonly":false},{"key":"G_ExternalLimitPowerEnable","value":"0","readonly":false},{"key":"G_ExternalSamplingCurWring","value":"0","readonly":false},{"key":"G_SolarMode","value":"0","readonly":false},{"key":"G_SolarLimitPower","value":"1.76","readonly":false},{"key":"G_PeakValleyEnable","value":"1","readonly":false},{"key":"G_AutoChargeTime","value":"00:00-00:00","readonly":false},{"key":"G_RCDProtection","value":"6","readonly":false},{"key":"G_PowerMeterAddr","value":"1","readonly":false},{"key":"G_PowerMeterType","value":"Acrel DDS1352","readonly":false},{"key":"G_TimeZone","value":"UTC+00:00","readonly":false},{"key":"G_ServerURL","value":"ws://ocpp.electricmiles.io/","readonly":false},{"key":"G_RandDelayChargeTime","value":"600","readonly":false},{"key":"HeartbeatInterval","value":"300","readonly":false},{"key":"MeterValueSampleInterval","value":"60","readonly":false},{"key":"WebSocketPingInterval","value":"30","readonly":false},{"key":"ConnectionTimeOut","value":"90","readonly":false},{"key":"LocalAuthorizeOffline","value":"false","readonly":false},{"key":"AuthorizationCacheEnabled","value":"false","readonly":false},{"key":"LocalPreAuthorize","value":"false","readonly":false},{"key":"LocalAuthListEnabled","value":"false","readonly":false},{"key":"AuthorizeRemoteTxRequests","value":"false","readonly":false}]}';
  }

  /**
   * Get configuration for Vestel EVC03 DC model
   * @returns JSON string with Vestel EVC03 DC configuration
   */
  public static getEVC03Configuration(): string {
    return '{"configurationKey":[{"readonly":false,"key":"AllowOfflineTxForUnknownId"},{"readonly":false,"value":"false","key":"AuthorizationCacheEnabled"},{"readonly":false,"value":"false","key":"AuthorizeRemoteTxRequests"},{"readonly":false,"value":"0","key":"BlinkRepeat"},{"readonly":false,"value":"0","key":"ClockAlignedDataInterval"},{"readonly":false,"value":"60","key":"ConnectionTimeOut"},{"readonly":true,"value":"2147483647","key":"GetConfigurationMaxKeys"},{"readonly":false,"value":"300","key":"HeartbeatInterval"},{"readonly":false,"value":"0","key":"LightIntensity"},{"readonly":false,"value":"0","key":"LocalAuthorizeOffline"},{"readonly":false,"value":"false","key":"LocalPreAuthorize"},{"readonly":false,"value":"0","key":"MaxEnergyOnInvalidId"},{"readonly":false,"value":"","key":"MeterValuesAlignedData"},{"readonly":true,"value":"2147483647","key":"MeterValuesAlignedDataMaxLength"},{"readonly":false,"value":"","key":"MeterValuesSampledData"},{"readonly":true,"value":"2147483647","key":"MeterValuesSampledDataMaxLength"},{"readonly":false,"value":"0","key":"MeterValueSampleInterval"},{"readonly":false,"value":"0","key":"MinimumStatusDuration"},{"readonly":true,"value":"2","key":"NumberOfConnectors"},{"readonly":false,"value":"3","key":"ResetRetries"},{"readonly":false,"value":"","key":"ConnectorPhaseRotation"},{"readonly":true,"value":"2147483647","key":"ConnectorPhaseRotationMaxLength"},{"readonly":false,"value":"true","key":"StopTransactionOnEVSideDisconnect"},{"readonly":false,"value":"","key":"StopTransactionOnInvalidId"},{"readonly":false,"value":"","key":"StopTxnAlignedData"},{"readonly":true,"value":"2147483647","key":"StopTxnAlignedDataMaxLength"},{"readonly":false,"value":"","key":"StopTxnSampledData"},{"readonly":true,"value":"2147483647","key":"StopTxnSampledDataMaxLength"},{"readonly":true,"value":"Core,LocalAuthListManagement,FirmwareManagement,Reservation,RemoteTrigger","key":"SupportedFeatureProfiles"},{"readonly":true,"value":"6","key":"SupportedFeatureProfilesMaxLength"},{"readonly":false,"value":"3","key":"TransactionMessageAttempts"},{"readonly":false,"value":"20","key":"TransactionMessageRetryInterval"},{"readonly":false,"value":"true","key":"UnlockConnectorOnEVSideDisconnect"},{"readonly":false,"value":"60","key":"WebSocketPingInterval"},{"readonly":false,"value":"true","key":"LocalAuthListEnabled"},{"readonly":true,"value":"2147483647","key":"LocalAuthListMaxLength"},{"readonly":true,"value":"2147483647","key":"SendLocalListMaxLength"},{"readonly":true,"value":"false","key":"ReserveConnectorZeroSupported"},{"readonly":true,"value":"2147483647","key":"ChargeProfileMaxStackLevel"},{"readonly":true,"value":"Current,Power","key":"ChargingScheduleAllowedChargingRateUnit"},{"readonly":true,"value":"2147483647","key":"ChargingScheduleMaxPeriods"},{"readonly":true,"value":"false","key":"ConnectorSwitch3to1PhaseSupported"},{"readonly":true,"value":"2147483647","key":"MaxChargingProfilesInstalled"},{"readonly":true,"value":"false","key":"AdditionalRootCertificateCheck"},{"readonly":true,"value":"2147483647","key":"CertificateSignedMaxChainSize"},{"readonly":true,"value":"2147483647","key":"CertificateStoreMaxLength"},{"readonly":false,"value":"Vestel","key":"CpoName"},{"readonly":false,"value":"0","key":"SecurityProfile"}]}';
  }

  /**
   * Get configuration for standard Vestel model
   * @returns JSON string with Vestel configuration
   */
  public static getVestelConfiguration(): string {
    return '{ "configurationKey": [ { "key": "AllowOfflineTxForUnknownId", "readonly": false, "value": "FALSE" }, { "key": "AuthorizationCacheEnabled", "readonly": false, "value": "TRUE" }, { "key": "AuthorizeRemoteTxRequests", "readonly": false, "value": "TRUE" }, { "key": "AuthorizationKey", "readonly": false, "value": "" }, { "key": "BlinkRepeat", "readonly": false, "value": "0" }, { "key": "BootNotificationAfterConnectionLoss", "readonly": false, "value": "TRUE" }, { "key": "ChargeProfileMaxStackLevel", "readonly": true, "value": "100" }, { "key": "ChargingScheduleAllowedChargingRateUnit", "readonly": true, "value": "Current" }, { "key": "ChargingScheduleMaxPeriods", "readonly": true, "value": "100" }, { "key": "ClockAlignedDataInterval", "readonly": false, "value": "0" }, { "key": "MaxPowerChargeComplete", "readonly": false, "value": "0" }, { "key": "MaxTimeChargeComplete", "readonly": false, "value": "0" }, { "key": "ConnectionTimeOut", "readonly": false, "value": "30" }, { "key": "ConnectorPhaseRotation", "readonly": false, "value": "0" }, { "key": "ConnectorPhaseRotationMaxLength", "readonly": false, "value": "0" }, { "key": "ConnectionURL", "readonly": false, "value": "wss://ocpp.test.electricmiles.io/7001270324000303" }, { "key": "DisplayLanguage", "readonly": false, "value": "en" }, { "key": "SupportedDisplayLanguages", "readonly": true, "value": "en/tr/fr/de/it/ro/es/fi/cz/da/he/hu/nl/no/pl/sk/sv/" }, { "key": "ConnectorSwitch3to1PhaseSupported", "readonly": true, "value": "FALSE" }, { "key": "GetConfigurationMaxKeys", "readonly": true, "value": "60" }, { "key": "HeartbeatInterval", "readonly": false, "value": "300" }, { "key": "LightIntensity", "readonly": false, "value": "3" }, { "key": "LocalAuthListEnabled", "readonly": false, "value": "TRUE" }, { "key": "LocalAuthListMaxLength", "readonly": true, "value": "10000" }, { "key": "LocalAuthorizeOffline", "readonly": false, "value": "TRUE" }, { "key": "LocalPreAuthorize", "readonly": false, "value": "TRUE" }, { "key": "MaxChargingProfilesInstalled", "readonly": true, "value": "5" }, { "key": "MaxEnergyOnInvalidId", "readonly": false, "value": "0" }, { "key": "MeterValuesAlignedData", "readonly": false, "value": "Energy.Active.Import.Register" }, { "key": "MeterValuesAlignedDataMaxLength", "readonly": false, "value": "100" }, { "key": "MeterValuesSampledData", "readonly": false, "value": "Current.Import,Energy.Active.Import.Register,Voltage" }, { "key": "MeterValuesSampledDataMaxLength", "readonly": true, "value": "4" }, { "key": "MeterValueSampleInterval", "readonly": false, "value": "60" }, { "key": "MinimumStatusDuration", "readonly": false, "value": "0" }, { "key": "NumberOfConnectors", "readonly": true, "value": "1" }, { "key": "ReserveConnectorZeroSupported", "readonly": true, "value": "TRUE" }, { "key": "ResetRetries", "readonly": false, "value": "3" }, { "key": "SendLocalListMaxLength", "readonly": true, "value": "10000" }, { "key": "StopTransactionOnEVSideDisconnect", "readonly": false, "value": "TRUE" }, { "key": "StopTransactionOnInvalidId", "readonly": false, "value": "FALSE" }, { "key": "StopTxnAlignedData", "readonly": false, "value": "Energy.Active.Import.Register" }, { "key": "StopTxnAlignedDataMaxLength", "readonly": true, "value": "0" }, { "key": "StopTxnSampledData", "readonly": false, "value": "Energy.Active.Import.Register" }, { "key": "StopTxnSampledDataMaxLength", "readonly": true, "value": "0" }, { "key": "SupportedFeatureProfiles", "readonly": true, "value": "Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger" }, { "key": "SupportedFeatureProfilesMaxLength", "readonly": true, "value": "120" }, { "key": "TransactionMessageAttempts", "readonly": false, "value": "3" }, { "key": "TransactionMessageRetryInterval", "readonly": false, "value": "20" }, { "key": "UnlockConnectorOnEVSideDisconnect", "readonly": false, "value": "TRUE" }, { "key": "WebSocketPingInterval", "readonly": false, "value": "10" }, { "key": "FreeModeActive", "readonly": false, "value": "FALSE" }, { "key": "FreeModeRFID", "readonly": false, "value": "VestelFreeMode" }, { "key": "ContinueChargingAfterPowerLoss", "readonly": false, "value": "True" }, { "key": "SendTotalPowerValue", "readonly": false, "value": "FALSE" }, { "key": "LockableCable", "readonly": false, "value": "False" }, { "key": "UnbalancedLoadDetection", "readonly": false, "value": "False" }, { "key": "DisplayBacklightLevel", "readonly": false, "value": "mid" }, { "key": "DisplayBacklightLevelOptions", "readonly": true, "value": "veryLow,low,mid,high,timeBased,userInteraction" }, { "key": "DisplayBacklightSunrise", "readonly": false, "value": "07:00" }, { "key": "DisplayBacklightSunset", "readonly": false, "value": "19:00" }, { "key": "LedDimmingLevel", "readonly": false, "value": "mid" }, { "key": "LedDimmingLevelOptions", "readonly": true, "value": "veryLow,low,mid,high,timeBased" }, { "key": "LedDimmingSunrise", "readonly": false, "value": "07:00" }, { "key": "LedDimmingSunset", "readonly": false, "value": "19:00" }, { "key": "StandbyLed", "readonly": false, "value": "False" }, { "key": "RfidEndianness", "readonly": false, "value": "big-endian" }, { "key": "Location", "readonly": false, "value": "indoor" }, { "key": "PowerOptimizer", "readonly": false, "value": "0" }, { "key": "LoadSheddingMinimumCurrent", "readonly": false, "value": "8" }, { "key": "UnbalancedLoadDetectionMaxCurrent", "readonly": false, "value": "20" }, { "key": "CurrentLimiterValue", "readonly": false, "value": "32" }, { "key": "CurrentLimiterPhase", "readonly": false, "value": "onePhase" }, { "key": "DailyReboot", "readonly": false, "value": "TRUE" }, { "key": "publicKey", "readonly": true, "value": "" }, { "key": "RandomisedDelayMaxSeconds", "readonly": false, "value": "600" }, { "key": "OffPeakCharging", "readonly": false, "value": "False" }, { "key": "OffPeakChargingWeekend", "readonly": false, "value": "False" }, { "key": "OffPeakChargingTimeSlots", "readonly": false, "value": "11:00-16:00,16:00-11:00" }, { "key": "ContinueAfterOffPeakHour", "readonly": false, "value": "False" }, { "key": "ForcedCharging", "readonly": false, "value": "" }, { "key": "CurrentSessionRandomDelay", "readonly": true, "value": "0" }, { "key": "timeZone", "readonly": false, "value": "UTC" }, { "key": "apnInfo", "readonly": false, "value": ",," }, { "key": "UKSmartChargingEnabled", "readonly": false, "value": "FALSE" }, { "key": "installationErrorEnable", "readonly": false, "value": "TRUE" }, { "key": "randomisedDelayAtOffPeakEnd", "readonly": false, "value": "False" }, { "key": "RandomizedDelayMax", "readonly": false, "value": "600" }, { "key": "SendDataTransferMeterConfigurationForNonEichrecht", "readonly": false, "value": "FALSE" }, { "key": "NewTransactionAfterPowerLoss", "readonly": false, "value": "FALSE" }, { "key": "DailyRebootTime", "readonly": false, "value": "03:00" }, { "key": "DailyRebootType", "readonly": false, "value": "SOFT" }, { "key": "LEDTimeoutEnable", "readonly": false, "value": "" }, { "key": "Operator", "readonly": true, "value": "" }, { "key": "ConnectionType", "readonly": true, "value": "" }, { "key": "SignalStrength", "readonly": true, "value": "" }, { "key": "Rsrp", "readonly": true, "value": "" }, { "key": "Rsrq", "readonly": true, "value": "" }, { "key": "Sinr", "readonly": true, "value": "" }, { "key": "FirewallSettings", "readonly": false, "value": "" }, { "key": "WifiStrength", "readonly": true, "value": "-46dBm" }, { "key": "WifiLevel", "readonly": true, "value": "4" }, { "key": "WifiFreq", "readonly": true, "value": "5G" }, { "key": "FollowTheSunEnabled", "readonly": false, "value": "Disable" }, { "key": "FollowTheSunMode", "readonly": false, "value": "SunOnly" }, { "key": "FollowTheSunAutoPhaseSwitching", "readonly": false, "value": "Enable" } ] }';
  }

  /**
   * Get configuration for standard Keba model
   * @returns JSON string with Keba configuration
   */
  public static getKebaConfiguration(): string {
    return '{"configurationKey":[{"key":"PVEnable","readonly":false,"value":"false"},{"key":"PVMinShare","readonly":false,"value":"0"},{"key":"PVPreChargeTime","readonly":false,"value":"0"},{"key":"PVIgnoreX1","readonly":false,"value":"false"},{"key":"PVThresholdImport","readonly":false,"value":"400000"},{"key":"PVThresholdExport","readonly":false,"value":"400000"},{"key":"PVDelay","readonly":false,"value":"300"},{"key":"MaxAvailableCurrent","readonly":false,"value":"100000"},{"key":"MaxDurationChargingPause","readonly":false,"value":"900"},{"key":"NominalVoltage","readonly":false,"value":"230"},{"key":"MaximumAsymmetricLoadCurrent","readonly":false,"value":"0"},{"key":"AsymmNetworkEnabled","readonly":false,"value":"false"},{"key":"AsymmNetworkCheckerTaskInitialDelay","readonly":false,"value":"15"},{"key":"AsymmNetworkCheckerTaskRetryInterval","readonly":false,"value":"10"},{"key":"PowerControlThreshold","readonly":false,"value":"1000"},{"key":"TimeSynchronizationTolerance","readonly":false,"value":"30"},{"key":"PwmMinCurrentDefault","readonly":false,"value":"6000"},{"key":"ChargeProfileMaxStackLevel","readonly":true,"value":"32"},{"key":"ChargingScheduleAllowedChargingRateUnit","readonly":true,"value":"Current"},{"key":"ChargingScheduleMaxPeriods","readonly":true,"value":"32"},{"key":"MaxChargingProfilesInstalled","readonly":true,"value":"64"},{"key":"DelayAfterInitialCalculation","readonly":true,"value":"30"},{"key":"ConnectionTimeOut","readonly":false,"value":"60"},{"key":"UpdateFirmwareChecksumCheckActivated","readonly":false,"value":"false"},{"key":"ClockAlignedDataInterval","readonly":false,"value":"900"},{"key":"HostConnectorExternalMeterInterval","readonly":false,"value":"180"},{"key":"HostConnectorClockAlignedDelayPerc","readonly":false,"value":"0"},{"key":"MeasurementUpdateEvtInterval","readonly":false,"value":"30"},{"key":"MeterValueSampleInterval","readonly":false,"value":"60"},{"key":"HostConnectorMeterValueSendInterval","readonly":false,"value":"60"},{"key":"MeterValuesExternalData","readonly":false,"value":"Energy.Active.Import.Register, Energy.Active.Export.Register"},{"key":"HostConnectorSendStateChangeMeterValues","readonly":false,"value":"false"},{"key":"MeasurementUpdateEvtCurrentThreshold","readonly":false,"value":"1000"},{"key":"AuthorizationEnabled","readonly":false,"value":"false"},{"key":"AuthorizationModeOnline","readonly":false,"value":"FirstLocal"},{"key":"AuthorizationModeOffline","readonly":false,"value":"OfflineLocalAuthorization"},{"key":"LocalPreAuthorize","readonly":false,"value":"true"},{"key":"LocalAuthorizeOffline","readonly":false,"value":"true"},{"key":"AllowOfflineTxForUnknownId","readonly":false,"value":"false"},{"key":"LocalAuthListEnabled","readonly":true,"value":"true"},{"key":"LocalAuthListMaxLength","readonly":true,"value":"1024"},{"key":"SendLocalListMaxLength","readonly":true,"value":"1024"},{"key":"ResumeSessionAfterPowerCut","readonly":false,"value":"true"},{"key":"Price","readonly":false,"value":"0.0"},{"key":"PreauthorizedAmount","readonly":false,"value":"0.0"},{"key":"DirectPaymentLegalText","readonly":false,"value":""},{"key":"DirectPaymentAllowedFilenames","readonly":true,"value":"qrcode.png,qrcode.gif,standby.mp4,standby.jpg,standby.gif,standby.png,startscreen.png,startscreen.gif,startscreen.jpg,startscreen.mp4,whitelabel.zip"},{"key":"DirectPaymentMaxFileSize","readonly":true,"value":"10"},{"key":"DirectPaymentTariffModel","readonly":false,"value":"PerEnergyConsumed"},{"key":"DirectPaymentStartFee","readonly":false,"value":"0.0"},{"key":"ChargepointLocation","readonly":false,"value":""},{"key":"PaymentTerminalPwd","readonly":false,"value":"****"},{"key":"DirectPaymentContactPhone","readonly":false,"value":"08001234456"},{"key":"DirectPaymentContactEmail","readonly":false,"value":"support@keba.com"},{"key":"DirectPaymentNameOnReceipt","readonly":false,"value":"KEBA AG"},{"key":"DirectPaymentBlockingFee","readonly":false,"value":"0.0"},{"key":"DirectPaymentBlockingFeeTime","readonly":false,"value":"0.0"},{"key":"DirectPaymentBlockingFeeTimeUnit","readonly":false,"value":"min"},{"key":"DirectPaymentBlockingFeeRunningTime","readonly":false,"value":"0.0"},{"key":"DirectPaymentBlockingFeeRunningTimeTimeUnit","readonly":false,"value":"min"},{"key":"ExternalMeterSendInterval","readonly":false,"value":"5"},{"key":"MaxDaysOfLogs","readonly":false,"value":"90"},{"key":"LogLevelDebug","readonly":false,"value":"false"},{"key":"LogLevelDebugTime","readonly":false,"value":"3"},{"key":"ConnectorPhaseRotation","readonly":false,"value":"1.Rxx"},{"key":"PermanentlyLocked","readonly":false,"value":"1.false"},{"key":"ExternalMeterHomegridProviders","readonly":false,"value":"ABB | M4M,TQ-Systems | EM420 compatible,Siemens | 7KT1260,KOSTAL | KSEM,KeContact E10,Carlo Gavazzi | EM 24,Fronius Smart Meter TS 65A via Symo GEN24,Gossen Metrawatt | EMX228X/EM238X,Herholdt | ECSEM113,Janitza | ECSEM114MID,ABB | B23312-100,Janitza | B23312-10J,Leviton | S3500,Siemens | 7KM2200"},{"key":"HostConnectorType","readonly":true,"value":"OCPP_16_JSON"},{"key":"HeartBeatInterval","readonly":false,"value":"600"},{"key":"HeartbeatNoOfRetries","readonly":false,"value":"15"},{"key":"HostConnectorRetryInterval","readonly":false,"value":"60"},{"key":"TransactionMessageAttempts","readonly":false,"value":"720"},{"key":"TransactionMessageRetryInterval","readonly":false,"value":"60"},{"key":"HostConnectorDurationMessageStorage","readonly":false,"value":"43200"},{"key":"HostConnectorSendMeterValuesImmediately","readonly":false,"value":"true"},{"key":"HostConnectorSendClockAlignedExternalMeter","readonly":false,"value":"false"},{"key":"TimeDateSyncMethod","readonly":false,"value":"Automatic"},{"key":"HostConnectorTimezone","readonly":false,"value":"Etc/UTC"},{"key":"TimeZone","readonly":false,"value":"Europe/Vienna"},{"key":"HostConnectorUseCentralTime","readonly":false,"value":"true"},{"key":"HostConnectorReconnectInterval","readonly":false,"value":"30"},{"key":"SetSecureIncomingConnection","readonly":false,"value":"false"},{"key":"SetSecureOutgoingConnection","readonly":false,"value":"false"},{"key":"DisableCertificateValidation","readonly":false,"value":"false"},{"key":"DisableHostnameVerification","readonly":false,"value":"false"},{"key":"TruststorePath","readonly":true,"value":""},{"key":"TruststorePassword","readonly":true,"value":"cs/cHLtx/03xpQblnJcZgQ=="},{"key":"ChargeBoxIdentity","readonly":false,"value":"27017327"},{"key":"CentralSystemAddress","readonly":false,"value":"ocpp.test.electricmiles.io"},{"key":"CentralSystemPort","readonly":false,"value":"80"},{"key":"CentralSystemPath","readonly":false,"value":""},{"key":"HostConnectorCentralSystemAuthorizationMethod","readonly":false,"value":"None"},{"key":"HostConnectorCentralSystemUserId","readonly":false,"value":""},{"key":"HostConnectorCentralSystemPassword","readonly":false,"value":""},{"key":"HostConnectorCentralSystemConnectTimeout","readonly":false,"value":"60"},{"key":"HostConnectorCentralSystemReadTimeout","readonly":false,"value":"60"},{"key":"ChargepointAddress","readonly":false,"value":"localhost"},{"key":"ChargepointPort","readonly":false,"value":"12801"},{"key":"HostConnectorChargepointPreferredInterface","readonly":false,"value":"eth0"},{"key":"HostConnectorChargepointServiceAuthorizationMethod","readonly":false,"value":"None"},{"key":"HostConnectorChargepointServiceUserId","readonly":false,"value":""},{"key":"HostConnectorChargepointServicePassword","readonly":false,"value":""},{"key":"OcppChargepointServiceInitRetryPeriodInSeconds","readonly":false,"value":"30"},{"key":"StopTransactionOnInvalidId","readonly":false,"value":"true"},{"key":"DefaultTokenID","readonly":false,"value":"predefinedTokenId"},{"key":"WebSocketPingInterval","readonly":false,"value":"0"},{"key":"AuthorizationKey","readonly":false,"value":"DummyAuthorizationKey"},{"key":"AmountConnectors","readonly":false,"value":"1"},{"key":"NumberOfConnectors","readonly":false,"value":"1"},{"key":"ExternalMeterHomegridConfigured","readonly":false,"value":"false"},{"key":"ExternalMeterHomegridIpAddress","readonly":false,"value":""},{"key":"ExternalMeterHomegridPort","readonly":false,"value":""},{"key":"ExternalMeterHomegridProvider","readonly":false,"value":""},{"key":"ExternalMeterHomegridUnit","readonly":false,"value":""},{"key":"ExternalMeterHomegridImax1","readonly":false,"value":""},{"key":"ExternalMeterHomegridImax2","readonly":false,"value":""},{"key":"ExternalMeterHomegridImax3","readonly":false,"value":""},{"key":"ExternalMeterHomegridPmax","readonly":false,"value":""},{"key":"ExternalMeterHomegridComLost","readonly":false,"value":""},{"key":"ExternalMeterHomegridDurationForIncrease","readonly":false,"value":"300"},{"key":"ExternalMeterHomegridDurationForDecrease","readonly":false,"value":"10"},{"key":"ExternalMeterHomegridLMGMTEnabled","readonly":false,"value":"true"},{"key":"ChargePointModel","readonly":true,"value":"KC-P30-GS2400U2-M0A"},{"key":"ChargePointSerialNumber","readonly":true,"value":"27017327"},{"key":"FirmwareVersion","readonly":true,"value":"1.18.0"},{"key":"RemoteServiceInterface","readonly":false,"value":"true"},{"key":"GsmSimPin","readonly":false,"value":""},{"key":"GsmApn","readonly":false,"value":"a1.net"},{"key":"GsmApnUsername","readonly":false,"value":"ppp@A1plus.at"},{"key":"GsmApnPassword","readonly":false,"value":"ppp"},{"key":"GsmClientEnabled","readonly":false,"value":"false"},{"key":"AuthorizeRemoteTxRequests","readonly":true,"value":"false"},{"key":"GetConfigurationMaxKeys","readonly":true,"value":"200"},{"key":"SupportedFeatureProfiles","readonly":true,"value":"Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger"},{"key":"StopTxnAlignedData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"StopTxnSampledData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"MeterValuesAlignedData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"MeterValuesSampledData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"UnlockConnectorOnEVSideDisconnect","readonly":true,"value":"true"},{"key":"StopTransactionOnEVSideDisconnect","readonly":true,"value":"true"},{"key":"ResetRetries","readonly":true,"value":"0"},{"key":"ConnectorSwitch3to1PhaseSupported","readonly":false,"value":"false"},{"key":"ConnectorSwitchPhaseSource","readonly":false,"value":"NONE"},{"key":"ReserveConnectorZeroSupported","readonly":true,"value":"false"},{"key":"KeystorePassword","readonly":true,"value":"hsaaNnRAnGgdZBAki/b5pQ=="},{"key":"CertificateStoreMaxLength","readonly":true,"value":"10000"},{"key":"AdditionalRootCertificateCheck","readonly":false,"value":"false"},{"key":"SupportedFileTransferProtocols","readonly":true,"value":"FTP,HTTP,HTTPS"},{"key":"GetCertificateHashAlgorithm","readonly":false,"value":"SHA256"},{"key":"DaysUntilChargepointCertificateExpiration","readonly":false,"value":"30"},{"key":"CpoName","readonly":false,"value":"Keba"},{"key":"SecurityProfile","readonly":false,"value":"0"},{"key":"SecurityProfileFallback","readonly":false,"value":"0"},{"key":"SecurityProfileFallbackPeriod","readonly":false,"value":"180"},{"key":"MemoryCheckerThresholdPct","readonly":true,"value":"90"},{"key":"BatchedEventPauseResetAfter","readonly":true,"value":"30"},{"key":"PortalHost","readonly":false,"value":""},{"key":"PortalPort","readonly":false,"value":""},{"key":"PortalPath","readonly":false,"value":""},{"key":"PortalChargeBoxIdentity","readonly":false,"value":"27017327"},{"key":"enc.PortalBasicAuthenticationPassword","readonly":false,"value":"7EOpRa5669/xpQblnJcZgQ=="},{"key":"PortalWebSocketPingInterval","readonly":false,"value":"240"},{"key":"enc.PortalEnrollmentToken","readonly":false,"value":""},{"key":"PortalUpdateEndpoint","readonly":false,"value":"https://emobility-portal-backend.keba.com/update/api/v1"},{"key":"PortalUpdateCheckFrequencyDays","readonly":false,"value":"1"},{"key":"DisplayTextLanguage","readonly":false,"value":"en"},{"key":"DisplayTextCard","readonly":false,"value":"\'en\',\'$      Swipe card\',0,5,5"},{"key":"DisplayTextPlug","readonly":false,"value":"\'en\',\'Insert plug\',0,5,5"},{"key":"DisplayTextCheckingCard","readonly":false,"value":"\'en\',\'...\',0,0,0"},{"key":"DisplayTextCardExpired","readonly":false,"value":"\'en\',\'EXPIRED card\',1,3,0"},{"key":"DisplayTextCardBlocked","readonly":false,"value":"\'en\',\'BLOCKED card\',1,3,0"},{"key":"DisplayTextCardInvalid","readonly":false,"value":"\'en\',\'INVALID card\',1,3,0"},{"key":"DisplayTextCardOk","readonly":false,"value":"\'en\',\'ACCEPTED card\',1,3,0"},{"key":"DisplayTextCharging","readonly":false,"value":"\'en\',\'Charging...\',1,10,0"},{"key":"DisplayTextPVBoostCharging","readonly":false,"value":"\'en\',\'Boost charge\',1,10,0"},{"key":"DisplayTextPVCharging","readonly":false,"value":"\'en\',\'PV charging\',1,10,0"},{"key":"DisplayTextChargingSuspended","readonly":false,"value":"\'en\',\'Charging suspended\',1,10,0"},{"key":"DisplayTextChargingStopped","readonly":false,"value":"\'en\',\'Charging stopped\',5,10,0"},{"key":"DisplayTextReservedId","readonly":false,"value":"\'en\',\'Reserved ID {0}\',0,5,5"},{"key":"DisplayTextWrongReservation","readonly":false,"value":"\'en\',\'Wrong reservation\',1,3,0"},{"key":"RandomProfileDelayEnabled","readonly":false,"value":"true"},{"key":"RandomProfileMaxDelay","readonly":false,"value":"600"},{"key":"FtpUseMlstCommand","readonly":false,"value":"true"},{"key":"FtpsUseEndpointChecking","readonly":false,"value":"true"},{"key":"SftpUseStrictHostChecking","readonly":false,"value":"false"},{"key":"RestApiEnabled","readonly":false,"value":"true"},{"key":"PortalConfigNotificationEnabled","readonly":false,"value":"false"},{"key":"PortalConfigNotificationFrequency","readonly":false,"value":"30"},{"key":"HostConnectorProxyServerAddress","readonly":false,"value":""},{"key":"HostConnectorProxyServerPort","readonly":false,"value":""},{"key":"HostConnectorProxyUsername","readonly":false,"value":""},{"key":"HostConnectorProxyPassword","readonly":false,"value":""},{"key":"HostConnectorProxyServerConfigEnabled","readonly":false,"value":"false"},{"key":"Connect2ConnectorSerial1","readonly":false,"value":"27017327"},{"key":"FailsafeCurrentSerial1","readonly":false,"value":"32000"},{"key":"ModelSerial1","readonly":true,"value":"KC-P30-GS2400U2-M0A"},{"key":"MaxCurrentSerial1","readonly":true,"value":"10000"},{"key":"AliasSerial1","readonly":false,"value":""}],"unknownKey":[]}';
  }

  /**
   * Get configuration for standard GL_EVIQ model
   * @returns JSON string with GL_EVIQ configuration
   */
  public static getGlEviqConfiguration(): string {
    return '{"configurationKey":[{"key":"AllowOfflineTxForUnknownId","readonly":false,"value":"false"},{"key":"AuthorizationCacheEnabled","readonly":false,"value":"false"},{"key":"AuthorizeRemoteTxRequests","readonly":false,"value":"false"},{"key":"ClockAlignedDataInterval","readonly":false,"value":"0"},{"key":"ConnectionTimeOut","readonly":false,"value":"0"},{"key":"ConnectorPhaseRotation","readonly":false,"value":"Unknown"},{"key":"ConnectorPhaseRotationMaxLength","readonly":true,"value":"3"},{"key":"GetConfigurationMaxKeys","readonly":true,"value":"50"},{"key":"HeartbeatInterval","readonly":false,"value":"300"},{"key":"LightIntensity","readonly":false,"value":"100"},{"key":"LocalAuthorizeOffline","readonly":false,"value":"false"},{"key":"LocalPreAuthorize","readonly":false,"value":"false"},{"key":"MaxEnergyOnInvalidId","readonly":false,"value":"7"},{"key":"MeterValuesAlignedData","readonly":false,"value":"Current.Export, Current.Import, Current.Offered, Energy.Active.Export.Register, Energy.Active.Import.Register, Frequency, Power.Active.Export, Power.Active.Import, Power.Factor, Power.Offered, RPM, SoC, Temperature, Voltage"},{"key":"MeterValuesAlignedDataMaxLength","readonly":true,"value":"20"},{"key":"MeterValuesSampledData","readonly":false,"value":"Current.Export, Current.Import, Current.Offered, Energy.Active.Export.Register, Energy.Active.Import.Register, Frequency, Power.Active.Export, Power.Active.Import, Power.Factor, Power.Offered, RPM, SoC, Temperature, Voltage"},{"key":"MeterValuesSampledDataMaxLength","readonly":true,"value":"22"},{"key":"MeterValueSampleInterval","readonly":false,"value":"60"},{"key":"MinimumStatusDuration","readonly":false,"value":"0"},{"key":"NumberOfConnectors","readonly":true,"value":"1"},{"key":"ResetRetries","readonly":false,"value":"0"},{"key":"StopTransactionOnEVSideDisconnect","readonly":true,"value":"true"},{"key":"StopTransactionOnInvalidId","readonly":false,"value":"true"},{"key":"StopTxnAlignedData","readonly":false,"value":""},{"key":"StopTxnAlignedDataMaxLength","readonly":true,"value":"20"},{"key":"StopTxnSampledData","readonly":false,"value":""},{"key":"StopTxnSampledDataMaxLength","readonly":true,"value":"20"},{"key":"SupportedFeatureProfiles","readonly":true,"value":"Core, FirmwareManagement, LocalAuthListManagement, Reservation, SmartCharging, RemoteTrigger"},{"key":"SupportedFeatureProfilesMaxLength","readonly":true,"value":"6"},{"key":"TransactionMessageAttempts","readonly":false,"value":"0"},{"key":"TransactionMessageRetryInterval","readonly":false,"value":"15"},{"key":"UnlockConnectorOnEVSideDisconnect","readonly":false,"value":"true"},{"key":"WebSocketPingInterval","readonly":false,"value":"900"},{"key":"SupportedFileTransferProtocols","readonly":true,"value":"HTTP, HTTPS"},{"key":"LocalAuthListEnabled","readonly":false,"value":"false"},{"key":"LocalAuthListMaxLength","readonly":true,"value":"100"},{"key":"SendLocalListMaxLength","readonly":true,"value":"10"},{"key":"ReserveConnectorZeroSupported","readonly":true,"value":"true"},{"key":"ChargeProfileMaxStackLevel","readonly":true,"value":"0"},{"key":"ChargingScheduleAllowedChargingRateUnit","readonly":true,"value":"Power"},{"key":"ChargingScheduleMaxPeriods","readonly":true,"value":"12"},{"key":"ConnectorSwitch3to1PhaseSupported","readonly":false,"value":"false"},{"key":"MaxChargingProfilesInstalled","readonly":true,"value":"1"},{"key":"ConnexionUrl","readonly":false,"value":"ws://ocpp.electricmiles.io/"},{"key":"ChargePointIdentifier","readonly":false,"value":"GLF6501A24K00089"},{"key":"MaxPermissibleVoltage","readonly":false,"value":"275"},{"key":"MinPermissibleVoltage","readonly":false,"value":"175"},{"key":"MaxPermissibleLoadCurrents","readonly":false,"value":"-1"},{"key":"MaxPermissibleOutCurrents","readonly":false,"value":"-1"},{"key":"MaxPermissibleTemperature","readonly":false,"value":"-1"},{"key":"SolarModel","readonly":true,"value":"Model1"},{"key":"LimitingSolarChargeCurrent","readonly":true,"value":"-1"},{"key":"ChargingScheduleAllowedChargingCurrent","readonly":false,"value":"64"},{"key":"G_RandDelayChargeTime","readonly":false,"value":"60"},{"key":"FreeChargeMode","readonly":false,"value":"false"},{"key":"FreeChargeModeIdTag","readonly":false,"value":"FFFFFFFF"},{"key":"G_ChargerMode","readonly":false,"value":"2"},{"key":"G_MaxCurrent","readonly":false,"value":"32"},{"key":"G_SolarMode","readonly":false,"value":"0"},{"key":"G_OffPeakEnable","readonly":false,"value":"0"},{"key":"G_OffPeakCurr","readonly":false,"value":"0"},{"key":"G_LowPowerReserveEnable","readonly":false,"value":"0"},{"key":"G_SolarLimitPower","readonly":false,"value":"0.000000"},{"key":"G_PeriodTime","readonly":false,"value":"08:00-12:00;16:00-22:00;"}],"unknownKey":[]}';
  }

  /**
   * Check if key is for ATESS private configuration
   *
   * @param string key
   * @returns boolean
   */
  public static isAtessPrivateKey(key: string): boolean {
    return (
      key === "G_LowPowerReserveEnable" ||
      key === "UnlockConnectorOnEVSideDisconnect" ||
      key === "G_PeriodTime" ||
      key === "G_OffPeakEnable" ||
      key === "G_OffPeakCurr" ||
      key === "G_ChargerNetMac" ||
      key === "AuthorizationCacheEnabled" ||
      key === "AuthorizeRemoteTxRequests" ||
      key === "ConnectionTimeOut" ||
      key === "LocalAuthListEnabled" ||
      key === "LocalAuthorizeOffline" ||
      key === "LocalPreAuthorize" ||
      key === "StopTransactionOnInvalidId"
    );
  }

  /**
   * Check if key is for ATESS public configuration
   *
   * @param string key
   * @returns boolean
   */
  public static isAtessPublicKey(key: string): boolean {
    return (
      key === "G_ChargerID" ||
      key === "G_ChargerRate" ||
      key === "G_ChargerLanguage" ||
      key === "G_MaxCurrent" ||
      key === "G_ChargerMode" ||
      key === "G_CardPin" ||
      key === "G_Authentication" ||
      key === "G_ChargerNetIP" ||
      key === "G_MaxTemperature" ||
      key === "G_ExternalLimitPower" ||
      key === "G_ExternalLimitPowerEnable" ||
      key === "G_ExternalSamplingCurWring" ||
      key === "G_SolarMode" ||
      key === "G_SolarLimitPower" ||
      key === "G_PeakValleyEnable" ||
      key === "G_AutoChargeTime" ||
      key === "G_RCDProtection" ||
      key === "G_PowerMeterAddr" ||
      key === "G_PowerMeterType" ||
      key === "G_TimeZone" ||
      key === "G_ServerURL" ||
      key === "G_RandDelayChargeTime" ||
      key === "HeartbeatInterval" ||
      key === "MeterValueSampleInterval" ||
      key === "WebSocketPingInterval" ||
      key === "ConnectionTimeOut" ||
      key === "LocalAuthorizeOffline" ||
      key === "AuthorizationCacheEnabled" ||
      key === "LocalPreAuthorize" ||
      key === "LocalAuthListEnabled" ||
      key === "AuthorizeRemoteTxRequests"
    );
  }

  /**
   * Get configuration for EN+ 22kW charger
   * @returns JSON string with EN+ configuration
   */
  public static getEnPlus22kWConfiguration(): string {
    return '{"configurationKey":[{"key":"AllowOfflineTxForUnknownId","readonly":false,"value":"false"},{"key":"AuthorizationCacheEnabled","readonly":false,"value":"false"},{"key":"AuthorizeRemoteTxRequests","readonly":false,"value":"false"},{"key":"BlinkRepeat","readonly":false,"value":"0"},{"key":"ClockAlignedDataInterval","readonly":false,"value":"0"},{"key":"ConnectionTimeOut","readonly":false,"value":"180"},{"key":"ConnectorPhaseRotationMaxLength","readonly":false,"value":"120"},{"key":"GetConfigurationMaxKeys","readonly":false,"value":"50"},{"key":"HeartbeatInterval","readonly":false,"value":"300"},{"key":"LocalAuthorizeOffline","readonly":false,"value":"true"},{"key":"LocalPreAuthorize","readonly":false,"value":"false"},{"key":"MaxEnergyOnInvalidId","readonly":false,"value":"3000"},{"key":"MeterValuesAlignedData","readonly":false,"value":"Energy.Active.Import.Register,Current.Import,Voltage"},{"key":"MeterValuesAlignedDataMaxLength","readonly":false,"value":"120"},{"key":"MeterValuesSampledData","readonly":false,"value":"Current.Import,Energy.Active.Import.Register,Voltage"},{"key":"MeterValuesSampledDataMaxLength","readonly":false,"value":"120"},{"key":"MeterValueSampleInterval","readonly":false,"value":"60"},{"key":"MinimumStatusDuration","readonly":false,"value":"0"},{"key":"NumberOfConnectors","readonly":false,"value":"1"},{"key":"ResetRetries","readonly":false,"value":"0"},{"key":"StopTransactionOnEVSideDisconnect","readonly":false,"value":"false"},{"key":"StopTransactionOnInvalidId","readonly":false,"value":"true"},{"key":"StopTxnAlignedData","readonly":false,"value":""},{"key":"StopTxnAlignedDataMaxLength","readonly":false,"value":"120"},{"key":"SupportedFeatureProfiles","readonly":false,"value":"Core,Reservation,FirmwareManagement,LocalAuthListManagement,RemoteTrigger,SmartCharging"},{"key":"SupportedFeatureProfilesMaxLength","readonly":false,"value":"120"},{"key":"TransactionMessageAttempts","readonly":false,"value":"0"},{"key":"TransactionMessageRetryInterval","readonly":false,"value":"15"},{"key":"UnlockConnectorOnEVSideDisconnect","readonly":false,"value":"true"},{"key":"WebSocketPingInterval","readonly":false,"value":"0"},{"key":"LocalAuthListEnabled","readonly":false,"value":"true"},{"key":"LocalAuthListMaxLength","readonly":false,"value":"50"},{"key":"SendLocalListMaxLength","readonly":false,"value":"50"},{"key":"ReserveConnectorZeroSupported","readonly":false,"value":"false"},{"key":"ChargeProfileMaxStackLevel","readonly":false,"value":"5"},{"key":"ChargingScheduleAllowedChargingRateUnit","readonly":false,"value":"Current"},{"key":"ChargingScheduleMaxPeriods","readonly":false,"value":"5"},{"key":"ConnectorSwitch3to1PhaseSupported","readonly":false,"value":"false"},{"key":"AuthorizationKey","readonly":false,"value":"ABCDEFGHIJ123456"},{"key":"CertificateStoreMaxLength","readonly":false,"value":"8"},{"key":"CpoName","readonly":false,"value":"EN+"},{"key":"SecurityProfile","readonly":false,"value":"2"},{"key":"vendorId","readonly":false,"value":"EN+"},{"key":"chargePointSN","readonly":false,"value":""},{"key":"ChargingParametersEnabled","readonly":false,"value":"true"},{"key":"ConnectorPhaseRotation","readonly":false,"value":""},{"key":"StopTxnSampledData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"StopTxnSampledDataMaxLength","readonly":false,"value":"120"},{"key":"CertificateSignedMaxChainSize","readonly":false,"value":"5000"},{"key":"AdditionalRootCertificateCheck","readonly":false,"value":"false"}]}';
  }

  /**
   * Get the vendor-specific random delay configuration key
   *
   * @param vendor The vendor name
   * @returns The key name and max delay in seconds, or null if not supported
   */
  public static getVendorRandomDelayConfigKey(vendor: string): string | null {
    switch (vendor) {
      case VendorConfig.VENDORS.ATESS:
        return "G_RandDelayChargeTime";

      case VendorConfig.VENDORS.VESTEL:
        // Vestel has multiple random delay keys, prefer RandomisedDelayMaxSeconds
        return "RandomisedDelayMaxSeconds";

      case VendorConfig.VENDORS.KEBA:
        return "RandomProfileMaxDelay";

      case VendorConfig.VENDORS.GL_EVIQ:
        return "G_RandDelayChargeTime";

      default:
        return null; // Vendor doesn't support random delay
    }
  }

  /**
   * Get the vendor-specific random delay status notification payload
   *
   * @param vendor The vendor name
   * @param randomDelay The random delay in seconds, or null if not supported
   * @returns The status notification payload, or null if not supported
   */
  public static getVendorRandomDelayStatusNotificationPayload(vendor: string, randomDelay: number | null = null) {
    switch (vendor) {
      case VendorConfig.VENDORS.ATESS:
      case VendorConfig.VENDORS.GL_EVIQ:
        return {
          info: "RandDelayWait",
          status: "Preparing",
        };

      case VendorConfig.VENDORS.VESTEL:
        return {
          info: `RandomizedDelay=${randomDelay}`,
          status: "SuspendedEVSE",
        };

      default:
        return null; // Vendor doesn't support random delay
    }
  }
}
