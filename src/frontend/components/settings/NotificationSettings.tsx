"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Badge, Button, Panel, PanelHeader } from "@/components/glass";

type Permission = NotificationPermission | "unsupported" | "checking";

const ALERT_TYPES = [
  "Order execution",
  "Stop-loss and take-profit events",
  "Account disconnections",
  "Market alerts",
  "Strategy signals",
  "Risk threshold violations",
];

export function NotificationSettings() {
  const [permission, setPermission] = useState<Permission>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setPermission("Notification" in window ? Notification.permission : "unsupported");
  }, []);

  const enable = async () => {
    setMessage("");
    try {
      const granted = permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") {
        setMessage(granted === "denied" ? "Notifications are blocked for this site. Change the permission in your browser or device settings." : "Permission was not granted.");
        return;
      }

      const registration = await navigator.serviceWorker?.getRegistration();
      const options = { body: "Browser notifications are enabled on this device.", icon: "/icons/axylum-192.png" };
      if (registration) await registration.showNotification("Axylum notifications enabled", options);
      else new Notification("Axylum notifications enabled", options);
      setMessage("Permission confirmed on this device. Server-delivered trading alerts are not connected yet.");
    } catch (reason) {
      console.error("Unable to enable Axylum notifications", reason);
      setMessage(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const tone = permission === "granted" ? "emerald" : permission === "denied" ? "crimson" : "amber";
  const label = permission === "checking" ? "Checking" : permission === "unsupported" ? "Not supported" : permission === "granted" ? "Allowed on this device" : permission === "denied" ? "Blocked" : "Not enabled";

  return (
    <Panel hover={false} tone="violet">
      <PanelHeader eyebrow="Notifications" title="Alert delivery" action={<Badge tone={tone} dot>{label}</Badge>} />
      <div className="grid gap-5 px-4 pb-5 sm:px-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-[12.5px] leading-relaxed text-fg-2">
            Browser permission and the service-worker display path are prepared. Axylum does not yet have push-subscription storage or a server event publisher, so these alert types will not be delivered in the background yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ALERT_TYPES.map((type) => <span key={type} className="rounded-full border hairline px-2.5 py-1 text-[10.5px] text-fg-3">{type}</span>)}
          </div>
          {message && <p role="status" aria-live="polite" className="mt-3 text-[11px] text-fg-2">{message}</p>}
        </div>
        <Button
          variant="primary"
          className="w-full lg:w-auto"
          disabled={permission === "checking" || permission === "unsupported" || permission === "denied"}
          onClick={() => void enable()}
        >
          <BellRing size={14} />
          {permission === "granted" ? "Send test notification" : permission === "denied" ? "Blocked in browser settings" : "Enable notifications"}
        </Button>
      </div>
    </Panel>
  );
}
