import { Button, Surface } from "@gryt/ui";

import { FaGithub, SiKofi } from "../../../../lib/brandIcons";
import { PiArrowSquareOutFill } from "../../../../lib/icons";
import { SettingsContainer } from "./settingsComponents";

const GITHUB_URL = "https://github.com/Gryt-chat/gryt";
const KOFI_URL = "https://ko-fi.com/sivert";

export function SupportSettings() {
  return (
    <SettingsContainer>
      <h2 className="text-lg">Support Gryt</h2>

      <span className="text-sm text-gryt-muted">
        Gryt is free and open source. Stars and donations help keep it going.
      </span>

      <Surface className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FaGithub size={18} />
            <span className="text-base font-medium">Star on GitHub</span>
          </div>
          <span className="text-sm text-gryt-muted">
            A star helps others discover Gryt and shows that people find it
            useful.
          </span>
          <Button size="small"
            tone="neutral"
            render={
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <FaGithub size={16} />
            Star on GitHub
            <PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>

      <Surface className="p-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <SiKofi size={18} />
            <span className="text-base font-medium">Donate on Ko-fi</span>
          </div>
          <span className="text-sm text-gryt-muted">
            Donations go directly toward hosting, development, and keeping Gryt
            free for everyone.
          </span>
          <Button size="small"
            tone="neutral"
            render={
              <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" />
            }
          >
            <SiKofi size={16} />
            Donate on Ko-fi
            <PiArrowSquareOutFill size={14} />
          </Button>
        </div>
      </Surface>
    </SettingsContainer>
  );
}
