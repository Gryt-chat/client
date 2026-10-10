import { Select } from "@gryt/ui";

import { getLanguagePreference, setLanguagePreference, useTranslation } from "@/i18n";
import { isLanguagePreference } from "@/i18n/preferences";

import { SettingGroup } from "./settingsComponents";

export function LanguageSettings() {
  const { t } = useTranslation();
  return (
    <SettingGroup title={t("language.title")} description={t("language.description")} anchorId="language">
      <Select
        label={<span className="sr-only">{t("language.title")}</span>}
        value={getLanguagePreference()}
        onValueChange={(value) => { if (isLanguagePreference(value)) void setLanguagePreference(value); }}
        options={[
          { value: "system", label: t("language.system") },
          { value: "en", label: t("language.en") },
          { value: "zh-CN", label: t("language.zhCN") },
        ]}
      />
    </SettingGroup>
  );
}
