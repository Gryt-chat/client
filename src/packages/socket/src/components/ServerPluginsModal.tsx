import { Dialog, IconButton, Surface } from "@gryt/ui";
import { useEffect, useState } from "react";

import { type AnnouncedPlugin,pluginsOn, useAddons } from "@/addons";

import { PiX } from "../../../../lib/icons";
import {
  describeCapabilities,
  missingHalves,
  NOTHING_NAMED,
} from "../lib/pluginCapabilityWording";

/**
 * What a server is running, for the people it is running it on (GRYT-942).
 *
 * A server plugin reads the messages people send through that server. Every one
 * of them is named to everybody who joins, along with what it may do, and this
 * is where that list is read.
 *
 * Reachable from the server menu, which every member has — not from server
 * settings, which needs a permission. A safety net only the operator can see is
 * not one.
 *
 * It sits next to Leave in that menu on purpose. Leaving is what somebody does
 * about what they read here, and putting the two together is the honest
 * arrangement rather than a coincidence of ordering.
 */

type OpenDetail = { host: string };

export function ServerPluginsModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [host, setHost] = useState("");
  const [plugins, setPlugins] = useState<AnnouncedPlugin[]>([]);

  /* What is installed here, so a plugin whose client half is missing can say
     so. Read live rather than at open: somebody may install one and come back
     without closing the app. */
  const { addons } = useAddons();
  const missing = missingHalves(plugins, addons.map((addon) => addon.id));
  const missingIds = new Set(missing.map((plugin) => plugin.id));

  useEffect(() => {
    const handler = (event: CustomEvent<OpenDetail>) => {
      const h = event.detail?.host;
      if (!h) return;
      setHost(h);
      /* Read as it opens rather than kept in state. The list only changes when
         the server restarts, and reading it here means it is whatever the last
         `server:details` said instead of whatever this component saw first. */
      setPlugins(pluginsOn(h));
      setIsOpen(true);
    };
    window.addEventListener("server_plugins_open", handler as EventListener);
    return () => window.removeEventListener("server_plugins_open", handler as EventListener);
  }, []);

  const close = () => {
    setIsOpen(false);
    setHost("");
    setPlugins([]);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 640 }}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Dialog.Title>What {host || "this server"} runs</Dialog.Title>
              <Dialog.Close>
                <IconButton tone="ghost" size="xsmall" onClick={close}>
                  <PiX size={16} />
                </IconButton>
              </Dialog.Close>
            </div>

            <span className="text-sm text-gryt-muted">
              Plugins run inside the server, so they see what goes through it.
              Whoever runs this server chose these.
            </span>

            {/*
              The Minecraft line, without the throwing-out. A server plugin
              that talks to people's apps has a half that belongs here, and not
              having it means not seeing what it adds — not being refused. The
              server still works; it is Gryt underneath.
            */}
            {missing.length > 0 ? (
              <Surface>
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">
                    {missing.length === 1
                      ? "One of these has a part you do not have"
                      : `${missing.length} of these have parts you do not have`}
                  </span>
                  <span className="text-xs text-gryt-muted">
                    Everything here works without them. You will just not see
                    whatever they add.
                  </span>
                </div>
              </Surface>
            ) : null}

            {plugins.length === 0 ? (
              <span className="text-sm text-gryt-muted">{NOTHING_NAMED}</span>
            ) : (
              <div className="flex flex-col gap-2">
                {plugins.map((plugin) => (
                  <Surface key={plugin.id}>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-bold">
                        {plugin.name}
                        {plugin.author ? (
                          <span className="font-normal text-gryt-muted"> by {plugin.author}</span>
                        ) : null}
                        {missingIds.has(plugin.id) ? (
                          <span className="font-normal text-gryt-muted"> · not installed here</span>
                        ) : null}
                      </span>

                      {plugin.description ? (
                        <span className="text-xs">{plugin.description}</span>
                      ) : null}

                      {/*
                        The part somebody is here for. Listed rather than
                        summarised: "reads your messages" and "can ban you" are
                        different enough that folding them into one line would
                        lose whichever one mattered.
                      */}
                      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-gryt-muted">
                        {describeCapabilities(plugin.capabilities).map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>

                      {plugin.capabilities.length === 0 ? (
                        <span className="text-xs text-gryt-muted">
                          Asked for nothing, so it only sees what the server tells it.
                        </span>
                      ) : null}

                      {/* Nowhere to send them. Worth saying, because "you are
                          missing this" with no way to act on it reads as a
                          broken link rather than as a plugin whose author gave
                          no address. */}
                      {missingIds.has(plugin.id) && !plugin.homepage ? (
                        <span className="text-xs text-gryt-muted">
                          Whoever runs the server knows where this came from.
                        </span>
                      ) : null}

                      {plugin.homepage ? (
                        /* Checked to be http(s) on the server and again on the
                           way in. It still goes somewhere nobody vetted, so it
                           opens away from Gryt and carries no referrer. */
                        <a
                          className="text-xs underline"
                          href={plugin.homepage}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {missingIds.has(plugin.id) ? "Where to get it" : "Read about it"}
                        </a>
                      ) : null}
                    </div>
                  </Surface>
                ))}
              </div>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
