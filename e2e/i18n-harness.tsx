import "../src/style.css";

import { Button } from "@gryt/ui";
import { useState } from "react";
import { createRoot } from "react-dom/client";

import { termsGate } from "../src/lib/termsGate";
import { i18n, restoreLanguagePreference, setLanguagePreference, useTranslation } from "../src/packages/i18n";
import { LanguageSettings } from "../src/packages/settings/src/components/languageSettings";
import { searchSettings } from "../src/packages/settings/src/hooks/settingsSearch";
import { ChatEditor } from "../src/packages/socket/src/components/ChatEditor";
import { ConnectionBanner } from "../src/packages/socket/src/components/ConnectionBanner";
import { InviteAcceptModal } from "../src/packages/socket/src/components/InviteAcceptModal";

export function Harness() {
  const { t } = useTranslation();
  const [sent, setSent] = useState<string[]>([]);
  const [invite, setInvite] = useState(false);
  return <div className="gryt-app p-4" style={{ maxWidth: 700 }}>
    <LanguageSettings />
    <Button onClick={() => void setLanguagePreference("en")}>English</Button>
    <Button onClick={() => void setLanguagePreference("zh-CN")}>简体中文</Button>
    <Button onClick={() => setInvite(true)}>Open invite</Button>
    <Button onClick={() => void restoreLanguagePreference()}>Restore preference</Button>
    <ConnectionBanner connectionStatus="reconnecting" onReconnect={() => {}} />
    <ChatEditor onSend={(text) => setSent((old) => [...old, text])} memberList={[{ nickname: "Alice", serverUserId: "alice" }]} />
    <output data-testid="sent">{JSON.stringify(sent)}</output>
    <output data-testid="language">{i18n.resolvedLanguage}</output>
    <output data-testid="search">{JSON.stringify(searchSettings("麦克风"))}</output>
    <output>{t("ui.settings")}</output>
    <InviteAcceptModal invite={invite ? { host: "127.0.0.1:59999", code: "SAMPLE" } : null}
      isSignedIn={false} onSignIn={() => {}} onJoin={async () => ({ ok: false, kind: "invite_required", message: "Invalid invite code.", messageKey: "errors.invalidInvite" })}
      onDismiss={() => setInvite(false)} />
  </div>;
}
termsGate.agree();
createRoot(document.getElementById("root")!).render(<Harness />);
