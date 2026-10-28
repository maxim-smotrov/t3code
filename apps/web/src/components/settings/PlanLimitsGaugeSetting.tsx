import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function PlanLimitsGaugeSetting() {
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      {...setting("plan-limits-gauge")}
      description="Show a gauge in the composer that displays the remaining usage within your limits. The needle shows the shortest window, while the arc shows the next longer one."
      resetAction={
        settings.planLimitsGaugeEnabled !== DEFAULT_UNIFIED_SETTINGS.planLimitsGaugeEnabled ? (
          <SettingResetButton
            ariaLabel="Reset plan limits gauge to default"
            onClick={() =>
              updateSettings({
                planLimitsGaugeEnabled: DEFAULT_UNIFIED_SETTINGS.planLimitsGaugeEnabled,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.planLimitsGaugeEnabled}
          onCheckedChange={(checked) =>
            updateSettings({ planLimitsGaugeEnabled: Boolean(checked) })
          }
          aria-label="Plan limits gauge"
        />
      }
    />
  );
}
