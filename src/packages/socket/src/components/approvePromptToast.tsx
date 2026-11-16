import { Button } from "@gryt/ui";
import { DeviceMobile, Monitor } from "@phosphor-icons/react";
import toast from "react-hot-toast";

/** On an approved device: one of yours is waiting. Approve only opens Link a device, where you type its code. */
export function showApprovePrompt(deviceType: string, deny: () => void): void {
  const id = `approve-ask-${deviceType}`;
  const article = /^[aeiou]/i.test(deviceType) ? "An" : "A";
  const Icon = /phone|android|ipad/i.test(deviceType) ? DeviceMobile : Monitor;
  toast(
    () => (
      <div className="flex flex-col gap-3" style={{ minWidth: 0 }}>
        <div className="flex items-start gap-3">
          <Icon size={20} weight="bold" className="mt-px shrink-0" style={{ color: "var(--gryt-accent-9)" }} aria-hidden />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-semibold">{article} {deviceType} wants to be approved</span>
            <span className="text-xs" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
              Signed in to your account just now. Only approve it if it&rsquo;s in front of you: you&rsquo;ll type the code it shows.
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button tone="neutral" size="small" onClick={() => { toast.dismiss(id); deny(); window.dispatchEvent(new Event("gryt:not-me")); }}>Not me</Button>
          <Button size="small" onClick={() => { toast.dismiss(id); window.dispatchEvent(new Event("gryt:open-approve-device")); }}>Approve</Button>
        </div>
      </div>
    ),
    { id, duration: Infinity },
  );
}
