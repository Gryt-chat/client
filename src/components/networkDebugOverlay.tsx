import { DebugOverlay } from "./debugOverlay";

interface NetworkDebugOverlayProps {
  isVisible: boolean;
}

export function NetworkDebugOverlay({ isVisible }: NetworkDebugOverlayProps) {
  // This is just an example of how easy it is to create new debug overlays
  // In a real implementation, you would add network-specific state and logic here
  
  return (
    <DebugOverlay
      isVisible={isVisible}
      title="Network Debug"
      icon="🌐"
      status={{
        active: true, // This would be determined by actual network status
        label: "Connected"
      }}
      initialPosition={{ x: window.innerWidth - 340, y: 120 }} // Offset for multiple overlays
    >
      {/* Network-specific content would go here */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold" }}>Connection:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Status: Connected</div>
          <div>Latency: 45ms</div>
          <div>Packet Loss: 0%</div>
        </div>
      </div>

      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold" }}>Bandwidth:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Upload: 1.2 Mbps</div>
          <div>Download: 15.8 Mbps</div>
        </div>
      </div>
    </DebugOverlay>
  );
}
